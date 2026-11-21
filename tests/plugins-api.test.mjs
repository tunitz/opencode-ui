import { afterAll, afterEach, describe, expect, test } from "bun:test"
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { createPluginsApi } from "../server/plugins-api.ts"

const servers = []
const tempDirs = []
const readonlyDirs = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
  for (const dir of readonlyDirs.splice(0)) await chmod(dir, 0o700).catch(() => {})
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

const authorization = "Basic fake-test-credential"

function fakeEngine(options = {}) {
  const state = {
    servers: options.servers ?? [],
    calls: [],
    // Engine mutations applied, in completion order. "calls" records arrival,
    // which is not enough to prove config and engine kept one order.
    applied: [],
    rejectAdd: options.rejectAdd ?? false,
    connectOnAdd: options.connectOnAdd ?? false,
    rejectConnect: options.rejectConnect ?? false,
    rejectDelete: options.rejectDelete ?? false,
    putDelayMs: options.putDelayMs ?? 0,
    hangPut: options.hangPut ?? false,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const call = { method: request.method, path: url.pathname, auth: request.headers.get("authorization") }
      state.calls.push(call)
      if (request.method === "GET" && url.pathname === "/api/mcp") {
        return Response.json({ location: { directory: "/" }, data: state.servers })
      }
      const route = /^\/api\/experimental\/mcp\/([^/]+)(\/connect)?$/.exec(url.pathname)
      if (route) {
        const id = route[1]
        const existing = state.servers.find((entry) => entry.name === id)
        if (route[2] === "/connect") {
          if (request.method !== "POST") return new Response("unknown", { status: 404 })
          if (!existing) return new Response("missing", { status: 404 })
          if (state.rejectConnect) return new Response("nope", { status: 500 })
          existing.status = { status: "connected" }
          return new Response(null, { status: 204 })
        }
        if (request.method === "PUT") {
          call.body = await request.json()
          // Deliberately slow or stuck hot apply, used to expose whether the
          // config write and the engine call are one ordered section.
          if (state.hangPut) await new Promise(() => {})
          if (state.putDelayMs > 0) await Bun.sleep(state.putDelayMs)
          if (state.rejectAdd) return new Response("nope", { status: 400 })
          state.servers = state.servers.filter((entry) => entry.name !== id)
          state.servers.push({ name: id, status: { status: state.connectOnAdd ? "connected" : "pending" } })
          state.applied.push({ method: "PUT", id })
          return new Response(null, { status: 204 })
        }
        if (request.method === "DELETE") {
          if (state.rejectDelete) return new Response("nope", { status: 500 })
          if (!existing) return new Response("missing", { status: 404 })
          state.servers = state.servers.filter((entry) => entry.name !== id)
          state.applied.push({ method: "DELETE", id })
          return new Response(null, { status: 204 })
        }
      }
      return new Response("unknown", { status: 404 })
    },
  })
  servers.push(server)
  return { state, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

async function configDir() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-ui-plugins-"))
  tempDirs.push(dir)
  return dir
}

