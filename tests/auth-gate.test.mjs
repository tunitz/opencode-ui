import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createAuthApiHandler } from "../server/auth-api.ts"
import { createAuthGate, createAuthService } from "../server/auth.ts"
import { createBunApplication } from "../server/bun-application.ts"
import { createWebGateway } from "../server/web-gateway.ts"

const ORIGIN = "http://trusted.test"
const dirs = []
const servers = []
afterEach(async () => {
  while (servers.length) await servers.pop().stop(true)
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true })
})

async function assets() {
  const dir = await mkdtemp("/tmp/opencode/auth-gate-")
  dirs.push(dir)
  await writeFile(join(dir, "index.html"), "<!doctype html><html><body>app</body></html>")
  return dir
}

async function stateFile() {
  const dir = await mkdtemp("/tmp/opencode/auth-state-")
  dirs.push(dir)
  return join(dir, "auth", "state.json")
}

async function serve(auth) {
  const directory = await assets()
  const notifications = {
    handleRequest: async () => new Response(JSON.stringify({ ready: true }), { headers: { "content-type": "application/json" } }),
  }
  const stub = { handleRequest: async () => new Response("stub") }
  const app = createBunApplication({
    target: "http://127.0.0.1:1",
    authorization: "Basic test-value",
    directory,
    security: { allowedHosts: ["127.0.0.1"], allowedOrigins: [ORIGIN] },
    agents: stub,
    artifacts: stub,
    notifications,
    auth,
  })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket: app.websocket })
  servers.push({ stop: async () => { app.dispose(); await server.stop(true) } })
  const base = `http://127.0.0.1:${server.port}`
  const request = (path, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { origin: ORIGIN, ...init.headers },
  })
  return { base, request }
}

const jsonBody = (body, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

const cookieOf = (response) => {
  const header = response.headers.get("set-cookie")
  expect(header).toBeTruthy()
  return header.split(";", 1)[0]
}

describe("gating inactive", () => {
  test("loopback without a password passes every request through", async () => {
    const auth = createAuthService({ stateFile: await stateFile(), failureDelayMs: 0 })
    const { request } = await serve(auth)
    expect(await (await request("/")).text()).toContain("app")
    expect((await request("/api/ui/notifications/state")).status).toBe(200)
    expect(await (await request("/api/ui/auth/status")).json()).toEqual({
      configured: false,
      required: false,
      authenticated: true,
    })
  })
})

describe("gating required without a password", () => {
  test("API requests require setup while static assets and auth endpoints stay open", async () => {
    const auth = createAuthService({ stateFile: await stateFile(), required: true, failureDelayMs: 0 })
    const { request } = await serve(auth)

    for (const path of ["/api/event", "/api/ui/notifications/state"]) {
      const response = await request(path)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: { code: "setup_required" } })
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
    expect((await request("/")).status).toBe(200)
    expect(await (await request("/api/ui/auth/status")).json()).toEqual({
      configured: false,
      required: true,
      authenticated: false,
    })

    const invalid = await request("/api/ui/auth/setup", jsonBody({ password: "short" }))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: { code: "invalid" } })

    const oversized = await request("/api/ui/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "a".repeat(9 * 1024) }),
    })
    expect(oversized.status).toBe(413)
  })
})

