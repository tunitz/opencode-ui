import { afterEach, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { createPluginsApi } from "../server/plugins-api.ts"

const servers = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

const authorization = "Basic fake-test-credential"

function fakeEngine(options = {}) {
  const state = {
    servers: options.servers ?? [],
    calls: [],
    rejectAdd: options.rejectAdd ?? false,
    connectOnAdd: options.connectOnAdd ?? false,
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
        if (state.rejectAdd) return new Response("nope", { status: 400 })
        call.body = await request.json()
        state.servers = state.servers.filter((entry) => entry.name !== "notes")
        state.servers.push({ name: "notes", status: { status: state.connectOnAdd ? "connected" : "pending" } })
        return new Response(null, { status: 204 })
      }
      if (request.method === "POST" && url.pathname === "/api/experimental/mcp/notes/connect") {
        if (!notes) return new Response("missing", { status: 404 })
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

function apiFor(url, repoRoot = "/srv/opencode-ui") {
  return createPluginsApi({ engineUrl: url, authorization, repoRoot, timeoutMs: 1000 })
}

function get(api, path = "/api/ui/plugins") {
  return api.handleRequest(new Request(`http://localhost${path}`, { method: "GET" }))
}

function post(api, path) {
  return api.handleRequest(new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }))
}

describe("Plugins HTTP API", () => {
  test("maps the engine MCP list onto the notes plugin status", async () => {
    const engine = fakeEngine({
      servers: [
        { name: "notes", status: { status: "connected" } },
        { name: "other", status: { status: "pending" } },
      ],
    })
    const response = await get(apiFor(engine.url))
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

  test("reports a registered but disconnected server as needing a restart", async () => {
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "pending" } }] })
    const payload = await (await get(apiFor(engine.url))).json()
    expect(payload.plugins[0]).toMatchObject({ registered: true, connected: false, restartRequired: true })
  })

  test("treats an unknown engine payload shape as not registered", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: () => Response.json({ unexpected: true }),
    })
    servers.push(server)
    const payload = await (await get(apiFor(`http://127.0.0.1:${server.port}`))).json()
    expect(payload.engineAvailable).toBe(true)
    expect(payload.plugins[0]).toMatchObject({ registered: false, connected: false, restartRequired: false })
  })

  test("enables the notes MCP server with an absolute bun command and connects it", async () => {
    const engine = fakeEngine({ servers: [] })
    const repoRoot = "/srv/opencode-ui"
    const response = await post(apiFor(engine.url, repoRoot), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false })

    const add = engine.state.calls.find((call) => call.method === "PUT")
    expect(add.path).toBe("/api/experimental/mcp/notes")
    expect(add.auth).toBe(authorization)
    expect(add.body).toEqual({
      config: {
        type: "local",
        command: ["bun", resolve(repoRoot, "plugins/notes/src/mcp/main.ts")],
        disabled: false,
        codemode: false,
      },
    })
    expect(engine.state.calls.some((call) => call.method === "POST" && call.path.endsWith("/connect"))).toBe(true)
  })

  test("does not reconnect a server the engine already connected", async () => {
    const engine = fakeEngine({ servers: [], connectOnAdd: true })
    const response = await post(apiFor(engine.url), "/api/ui/plugins/notes/enable")
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false })
    expect(engine.state.calls.some((call) => call.method === "POST")).toBe(false)
  })

  test("re-enables an already registered server idempotently", async () => {
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "disabled" } }] })
    const response = await post(apiFor(engine.url), "/api/ui/plugins/notes/enable")
    expect(await response.json()).toEqual({ registered: true, connected: true, restartRequired: false })
    expect(engine.state.calls.filter((call) => call.method === "PUT")).toHaveLength(1)
  })

  test("disables the notes MCP server through the engine API", async () => {
    const engine = fakeEngine({ servers: [{ name: "notes", status: { status: "connected" } }] })
    const api = apiFor(engine.url)
    const response = await post(api, "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: false })
    const remove = engine.state.calls.find((call) => call.method === "DELETE")
    expect(remove.path).toBe("/api/experimental/mcp/notes")
    expect(remove.auth).toBe(authorization)
    const payload = await (await get(api)).json()
    expect(payload.plugins[0].registered).toBe(false)
  })

  test("treats an already absent server as disabled", async () => {
    const engine = fakeEngine({ servers: [] })
    const response = await post(apiFor(engine.url), "/api/ui/plugins/notes/disable")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ registered: false })
  })

  test("reports an unreachable engine without failing the list", async () => {
    const engine = fakeEngine({})
    const url = engine.url
    await engine.stop()
    const api = apiFor(url)
    const list = await get(api)
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({
      engineAvailable: false,
      plugins: [{
        id: "notes",
        name: "Notes",
        description: "Project notes, planning and daily logs for agents and humans.",
        registered: false,
        connected: false,
        restartRequired: false,
      }],
    })
    for (const path of ["/api/ui/plugins/notes/enable", "/api/ui/plugins/notes/disable"]) {
      const response = await post(api, path)
      expect(response.status).toBe(502)
      const payload = await response.json()
      expect(payload.error.code).toBe("engine_unavailable")
      expect(JSON.stringify(payload)).not.toContain(authorization)
      expect(JSON.stringify(payload)).not.toContain("fake-test-credential")
    }
  })

  test("maps an engine write rejection to 502 without leaking the credential", async () => {
    const engine = fakeEngine({ rejectAdd: true })
    const response = await post(apiFor(engine.url), "/api/ui/plugins/notes/enable")
    expect(response.status).toBe(502)
    const text = await response.text()
    expect(JSON.parse(text).error.code).toBe("engine_rejected")
    expect(text).not.toContain("fake-test-credential")
  })

  test("rejects wrong verbs and unknown endpoints", async () => {
    const engine = fakeEngine({})
    const api = apiFor(engine.url)
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