async function writeConfig(dir, value, name = "opencode.jsonc") {
  const path = join(dir, name)
  await writeFile(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function notesConfig(repoRoot = BASE_REPO) {
  return {
    type: "local",
    command: [process.execPath, resolve(repoRoot, "plugins/notes/src/mcp/main.ts")],
    disabled: false,
    codemode: false,
  }
}

const NOTES_PLUGIN = {
  id: "notes",
  name: "Notes",
  description: "Project notes, planning and daily logs for agents and humans.",
  configured: false,
  installed: true,
  registered: false,
  connected: false,
  restartRequired: false,
  engineSynced: true,
}


function pluginStatus(plugin, overrides = {}) {
  return { ...plugin, ...overrides }
}

/** POST enable/disable settlement body, defaults matching a clean disable. */
function settlement(overrides = {}) {
  return {
    registered: false,
    connected: false,
    restartRequired: false,
    engineSynced: true,
    ...overrides,
  }
}

function apiFor(url, configDirectory, repoRoot = BASE_REPO, extra = {}) {
  if (!configDirectory) throw new Error("tests must pass an isolated config directory")
  return createPluginsApi({
    engineUrl: url,
    authorization,
    repoRoot,
    timeoutMs: 1000,
    env: { OPENCODE_CONFIG_DIR: configDirectory, ...extra.env },
    beforeConfigCommit: extra.beforeConfigCommit,
    configLockTimeoutMs: extra.configLockTimeoutMs,
    hotApplyTimeoutMs: extra.hotApplyTimeoutMs,
    getConnectionId: extra.getConnectionId,
  })
}

async function repoRootWith(pluginIds) {
  const dir = await configDir()
  for (const id of pluginIds) {
    if (id === "notes") {
      const entry = join(dir, "plugins", "notes", "src", "mcp")
      await mkdir(entry, { recursive: true })
      await writeFile(join(entry, "main.ts"), "// synthetic test entry\n")
      continue
    }
  }
  return dir
}

// Deterministic installation root independent of this checkout. It outlives
// the per-test temp directories.
const BASE_REPO = await mkdtemp(join(tmpdir(), "opencode-ui-plugins-base-"))
await mkdir(join(BASE_REPO, "plugins", "notes", "src", "mcp"), { recursive: true })
await writeFile(
  join(BASE_REPO, "plugins", "notes", "src", "mcp", "main.ts"),
  "// synthetic test entry\n"
)
afterAll(async () => {
  await rm(BASE_REPO, { recursive: true, force: true }).catch(() => {})
})

function get(api, path = "/api/ui/plugins") {
  return api.handleRequest(new Request(`http://localhost${path}`, { method: "GET" }))
}

function post(api, path) {
  return api.handleRequest(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }))
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the test condition")
    await Bun.sleep(5)
  }
}

const EXISTING_CONFIG = `{
  // top-level comment survives
  "theme": "dark",
  "mcp": {
    "servers": {
      // healthvault must keep working
      "healthvault": {
        "type": "local",
        "command": ["bun", "/srv/healthvault.ts"],
        "disabled": false
      }
    }
  }
}
`

const HEALTHVAULT = {
  type: "local",
  command: ["bun", "/srv/healthvault.ts"],
  disabled: false,
}