describe("auth lifecycle over HTTP", () => {
  test("setup, session, login, change, logout and removal", async () => {
    const auth = createAuthService({ stateFile: await stateFile(), required: true, failureDelayMs: 0 })
    const { request } = await serve(auth)

    const setup = await request("/api/ui/auth/setup", jsonBody({ password: "correct horse" }))
    expect(setup.status).toBe(200)
    expect(await setup.json()).toEqual({ ok: true })
    const cookie = cookieOf(setup)
    expect(setup.headers.get("set-cookie")).toContain("HttpOnly")
    expect(setup.headers.get("set-cookie")).toContain("SameSite=Lax")
    expect(setup.headers.get("set-cookie")).toContain("Max-Age=2592000")
    expect(setup.headers.get("set-cookie")).not.toContain("Secure")

    const anonymousLogout = await request("/api/ui/auth/logout", { method: "POST" })
    expect(anonymousLogout.status).toBe(204)

    expect((await request("/api/ui/notifications/state")).status).toBe(401)
    expect((await request("/api/event")).status).toBe(401)
    expect(await (await request("/api/event")).json()).toEqual({ error: { code: "auth_required" } })
    expect((await request("/api/ui/notifications/state", { headers: { cookie } })).status).toBe(200)
    expect(await (await request("/api/ui/auth/status", { headers: { cookie } })).json()).toEqual({
      configured: true,
      required: true,
      authenticated: true,
    })

    const duplicate = await request("/api/ui/auth/setup", jsonBody({ password: "another horse" }))
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: { code: "already_configured" } })

    const wrongLogin = await request("/api/ui/auth/login", jsonBody({ password: "wrong horse" }))
    expect(wrongLogin.status).toBe(401)
    expect(await wrongLogin.json()).toEqual({ error: { code: "invalid_credentials" } })

    const login = await request("/api/ui/auth/login", jsonBody({ password: "correct horse" }))
    expect(login.status).toBe(200)
    const otherCookie = cookieOf(login)

    const gate = await request("/api/ui/auth/password", jsonBody({ current: "correct horse", next: "new horse" }, "PUT"))
    expect(gate.status).toBe(401)
    expect(await gate.json()).toEqual({ error: { code: "auth_required" } })

    const wrongCurrent = await request("/api/ui/auth/password", {
      ...jsonBody({ current: "wrong horse", next: "new horse" }, "PUT"),
      headers: { "content-type": "application/json", cookie },
    })
    expect(wrongCurrent.status).toBe(401)
    expect(await wrongCurrent.json()).toEqual({ error: { code: "invalid_credentials" } })

    const changed = await request("/api/ui/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ current: "correct horse", next: "new horse" }),
    })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toEqual({ ok: true })
    expect((await request("/api/ui/notifications/state", { headers: { cookie } })).status).toBe(200)
    expect((await request("/api/ui/notifications/state", { headers: { cookie: otherCookie } })).status).toBe(401)
    expect((await request("/api/ui/auth/login", jsonBody({ password: "correct horse" }))).status).toBe(401)
    expect((await request("/api/ui/auth/login", jsonBody({ password: "new horse" }))).status).toBe(200)

    const removal = await request("/api/ui/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ current: "new horse", next: "" }),
    })
    expect(removal.status).toBe(409)
    expect(await removal.json()).toEqual({ error: { code: "password_required" } })

    const logout = await request("/api/ui/auth/logout", { method: "POST", headers: { cookie } })
    expect(logout.status).toBe(204)
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0")
    expect((await request("/api/ui/notifications/state", { headers: { cookie } })).status).toBe(401)
  })

  test("unknown auth paths are gated", async () => {
    const auth = createAuthService({ stateFile: await stateFile(), required: true, failureDelayMs: 0 })
    const { request } = await serve(auth)
    const response = await request("/api/ui/auth/unknown")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: { code: "setup_required" } })
  })
})

describe("WebSocket upgrades", () => {
  const handler = (name) => async () => new Response(name)

  test("require the session cookie while static paths stay open", async () => {
    const auth = createAuthService({ stateFile: await stateFile(), required: true, failureDelayMs: 0 })
    let upgraded = false
    const gateway = createWebGateway({
      authGate: createAuthGate(auth),
      auth: createAuthApiHandler(auth),
      agents: handler("agents"), artifacts: handler("artifacts"), notifications: handler("notifications"),
      engine: handler("engine"), frontend: handler("frontend"),
      bridge: { upgrade: async () => { upgraded = true; return new Response(null, { status: 400 }) } },
    })
    const server = { timeout() {} }
    const upgrade = (cookie) => gateway(new Request("http://127.0.0.1/api/pty/id/connect", {
      headers: { upgrade: "websocket", ...(cookie ? { cookie } : {}) },
    }), server)

    const denied = await upgrade()
    expect(denied.status).toBe(401)
    expect(await denied.text()).toBe("")
    expect(upgraded).toBe(false)

    const setup = await gateway(new Request("http://127.0.0.1/api/ui/auth/setup", {
      method: "POST",
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "correct horse" }),
    }), server)
    expect(setup.status).toBe(200)
    const cookie = cookieOf(setup).split("=", 2)[1]

    expect((await upgrade()).status).toBe(401)
    expect(upgraded).toBe(false)

    const allowed = await upgrade(`opencode_ui_session=${cookie}`)
    expect(allowed.status).toBe(400)
    expect(upgraded).toBe(true)

    const staticResponse = await gateway(new Request("http://127.0.0.1/", { headers: { host: "127.0.0.1" } }), server)
    expect(await staticResponse.text()).toBe("frontend")
  })
})
