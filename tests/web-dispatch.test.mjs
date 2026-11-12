import { describe, expect, test } from "bun:test"
import { createWebDispatcher } from "../server/web-dispatch.ts"

const handler = (name) => async () => new Response(name)
const security = { allowedHosts: ["example.test"], allowedOrigins: ["https://example.test"] }
const dispatch = createWebDispatcher({
  security,
  agents: handler("agents"), notifications: handler("notifications"), artifacts: handler("artifacts"),
  engine: handler("engine"), frontend: handler("frontend"),
})
const request = (path, init = {}) => new Request(`https://example.test${path}`, {
  ...init, headers: { host: "example.test", origin: "https://example.test", ...init.headers },
})
const withUiApis = createWebDispatcher({
  security,
  notes: handler("notes"), plugins: handler("plugins"),
  agents: handler("agents"), notifications: handler("notifications"), artifacts: handler("artifacts"),
  engine: handler("engine"), frontend: handler("frontend"),
})
const withMedia = createWebDispatcher({
  security,
  agents: handler("agents"), notifications: handler("notifications"), artifacts: handler("artifacts"),
  engine: handler("engine"), frontend: handler("frontend"),
})

describe("Web gateway dispatch", () => {
  test("dispatches specific UI handlers before artifacts and engine", async () => {
    for (const [path, expected] of [["/api/ui/agents", "agents"], ["/api/ui/notifications/state", "notifications"], ["/api/ui/artifacts/resolve", "artifacts"], ["/api/event", "engine"], ["/", "frontend"]]) {
      expect(await (await dispatch(request(path))).text()).toBe(expected)
    }
  })
  test("routes notes and plugins before the artifact fallback", async () => {
    for (const [path, expected] of [
      ["/api/ui/notes/list", "notes"], ["/api/ui/notes/createAttachment", "notes"],
      ["/api/ui/notes/events", "notes"], ["/api/ui/plugins", "plugins"],
      ["/api/ui/plugins/notes/enable", "plugins"],
    ]) {
      expect(await (await withUiApis(request(path))).text()).toBe(expected)
    }
    // Without the optional handlers the existing artifact routing is preserved.
    expect(await (await dispatch(request("/api/ui/notes/list"))).text()).toBe("artifacts")
    expect(await (await dispatch(request("/api/ui/plugins"))).text()).toBe("artifacts")
  })
    for (const path of [
    ]) {
    }
    // Without the optional handler the existing artifact routing is preserved.
  })
    const post = (path, body) => withMedia(request(path, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }))
  })
    // Regression: the gateway chose the 1 MiB ceiling whenever *any* path
    // segment was `import`/`batch`, so the connection-test route for an entity
    // whose ID happened to be `import` buffered 1 MiB instead of 256 KiB.
    const post = (path, body) => withMedia(request(path, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }))
    for (const id of ["import", "imports", "batch"]) {
      expect((await post(path, "x".repeat(256 * 1024))).status).toBe(200)
      const oversized = await post(path, "x".repeat(256 * 1024 + 1))
      expect(oversized.status).toBe(413)
      expect(await oversized.json()).toEqual({ error: { code: "payload_too_large" } })
    }
  })
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(256 * 1024 + 1),
    }))
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toEqual({ error: { code: "payload_too_large" } })

      method: "POST", headers: { "content-type": "text/plain" }, body: "x",
    }))
    expect(nonJson.status).toBe(415)
    expect(await nonJson.json()).toEqual({
      error: { code: "invalid", message: "Mutations must be sent as JSON" },
    })

    const notesOversized = await withUiApis(request("/api/ui/notes/create", {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1024 * 1024 + 1),
    }))
    expect(await notesOversized.text()).toBe("Request too large\n")

    const notesNonJson = await withUiApis(request("/api/ui/notes/create", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "x",
    }))
    expect(await notesNonJson.text()).toBe("Forbidden: browser mutation must be JSON\n")
  })
  test("caps notes mutation bodies at 1 MiB except attachment uploads", async () => {
    const body = "x".repeat(1024 * 1024 + 1)
    const oversized = await withUiApis(request("/api/ui/notes/create", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }))
    expect(oversized.status).toBe(413)
    const attachment = await withUiApis(request("/api/ui/notes/createAttachment", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }))
    expect(attachment.status).toBe(200)
    expect(await attachment.text()).toBe("notes")
  })
  test("rejects oversized UI bodies before invoking handlers", async () => {
    const response = await dispatch(request("/api/ui/notifications/test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(32 * 1024 + 1),
    }))
    expect(response.status).toBe(413)
  })
  test("rejects untrusted origin before dispatch", async () => {
    const response = await dispatch(request("/api/event", { headers: { origin: "https://evil.test" } }))
    expect(response.status).toBe(403)
  })
  test("no longer proxies retired notes RPC paths", async () => {
    const response = await dispatch(request("/api/rpc/opencode-notes/list", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }))
    expect(response.status).toBe(403)
  })
})