describe("Plugins HTTP API", () => {
  test("reads registration from the config and connection from the engine", async () => {
    const dir = await configDir()
    await writeConfig(dir, {
      mcp: { servers: { notes: notesConfig(), hindsight: HEALTHVAULT } },
    })
    const engine = fakeEngine({
      servers: [
        { name: "notes", status: { status: "connected" } },
        { name: "other", status: { status: "pending" } },
      ],
    })
    const response = await get(apiFor(engine.url, dir))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      engineAvailable: true,
      plugins: [
        pluginStatus(NOTES_PLUGIN, { configured: true, registered: true, connected: true }),
      ],
    })
    expect(engine.state.calls[0]).toEqual({ method: "GET", path: "/api/mcp", auth: authorization })
  })

  test("treats a disabled config entry as not registered", async () => {
    const dir = await configDir()
    await writeConfig(dir, {
      mcp: { servers: { notes: { ...notesConfig(), disabled: true } } },
    })
    const engine = fakeEngine({ servers: [] })
    const payload = await (await get(apiFor(engine.url, dir))).json()
    expect(payload.plugins[0]).toMatchObject({ registered: false, connected: false, restartRequired: false })
  })

  test("reports a registered but disconnected server as needing a restart", async () => {
    const dir = await configDir()
    await writeConfig(dir, { mcp: { servers: { notes: notesConfig() } } })
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "pending" } }] })
    const payload = await (await get(apiFor(engine.url, dir))).json()
    expect(payload.plugins[0]).toMatchObject({ registered: true, connected: false, restartRequired: true })
  })

  test("keeps the config registration when the engine is unreachable", async () => {
    const dir = await configDir()
    await writeConfig(dir, { mcp: { servers: { notes: notesConfig() } } })
    const engine = fakeEngine({})
    const url = engine.url
    await engine.stop()
    const response = await get(apiFor(url, dir))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      engineAvailable: false,
      plugins: [
        pluginStatus(NOTES_PLUGIN, {
          configured: true,
          registered: true,
          restartRequired: true,
          engineSynced: null,
        }),
      ],
    })
  })

  test("reports the engine's connection independently of the config entry", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "connected" } }] })
    const payload = await (await get(apiFor(engine.url, dir))).json()
    // The config does not register Notes but the engine still runs it: the
    // residual must be visible instead of looking merely "connected".
    expect(payload.plugins[0]).toMatchObject({
      registered: false,
      connected: true,
      restartRequired: false,
      engineSynced: false,
    })
  })

  test("reports invalid JSONC as a config read failure", async () => {
    const dir = await configDir()
    await writeConfig(dir, "{ not jsonc")
    const engine = fakeEngine({})
    const response = await get(apiFor(engine.url, dir))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text).error.code).toBe("config_read_failed")
    expect(text).not.toContain("fake-test-credential")
    expect(engine.state.calls).toHaveLength(0)
  })

  test("refuses to read a symlinked config file", async () => {
    const dir = await configDir()
    const real = join(dir, "real-config.jsonc")
    await writeFile(real, "{}\n")
    await symlink(real, join(dir, "opencode.jsonc"))
    const engine = fakeEngine({})
    const response = await get(apiFor(engine.url, dir))
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe("config_read_failed")
  })

  test("refuses to enable Notes when its entry is not installed", async () => {
    const dir = await configDir()
    const repoRoot = await repoRootWith([])
    const engine = fakeEngine({ connectOnAdd: true })
    const api = apiFor(engine.url, dir, repoRoot)

    // The list already treats the missing entry as not installed; enable must
    // agree and never persist an entry that would immediately be unreachable.
    const listed = await (await get(api)).json()
    expect(listed.plugins[0]).toMatchObject({
      installed: false,
      configured: false,
      registered: false,
    })

    const response = await post(api, "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("plugin_not_installed")
    await expect(readFile(join(dir, "opencode.jsonc"), "utf8")).rejects.toThrow()
    // Only the preceding list read reached the engine; enable made no mutation.
    expect(engine.state.calls.filter((call) => call.method !== "GET")).toHaveLength(0)
  })

  test("enable writes the notes entry and preserves JSONC comments and other servers", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, EXISTING_CONFIG)
    const engine = fakeEngine({ connectOnAdd: true })
    const repoRoot = await repoRootWith(["notes"])
    const response = await post(apiFor(engine.url, dir, repoRoot), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false, engineSynced: true })

    const text = await readFile(path, "utf8")
    expect(text).toContain("// top-level comment survives")
    expect(text).toContain("// healthvault must keep working")
    const parsed = parseJsonc(text)
    expect(parsed.theme).toBe("dark")
    expect(parsed.mcp.servers.healthvault).toEqual(HEALTHVAULT)
    expect(parsed.mcp.servers.notes).toEqual(notesConfig(repoRoot))

    const put = engine.state.calls.find((call) => call.method === "PUT")
    expect(put.path).toBe("/api/experimental/mcp/notes")
    expect(put.auth).toBe(authorization)
    expect(put.body).toEqual({ config: notesConfig(repoRoot) })
  })

  test("enable creates opencode.jsonc with a private mode when none exists", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    const path = join(dir, "opencode.jsonc")
    const parsed = parseJsonc(await readFile(path, "utf8"))
    expect(parsed.mcp.servers.notes).toEqual(notesConfig())
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test("enable is idempotent", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, EXISTING_CONFIG)
    const engine = fakeEngine({ connectOnAdd: true })
    const api = apiFor(engine.url, dir)

    const first = await post(api, "/api/ui/plugins/notes/enable")
    expect(first.status).toBe(200)
    const afterFirst = await readFile(path, "utf8")
    const second = await post(api, "/api/ui/plugins/notes/enable")
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ registered: true, connected: true, restartRequired: false, engineSynced: true })
    expect(await readFile(path, "utf8")).toBe(afterFirst)

    const parsed = parseJsonc(afterFirst)
    expect(parsed.mcp.servers.notes).toEqual(notesConfig())
    expect(parsed.mcp.servers.healthvault).toEqual(HEALTHVAULT)
  })

  test("enable prefers opencode.jsonc over opencode.json", async () => {
    const dir = await configDir()
    const jsoncPath = await writeConfig(dir, "{\n  // jsonc wins\n}\n", "opencode.jsonc")
    const jsonPath = await writeConfig(dir, { theme: "light" }, "opencode.json")
    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(parseJsonc(await readFile(jsonPath, "utf8"))).toEqual({ theme: "light" })
    expect(parseJsonc(await readFile(jsoncPath, "utf8")).mcp.servers.notes).toEqual(notesConfig())
  })

  test.skipIf(process.getuid?.() === 0)("reports a config write failure without touching the engine", async () => {
    const dir = await configDir()
    await writeConfig(dir, { mcp: { servers: { hindsight: HEALTHVAULT } } })
    await chmod(dir, 0o500)
    readonlyDirs.push(dir)
    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text).error.code).toBe("config_write_failed")
    expect(text).not.toContain("fake-test-credential")
    expect(engine.state.calls.some((call) => call.method === "PUT")).toBe(false)
  })

  test("enable keeps the persisted registration when the engine is unreachable", async () => {
    const dir = await configDir()
    const engine = fakeEngine({})
    const url = engine.url
    await engine.stop()
    const response = await post(apiFor(url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      registered: true,
      connected: false,
      restartRequired: true,
      engineSynced: null,
    })
    expect(parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8")).mcp.servers.notes).toEqual(notesConfig())
  })

  test("enable reports restartRequired when the engine cannot connect the server", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ rejectConnect: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      registered: true,
      connected: false,
      restartRequired: true,
      engineSynced: true,
    })
    expect(parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8")).mcp.servers.notes).toEqual(notesConfig())
  })

  test("enable does not reconnect a server the engine already connected", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false, engineSynced: true })
    expect(engine.state.calls.some((call) => call.method === "POST")).toBe(false)
  })

  test("disable removes only the notes entry and preserves comments", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, `{
  // keep me
  "mcp": {
    "servers": {
      // healthvault stays
      "healthvault": {
        "type": "local",
        "command": ["bun", "/srv/healthvault.ts"],
        "disabled": false
      },
      "notes": {
        "type": "local",
        "command": ["bun", "/srv/opencode-ui/plugins/notes/src/mcp/main.ts"],
        "disabled": false,
        "codemode": false
      }
    }
  }
}
`)
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "connected" } }] })
    const api = apiFor(engine.url, dir)
    const response = await post(api, "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(settlement())

    const text = await readFile(path, "utf8")
    expect(text).toContain("// keep me")
    expect(text).toContain("// healthvault stays")
    const parsed = parseJsonc(text)
    expect(parsed.mcp.servers.notes).toBeUndefined()
    expect(parsed.mcp.servers.healthvault).toEqual(HEALTHVAULT)

    const remove = engine.state.calls.find((call) => call.method === "DELETE")
    expect(remove.path).toBe("/api/experimental/mcp/notes")
    expect(remove.auth).toBe(authorization)
    expect((await (await get(api)).json()).plugins[0].registered).toBe(false)
  })

  test("disable treats a missing notes entry as success and leaves the file untouched", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, EXISTING_CONFIG)
    const engine = fakeEngine({})
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(settlement())
    expect(await readFile(path, "utf8")).toBe(EXISTING_CONFIG)
  })

  test("disable treats a missing config file as success", async () => {
    const dir = await configDir()
    const engine = fakeEngine({})
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(settlement())
  })

  test("disable succeeds when the engine is unreachable", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, { mcp: { servers: { notes: notesConfig() } } })
    const engine = fakeEngine({})
    const url = engine.url
    await engine.stop()
    const response = await post(apiFor(url, dir), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    // The config is disabled, but an unreachable engine cannot confirm that its
    // ephemeral entry is gone, so the residual is unknown, not "synced".
    expect(await response.json()).toEqual(settlement({ engineSynced: null }))
    expect(parseJsonc(await readFile(path, "utf8")).mcp.servers.notes).toBeUndefined()
  })

  test("refresh-scope requires an active connection and an enabled plugin", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ connectOnAdd: true })
    const repoRoot = await repoRootWith(["notes"])
    const path = await writeConfig(dir, EXISTING_CONFIG)
    let activeId = null
    const api = apiFor(engine.url, dir, repoRoot, {
      getConnectionId: () => activeId,
    })

    const noConnection = await post(api, "/api/ui/plugins/notes/refresh-scope")
    expect(noConnection.status).toBe(409)
    expect((await noConnection.json()).error.code).toBe("no_connection")
    expect(engine.state.calls.filter((call) => call.method === "PUT")).toHaveLength(0)

    activeId = "connection-a"
    const notEnabled = await post(api, "/api/ui/plugins/notes/refresh-scope")
    expect(notEnabled.status).toBe(409)
    expect((await notEnabled.json()).error.code).toBe("not_configured")
    expect(parseJsonc(await readFile(path, "utf8")).mcp.servers.notes).toBeUndefined()
  })

  test("refresh-scope rewrites the MCP env scope for the active connection", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ connectOnAdd: true })
    const repoRoot = await repoRootWith(["notes"])
    const path = await writeConfig(dir, EXISTING_CONFIG)
    let activeId = "connection-a"
    const api = apiFor(engine.url, dir, repoRoot, {
      getConnectionId: () => activeId,
    })

    const enabled = await post(api, "/api/ui/plugins/notes/enable")
    expect(enabled.status).toBe(200)
    const scopedConfig = {
      ...notesConfig(repoRoot),
      env: { OPENCODE_UI_CONNECTION_SCOPE: "connection-a" },
    }
    expect(parseJsonc(await readFile(path, "utf8")).mcp.servers.notes).toEqual(scopedConfig)
    expect(engine.state.calls.filter((call) => call.method === "PUT").at(-1).body).toEqual({ config: scopedConfig })

    activeId = "connection-b"
    const refreshed = await post(api, "/api/ui/plugins/notes/refresh-scope")
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toEqual(settlement({ registered: true, connected: true }))
    const nextConfig = {
      ...notesConfig(repoRoot),
      env: { OPENCODE_UI_CONNECTION_SCOPE: "connection-b" },
    }
    expect(parseJsonc(await readFile(path, "utf8")).mcp.servers.notes).toEqual(nextConfig)
    const puts = engine.state.calls.filter((call) => call.method === "PUT")
    expect(puts).toHaveLength(2)
    expect(puts[1].body).toEqual({ config: nextConfig })
    expect(parseJsonc(await readFile(path, "utf8")).mcp.servers.healthvault).toEqual(HEALTHVAULT)
  })

  test("rejects wrong verbs and unknown endpoints", async () => {
    const dir = await configDir()
    const engine = fakeEngine({})
    const api = apiFor(engine.url, dir)
    for (const path of [
      "/api/ui/plugins/notes/enable",
      "/api/ui/plugins/notes/disable",
      "/api/ui/plugins/notes/refresh-scope",
    ]) {
      const response = await get(api, path)
      expect(response.status).toBe(405)
    }
    const unknown = await get(api, "/api/ui/plugins/notes/bogus")
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).error.code).toBe("not_found")
    const unknownPlugin = await post(api, "/api/ui/plugins/bogus/enable")
    expect(unknownPlugin.status).toBe(404)
    expect((await unknownPlugin.json()).error.code).toBe("not_found")
    const listPost = await post(api, "/api/ui/plugins")
    expect(listPost.status).toBe(405)
  })
})

