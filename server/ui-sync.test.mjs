import { test, expect } from "bun:test"
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createUiSyncService } from "./ui-sync.ts"
import { createWebDispatcher } from "./web-dispatch.ts"
import { uiSync } from "../src/lib/ui-sync.ts"
import { collectUiSyncSnapshot, uiSyncStorageUpdates } from "../src/lib/ui-sync-adapter.ts"
import { shortcutStorageKey } from "../src/lib/session-shortcuts.ts"
import { preferencesStorageKey } from "../src/lib/web-ui-preferences.ts"

test("opt-in sync is bounded, strictly validated, private, and guarded by the gateway", async () => {
  const dir = await mkdtemp("/tmp/opencode/ui-sync-test-")
  const file = join(dir, "private", "snapshot.json")
  const sync = createUiSyncService({ stateFile: file })
  const stub = () => new Response("stub")
  const dispatch = createWebDispatcher({
    security: { allowedHosts: ["example.test"], allowedOrigins: ["https://example.test"] },
    sync: sync.handleRequest, agents: stub, notifications: stub, artifacts: stub, engine: stub, frontend: stub,
  })
  const request = (method = "GET", body, headers = {}) => dispatch(new Request("https://example.test/api/ui/sync", {
    method, headers: { host: "example.test", origin: "https://example.test", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body,
  }))
  const snapshot = { version: 1, backendVersion: "2.1.4", preferences: { theme: "system", global: { agentID: null, model: null, thinkingLevel: null }, startup: { mode: "last" } }, presets: [], pins: ["session-1"], labels: [{ id: "session-1", label: "Work" }] }
  try {
    expect((await request()).status).toBe(404)
    expect(await stat(file).catch(() => null)).toBeNull()
    expect((await request("PUT", JSON.stringify(snapshot), { origin: "https://evil.test" })).status).toBe(403)
    expect((await request("PUT", JSON.stringify(snapshot), { host: "evil.test" })).status).toBe(403)
    expect((await request("PUT", JSON.stringify(snapshot), { "content-type": "text/plain" })).status).toBe(415)
    expect((await request("PUT", "x".repeat(65537))).status).toBe(413)
    expect((await request("PUT", JSON.stringify({ ...snapshot, transcript: "secret" }))).status).toBe(400)
    expect((await request("PUT", JSON.stringify({ ...snapshot, preferences: { ...snapshot.preferences, draft: "secret" } }))).status).toBe(400)
    expect((await request("PUT", JSON.stringify({ ...snapshot, labels: [{ id: "x", label: "a\nb" }] }))).status).toBe(400)
    expect((await request("PUT", JSON.stringify({ ...snapshot, pins: Array(501).fill("x") }))).status).toBe(400)
    expect((await request("PUT", JSON.stringify({ ...snapshot, pins: Array.from({ length: 300 }, (_, i) => `p${i}`), labels: Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, label: "x" })) }))).status).toBe(400)
    expect((await request("PUT", JSON.stringify(snapshot))).status).toBe(412)
    expect((await request("PUT", JSON.stringify(snapshot), { "if-none-match": "*" })).status).toBe(204)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(join(dir, "private"))).mode & 0o777).toBe(0o700)
    const response = await request()
    expect(response.headers.get("cache-control")).toBe("no-store")
    const revision = response.headers.get("etag")
    expect(await response.json()).toEqual(snapshot)
    expect((await request("PUT", JSON.stringify({ ...snapshot, backendVersion: "other" }), { "if-match": revision })).status).toBe(409)
    const changed = { ...snapshot, pins: ["session-2"] }
    expect((await request("PUT", JSON.stringify(changed), { "if-match": revision })).status).toBe(204)
    expect((await request("PUT", JSON.stringify(snapshot), { "if-match": revision })).status).toBe(412)
    expect((await request("DELETE", undefined, { "if-match": revision })).status).toBe(412)
    const nextRevision = (await request()).headers.get("etag")
    expect((await request("POST", "{}" )).status).toBe(405)
    expect((await request("DELETE", undefined, { origin: "https://evil.test" })).status).toBe(403)
    expect((await request("DELETE", undefined, { "if-match": nextRevision })).status).toBe(204)
    expect((await request()).status).toBe(404)
    const target = join(dir, "target")
    await writeFile(target, "untouched", { mode: 0o600 })
    await symlink(target, file)
    expect((await request()).status).toBe(500)
    expect((await request("PUT", JSON.stringify(snapshot), { "if-none-match": "*" })).status).toBe(500)
    expect(await readFile(target, "utf8")).toBe("untouched")
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("adapter round-trips actual presets and scoped shortcuts without unrelated storage", () => {
  const origin = "https://example.test", version = "2.1.4"
  const values = new Map([
    ["theme", "dark"],
    ["opencode-ui:model-presets:v1", JSON.stringify([{ name: "Fast", agent: "build", model: { providerID: "provider", id: "model", variant: "low" } }])],
    [shortcutStorageKey(origin, version), JSON.stringify({ session_1: { pinned: true, label: "Work" }, session_2: { pinned: false, label: "Read" } })],
    ["draft", "must not be copied"],
  ])
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const snapshot = collectUiSyncSnapshot(storage, origin, version)
  expect(snapshot.presets[0].model.variant).toBe("low")
  expect(snapshot.pins).toEqual(["session_1"])
  expect(JSON.stringify(snapshot)).not.toContain("must not be copied")
  const updates = uiSyncStorageUpdates(snapshot, origin, version)
  expect(JSON.parse(updates[shortcutStorageKey(origin, version)])).toEqual({ session_1: { pinned: true, label: "Work" }, session_2: { pinned: false, label: "Read" } })
  expect(JSON.parse(updates[preferencesStorageKey(origin, version)]).backendVersion).toBe(version)
  expect(() => uiSyncStorageUpdates(snapshot, origin, "other")).toThrow()
})

test("client sync operations are explicit, validate input, and surface errors", async () => {
  const original = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (...args) => { calls.push(args); return new Response(null, { status: 404 }) }
    expect(await uiSync.download("2.1.4")).toBeNull()
    await expect(uiSync.upload({ version: 1, draft: "private" }, null)).rejects.toThrow()
    expect(calls.length).toBe(1)
    await expect(uiSync.remove('"revision"')).rejects.toThrow("404")
    expect(calls[1][1].method).toBe("DELETE")
  } finally { globalThis.fetch = original }
})

test("an incompatible snapshot can be inspected for an explicit conditional deletion", async () => {
  const original = globalThis.fetch
  const snapshot = { version: 1, backendVersion: "old", preferences: { theme: "system", global: { agentID: null, model: null, thinkingLevel: null }, startup: { mode: "last" } }, presets: [], pins: [], labels: [] }
  try {
    globalThis.fetch = async () => Response.json(snapshot, { headers: { etag: '"old-revision"' } })
    await expect(uiSync.download("2.1.4")).rejects.toThrow("version mismatch")
    expect((await uiSync.inspect()).revision).toBe('"old-revision"')
  } finally { globalThis.fetch = original }
})
