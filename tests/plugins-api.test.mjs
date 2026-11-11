import { afterEach, describe, expect, test } from "bun:test"
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
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
    rejectAdd: options.rejectAdd ?? false,
    connectOnAdd: options.connectOnAdd ?? false,
    rejectConnect: options.rejectConnect ?? false,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const call = { method: request.method, path: url.pathname, auth: request.headers.get("authorization") }
      state.calls.push(call)
      const notes = state.servers.find((entry) => entry.name === "notes")
      if (request.method === "GET" && url.pathname === "/api/mcp") {
        return Response.json({ location: { directory: "/" }, data: state.servers })
      }
      if (request.method === "PUT" && url.pathname === "/api/experimental/mcp/notes") {
        call.body = await request.json()
        if (state.rejectAdd) return new Response("nope", { status: 400 })
        state.servers = state.servers.filter((entry) => entry.name !== "notes")
        state.servers.push({ name: "notes", status: { status: state.connectOnAdd ? "connected" : "pending" } })
        return new Response(null, { status: 204 })
      }
      if (request.method === "POST" && url.pathname === "/api/experimental/mcp/notes/connect") {
        if (!notes) return new Response("missing", { status: 404 })
        if (state.rejectConnect) return new Response("nope", { status: 500 })
        notes.status = { status: "connected" }
        return new Response(null, { status: 204 })
      }
      if (request.method === "DELETE" && url.pathname === "/api/experimental/mcp/notes") {
        if (!notes) return new Response("missing", { status: 404 })
        state.servers = state.servers.filter((entry) => entry.name !== "notes")
        return new Response(null, { status: 204 })
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

function notesConfig(repoRoot = "/srv/opencode-ui") {
  return {
    type: "local",
    command: [process.execPath, resolve(repoRoot, "plugins/notes/src/mcp/main.ts")],
    disabled: false,
    codemode: false,
  }
}

function apiFor(url, configDirectory, repoRoot = "/srv/opencode-ui") {
  if (!configDirectory) throw new Error("tests must pass an isolated config directory")
  return createPluginsApi({
    engineUrl: url,
    authorization,
    repoRoot,
    timeoutMs: 1000,
    env: { OPENCODE_CONFIG_DIR: configDirectory },
  })
}

function get(api, path = "/api/ui/plugins") {
  return api.handleRequest(new Request(`http://localhost${path}`, { method: "GET" }))
}

function post(api, path) {
  return api.handleRequest(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }))
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
      plugins: [{
        id: "notes",
        name: "Notes",
        description: "Project notes, planning and daily logs for agents and humans.",
        registered: true,
        connected: true,
        restartRequired: false,
      }],
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
      plugins: [{
        id: "notes",
        name: "Notes",
        description: "Project notes, planning and daily logs for agents and humans.",
        registered: true,
        connected: false,
        restartRequired: true,
      }],
    })
  })

  test("reports the engine's connection independently of the config entry", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "connected" } }] })
    const payload = await (await get(apiFor(engine.url, dir))).json()
    expect(payload.plugins[0]).toMatchObject({ registered: false, connected: true, restartRequired: false })
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

  test("enable writes the notes entry and preserves JSONC comments and other servers", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, EXISTING_CONFIG)
    const engine = fakeEngine({ connectOnAdd: true })
    const repoRoot = "/srv/opencode-ui"
    const response = await post(apiFor(engine.url, dir, repoRoot), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false })

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
    expect(await second.json()).toEqual({ registered: true, connected: true, restartRequired: false })
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
    expect(await response.json()).toEqual({ registered: true, connected: false, restartRequired: true })
    expect(parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8")).mcp.servers.notes).toEqual(notesConfig())
  })

  test("enable reports restartRequired when the engine cannot connect the server", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ rejectConnect: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: true, connected: false, restartRequired: true })
    expect(parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8")).mcp.servers.notes).toEqual(notesConfig())
  })

  test("enable does not reconnect a server the engine already connected", async () => {
    const dir = await configDir()
    const engine = fakeEngine({ connectOnAdd: true })
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/enable")
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false })
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
    expect(await response.json()).toEqual({ registered: false })

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
    expect(await response.json()).toEqual({ registered: false })
    expect(await readFile(path, "utf8")).toBe(EXISTING_CONFIG)
  })

  test("disable treats a missing config file as success", async () => {
    const dir = await configDir()
    const engine = fakeEngine({})
    const response = await post(apiFor(engine.url, dir), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: false })
  })

  test("disable succeeds when the engine is unreachable", async () => {
    const dir = await configDir()
    const path = await writeConfig(dir, { mcp: { servers: { notes: notesConfig() } } })
    const engine = fakeEngine({})
    const url = engine.url
    await engine.stop()
    const response = await post(apiFor(url, dir), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: false })
    expect(parseJsonc(await readFile(path, "utf8")).mcp.servers.notes).toBeUndefined()
  })

  test("rejects wrong verbs and unknown endpoints", async () => {
    const dir = await configDir()
    const engine = fakeEngine({})
    const api = apiFor(engine.url, dir)
    for (const path of ["/api/ui/plugins/notes/enable", "/api/ui/plugins/notes/disable"]) {
      const response = await get(api, path)
      expect(response.status).toBe(405)
    }
    const unknown = await get(api, "/api/ui/plugins/notes/bogus")
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).error.code).toBe("not_found")
    const listPost = await post(api, "/api/ui/plugins")
    expect(listPost.status).toBe(405)
  })
})