describe("config write coordination", () => {
  test("re-checks the snapshot on the no-op path and retries", async () => {
    const dir = await configDir()
    const repoRoot = await repoRootWith(["notes"])
    const path = await writeConfig(dir, {
      theme: "dark",
      mcp: { servers: { notes: notesConfig(repoRoot) } },
    })
    const engine = fakeEngine({ connectOnAdd: true })
    let injected = false
    const api = apiFor(engine.url, dir, repoRoot, {
      beforeConfigCommit: async () => {
        if (injected) return
        injected = true
        await writeFile(path, `{\n  // external removal\n  "theme": "light"\n}\n`)
      },
    })

    const response = await post(api, "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    const parsed = parseJsonc(await readFile(path, "utf8"))
    expect(parsed.theme).toBe("light")
    expect(parsed.mcp.servers.notes).toEqual(notesConfig(repoRoot))
  })

  test("fails within the bounded wait when a live process holds the writer lock", async () => {
    const dir = await configDir()
    await writeConfig(dir, EXISTING_CONFIG)
    const lockPath = join(dir, ".opencode-ui-config.lock")
    const lockText = JSON.stringify({ pid: process.pid, host: hostname(), token: "other-process" })
    await writeFile(lockPath, lockText)

    const engine = fakeEngine({ connectOnAdd: true })
    const api = apiFor(engine.url, dir, undefined, { configLockTimeoutMs: 100 })
    const response = await post(api, "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe("config_write_failed")
    expect(await readFile(lockPath, "utf8")).toBe(lockText)
    expect(await readFile(join(dir, "opencode.jsonc"), "utf8")).toBe(EXISTING_CONFIG)
    expect(engine.state.calls).toHaveLength(0)
  })

  test("fails closed on a stale lock from a crashed process and leaves it for manual recovery", async () => {
    const dir = await configDir()
    const lockPath = join(dir, ".opencode-ui-config.lock")
    const lockText = JSON.stringify({
      pid: 2147483646,
      host: hostname(),
      token: "dead-process",
      createdAt: "2020-01-01T00:00:00.000Z",
    })
    await writeFile(lockPath, lockText)

    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(
      apiFor(engine.url, dir, undefined, { configLockTimeoutMs: 100 }),
      "/api/ui/plugins/notes/enable"
    )
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe("config_write_failed")
    expect(body.error.message).toContain(lockPath)
    expect(body.error.message).toContain("remove")
    // A stale lock says nothing about a live process, and is never reclaimed.
    expect(body.error.message).not.toContain("Another process is editing")
    expect(body.error.message).not.toContain("OpenCode UI process is running")
    expect(await readFile(lockPath, "utf8")).toBe(lockText)
    expect(engine.state.calls).toHaveLength(0)
  })

  test("fails closed on a partial lock file without editing the config", async () => {
    const dir = await configDir()
    await writeConfig(dir, EXISTING_CONFIG)
    const lockPath = join(dir, ".opencode-ui-config.lock")
    const partial = '{"pid":'
    await writeFile(lockPath, partial)

    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(
      apiFor(engine.url, dir, undefined, { configLockTimeoutMs: 100 }),
      "/api/ui/plugins/notes/enable"
    )
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe("config_write_failed")
    expect(await readFile(lockPath, "utf8")).toBe(partial)
    expect(await readFile(join(dir, "opencode.jsonc"), "utf8")).toBe(EXISTING_CONFIG)
    expect(engine.state.calls).toHaveLength(0)
  })

  test("removes its lock and private temp file after a successful write", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    const leftovers = (await readdir(dir)).filter((name) =>
      name.includes(".opencode-ui-config.lock")
    )
    expect(leftovers).toEqual([])
  })

  test("does not create a missing config directory for a no-op disable", async () => {
    const root = await configDir()
    const missing = join(root, "missing", "nested")
    const engine = fakeEngine({})
    const response = await post(apiFor(engine.url, missing), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(settlement())
    await expect(stat(missing)).rejects.toThrow()
  })

  test("disable without a config directory still compensates the engine", async () => {
    const root = await configDir()
    const missing = join(root, "missing", "nested")
    const repoRoot = await repoRootWith(["notes"])
    const engine = fakeEngine({
      servers: [{ name: "notes", status: { status: "connected" } }],
    })
    const response = await post(
      apiFor(engine.url, missing, repoRoot),
      "/api/ui/plugins/notes/disable"
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(settlement())
    expect(engine.state.servers).toEqual([])
    await expect(stat(missing)).rejects.toThrow()
  })

  test("does not delete a lock it no longer owns", async () => {
    const dir = await configDir()
    await writeConfig(dir, EXISTING_CONFIG)
    const repoRoot = await repoRootWith(["notes"])
    const lockPath = join(dir, ".opencode-ui-config.lock")
    const replacement = "replacement-lock\n"
    const engine = fakeEngine({ connectOnAdd: true })
    const api = apiFor(engine.url, dir, repoRoot, {
      beforeConfigCommit: async () => {
        await unlink(lockPath)
        await writeFile(lockPath, replacement)
      },
    })

    const response = await post(api, "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await readFile(lockPath, "utf8")).toBe(replacement)
  })

  test("re-reads a concurrent external config change before committing", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, EXISTING_CONFIG)
    const repoRoot = await repoRootWith(["notes"])
    const engine = fakeEngine({ connectOnAdd: true })
    let injected = false
    const api = apiFor(engine.url, dir, repoRoot, {
      beforeConfigCommit: async () => {
        if (injected) return
        injected = true
        await writeFile(path, `{\n  // external edit\n  "theme": "light"\n}\n`)
      },
    })

    const response = await post(api, "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    const parsed = parseJsonc(await readFile(path, "utf8"))
    expect(parsed.theme).toBe("light")
    expect(parsed.mcp.servers.notes).toEqual(notesConfig(repoRoot))
  })

  test("serializes enable/disable config and engine ordering", async () => {
    const dir = await configDir()
    const unrelated = { ...HEALTHVAULT, env: { HEALTHVAULT_MODE: "keep" } }
    const path = await writeConfig(dir, `{
  // top-level comment survives
  "theme": "dark",
  "mcp": {
    "servers": {
      // healthvault must keep working
      "healthvault": {
        "type": "local",
        "command": ["bun", "/srv/healthvault.ts"],
        "disabled": false,
        "env": { "HEALTHVAULT_MODE": "keep" }
      }
    }
  }
}
`)
    const repoRoot = await repoRootWith(["notes"])
    // The engine applies a PUT slowly, so an unordered hot apply lets a later
    // disable's DELETE overtake the enable that is still in flight.
    const engine = fakeEngine({ connectOnAdd: true, putDelayMs: 150 })
    const api = apiFor(engine.url, dir, repoRoot)

    const enabling = post(api, "/api/ui/plugins/notes/enable")
    // Let the enable commit the config and enter its hot apply, then race it.
    await Bun.sleep(50)
    const disabling = post(api, "/api/ui/plugins/notes/disable")

    const enabled = await enabling
    const disabled = await disabling
    expect(enabled.status).toBe(200)
    expect(await enabled.json()).toEqual({
      registered: true,
      connected: true,
      restartRequired: false,
      engineSynced: true,
    })
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toEqual(settlement())

    const text = await readFile(path, "utf8")
    expect(text).toContain("// top-level comment survives")
    expect(text).toContain("// healthvault must keep working")
    const parsed = parseJsonc(text)
    expect(parsed.theme).toBe("dark")
    // Unrelated servers keep their own environment untouched.
    expect(parsed.mcp.servers.healthvault).toEqual(unrelated)
    expect(parsed.mcp.servers.notes).toBeUndefined()
    expect(engine.state.servers.find((entry) => entry.name === "notes")).toBeUndefined()
    expect(engine.state.applied).toEqual([
      { method: "PUT", id: "notes" },
      { method: "DELETE", id: "notes" },
    ])
  })

  test("surfaces an engine removal a disable could not confirm, then compensates", async () => {
    const dir = await configDir()
    await writeConfig(dir, { mcp: { servers: { notes: notesConfig() } } })
    const engine = fakeEngine({
      servers: [{ name: "notes", status: { status: "connected" } }],
      rejectDelete: true,
    })
    const api = apiFor(engine.url, dir)

    const response = await post(api, "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      registered: false,
      connected: true,
      restartRequired: false,
      engineSynced: false,
    })

    // The list must carry the same residual instead of looking merely
    // "connected" while the persisted config is disabled.
    const listed = (await (await get(api)).json()).plugins[0]
    expect(listed).toMatchObject({
      configured: false,
      registered: false,
      connected: true,
      restartRequired: false,
      engineSynced: false,
    })

    // A retry disable only has to compensate the engine; the config is already
    // authoritative and must stay untouched.
    engine.state.rejectDelete = false
    const retry = await post(api, "/api/ui/plugins/notes/disable")
    expect(await retry.json()).toEqual(settlement())
    expect(engine.state.servers).toEqual([])
    const healed = (await (await get(api)).json()).plugins[0]
    expect(healed).toMatchObject({ configured: false, engineSynced: true })
  })

  test("reports a configured plugin the engine no longer holds as out of sync", async () => {
    const dir = await configDir()
    await writeConfig(dir, { mcp: { servers: { notes: notesConfig() } } })
    const engine = fakeEngine({ servers: [] })
    const payload = await (await get(apiFor(engine.url, dir))).json()
    expect(payload.plugins[0]).toMatchObject({
      configured: true,
      registered: true,
      connected: false,
      restartRequired: true,
      engineSynced: false,
    })
  })

  test("bounds the engine reconcile and releases the config lock first", async () => {
    const dir = await configDir()
    const repoRoot = await repoRootWith(["notes"])
    const engine = fakeEngine({ hangPut: true })
    const api = apiFor(engine.url, dir, repoRoot, {
      timeoutMs: 2000,
      hotApplyTimeoutMs: 120,
    })

    const startedAt = Date.now()
    const enabling = post(api, "/api/ui/plugins/notes/enable")
    // The engine call is in flight: the cooperative config lock must already
    // be released so another process/plugin is not starved behind it.
    await waitFor(() => engine.state.calls.some((call) => call.method === "PUT"))
    await expect(readFile(join(dir, ".opencode-ui-config.lock"), "utf8")).rejects.toThrow()

    const response = await enabling
    const elapsed = Date.now() - startedAt
    expect(response.status).toBe(200)
    // The config commit is authoritative; the stuck engine must not be
    // reported as connected or synchronized.
    expect(await response.json()).toEqual({
      registered: true,
      connected: false,
      restartRequired: true,
      engineSynced: null,
    })
    expect(elapsed).toBeLessThan(1500)
    const parsed = parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8"))
    expect(parsed.mcp.servers.notes).toEqual(notesConfig(repoRoot))
  })

  test("bounds the in-process queue wait from request start", async () => {
    const dir = await configDir()
    await writeConfig(dir, EXISTING_CONFIG)
    const repoRoot = await repoRootWith(["notes"])
    const engine = fakeEngine({ connectOnAdd: true })
    let releaseHold
    const hold = new Promise((resolveHold) => {
      releaseHold = resolveHold
    })
    let firstCommit = true
    let holdDone = false
    let overtook = false
    const heldApi = apiFor(engine.url, dir, repoRoot, {
      configLockTimeoutMs: 150,
      beforeConfigCommit: async () => {
        if (!firstCommit) return
        firstCommit = false
        await hold
        holdDone = true
      },
    })

    const held = post(heldApi, "/api/ui/plugins/notes/enable")
    await Bun.sleep(20)
    const blocked = await post(heldApi, "/api/ui/plugins/notes/disable")
    expect(blocked.status).toBe(500)
    expect((await blocked.json()).error.code).toBe("config_write_failed")

    // A later request arrives while the first still holds the section. The
    // timed-out waiter keeps its place, so this must not overtake the head.
    const follower = post(
      apiFor(engine.url, dir, repoRoot, {
        beforeConfigCommit: async () => {
          if (!holdDone) overtook = true
        },
      }),
      "/api/ui/plugins/notes/enable"
    )
    await Bun.sleep(120)
    expect(overtook).toBe(false)

    releaseHold()
    const heldResponse = await held
    const followerResponse = await follower

    expect(heldResponse.status).toBe(200)
    expect(followerResponse.status).toBe(200)
    // The timed-out request never reached the engine and never wrote config.
    expect(engine.state.calls.some((call) => call.method === "DELETE")).toBe(false)
    const parsed = parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8"))
    expect(parsed.mcp.servers.notes).toEqual(notesConfig(repoRoot))
  })

  test("fails honestly when the config keeps changing underneath", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, EXISTING_CONFIG)
    const engine = fakeEngine({ connectOnAdd: true })
    let counter = 0
    const api = apiFor(engine.url, dir, undefined, {
      beforeConfigCommit: async () => {
        counter += 1
        await writeFile(path, `{\n  // external ${counter}\n}\n`)
      },
    })

    const response = await post(api, "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe("config_write_failed")
    expect(engine.state.calls.some((call) => call.method === "PUT")).toBe(false)
    expect(await readFile(path, "utf8")).toContain("// external 3")
    await expect(readFile(join(dir, ".opencode-ui-config.lock"), "utf8")).rejects.toThrow()
  })
})
