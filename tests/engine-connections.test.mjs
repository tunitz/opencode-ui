import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBunApplication } from "../server/bun-application.ts"
import { CONNECTIONS_ROUTE, createEngineConnectionsService } from "../server/engine-connections.ts"

const cleanup = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()()
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-ui-connections-"))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function makeMockEngine(version, password) {
  const expectedAuth = password ? `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` : null
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("authorization") !== expectedAuth) {
        return new Response("Unauthorized", { status: 401 })
      }
      return Response.json({ version })
    },
  })
  cleanup.push(() => server.stop(true))
  return `http://127.0.0.1:${server.port}`
}

const origin = "http://127.0.0.1:5174"
const endpoint = (id) => `${CONNECTIONS_ROUTE}/${id}`
function jsonRequest(path, method = "GET", body) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      host: "127.0.0.1:5174",
      origin,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe("engine connections service", () => {
  test("starts empty and persists the first saved profile privately", async () => {
    const stateFile = join(await makeTempDir(), "connections.json")
    const engineUrl = makeMockEngine("2.1.4-protected", "secret")
    const service = createEngineConnectionsService({ stateFile, suggestedEngineUrl: engineUrl })
    const request = (...args) => service.handleRequest(jsonRequest(...args))

    expect(await (await request(CONNECTIONS_ROUTE)).json()).toEqual({
      activeId: null, active: null, profiles: [], suggestedEngineUrl: engineUrl,
    })
    expect(service.getActiveTarget()).toBeNull()
    const created = await request(CONNECTIONS_ROUTE, "POST", { name: "Local", engineUrl, password: "secret" })
    expect(created.status).toBe(201)
    const state = await created.json()
    expect(state.activeId).toBe(state.profile.id)
    expect(state.active.hasPassword).toBe(true)
    expect(JSON.stringify(state)).not.toContain("secret")
    expect((await stat(stateFile)).mode & 0o777).toBe(0o600)

    const reloaded = createEngineConnectionsService({ stateFile })
    await reloaded.init()
    expect(reloaded.getActiveTarget().id).toBe(state.activeId)
    expect(reloaded.getActiveTarget().engineUrl).toBe(engineUrl)
    const tested = await reloaded.handleRequest(jsonRequest(endpoint("test"), "POST", { profileId: state.activeId }))
    expect((await tested.json()).ok).toBe(true)
  })

  test("loads legacy profiles without reading their service registration", async () => {
    const stateFile = join(await makeTempDir(), "connections.json")
    await writeFile(stateFile, JSON.stringify({
      version: 1,
      activeId: "default",
      profiles: [{ id: "legacy", name: "Legacy", engineUrl: "http://localhost:4096", authMode: "service-file", serviceFile: "/missing/registration.json" }],
    }))
    const service = createEngineConnectionsService({ stateFile })
    const state = await (await service.handleRequest(jsonRequest(CONNECTIONS_ROUTE))).json()
    expect(state.activeId).toBe("legacy")
    expect(state.active.hasPassword).toBe(false)
    expect(state.active).not.toHaveProperty("serviceFile")
    expect(state.profiles).toHaveLength(1)
  })

  test("requires a password and never reuses a stored password at a different origin", async () => {
    const stateFile = join(await makeTempDir(), "connections.json")
    const engineUrl = makeMockEngine("2.1.4-protected", "secret")
    const otherEngine = makeMockEngine("2.1.4-other", "other-secret")
    const service = createEngineConnectionsService({ stateFile })
    const request = (...args) => service.handleRequest(jsonRequest(...args))
    const { activeId } = await (await request(CONNECTIONS_ROUTE, "POST", { name: "Local", engineUrl, password: "secret" })).json()

    for (const missing of [
      await request(endpoint("test"), "POST", { engineUrl }),
      await request(CONNECTIONS_ROUTE, "POST", { name: "Missing", engineUrl, password: "" }),
      await request(endpoint(activeId), "PUT", { password: "" }),
    ]) {
      expect(missing.status).toBe(400)
      expect((await missing.json()).error.code).toBe("invalid_password")
    }
    const wrong = await request(endpoint("test"), "POST", { profileId: activeId, password: "wrong" })
    expect(await wrong.json()).toMatchObject({ ok: false, reachable: true, authenticated: false, status: 401 })
    for (const response of [
      await request(endpoint(activeId), "PUT", { engineUrl: otherEngine }),
      await request(endpoint("test"), "POST", { profileId: activeId, engineUrl: otherEngine }),
    ]) {
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe("credential_required_for_url_change")
    }
    const renamed = await request(endpoint(activeId), "PUT", { name: "Renamed" })
    expect((await renamed.json()).active).toMatchObject({ name: "Renamed", hasPassword: true })

    const updated = await request(endpoint(activeId), "PUT", { engineUrl: otherEngine, password: "other-secret" })
    expect(updated.status).toBe(200)
    expect((await updated.json()).active).toMatchObject({ hasPassword: true, engineUrl: otherEngine })
    const tested = await request(endpoint("test"), "POST", { profileId: activeId })
    expect((await tested.json()).ok).toBe(true)
  })

  test("keeps the saved connection on failure and handles whitespace copied with a password", async () => {
    const stateFile = join(await makeTempDir(), "connections.json")
    const engineUrl = makeMockEngine("2.1.4-protected", "secret")
    const service = createEngineConnectionsService({ stateFile })
    const request = (...args) => service.handleRequest(jsonRequest(...args))

    const rejected = await request(CONNECTIONS_ROUTE, "POST", { name: "Local", engineUrl, password: "wrong" })
    expect(rejected.status).toBe(422)
    expect((await rejected.json()).error.message).toContain("HTTP 401")
    expect(service.getActiveTarget()).toBeNull()

    const draft = { name: "Local", engineUrl, password: " secret " }
    expect((await (await request(endpoint("test"), "POST", draft)).json()).ok).toBe(true)
    const accepted = await request(CONNECTIONS_ROUTE, "POST", draft)
    expect(accepted.status).toBe(201)
    const { activeId } = await accepted.json()
    const failedUpdate = await request(endpoint(activeId), "PUT", { password: "wrong" })
    expect(failedUpdate.status).toBe(422)
    expect((await (await request(endpoint("test"), "POST", { profileId: activeId })).json()).ok).toBe(true)

    const intentionalSpaces = makeMockEngine("2.1.4-spaces", " secret ")
    const exact = await request(CONNECTIONS_ROUTE, "POST", { ...draft, engineUrl: intentionalSpaces })
    expect(exact.status).toBe(201)
    expect((await (await request(endpoint("test"), "POST", { profileId: (await exact.json()).profile.id })).json()).ok).toBe(true)
  })

  test("tests and proxies authenticated engines, switches live, and returns to no connection after deletion", async () => {
    const directory = await makeTempDir()
    const engineA = makeMockEngine("2.1.4-a", "secret-a")
    const engineB = makeMockEngine("2.1.4-b", "secret-b")
    const connections = createEngineConnectionsService({ stateFile: join(directory, "connections.json") })
    const changes = []
    connections.onChange((target) => changes.push(target?.id ?? null))
    const noopService = { handleRequest: async () => new Response("ok") }
    const app = createBunApplication({
      getTarget: () => {
        const current = connections.getActiveTarget()
        return current ? { target: current.engineUrl, authorization: current.authorization } : null
      },
      directory,
      security: { allowedHosts: ["127.0.0.1"], allowedOrigins: [origin] },
      artifacts: noopService,
      notifications: noopService,
      connections,
    })
    cleanup.push(() => app.dispose())
    const fakeServer = { upgrade: () => false, timeout: () => {} }
    const request = (...args) => app.fetch(jsonRequest(...args), fakeServer)

    expect((await request("/api/info")).status).toBe(503)
    const test = await request(endpoint("test"), "POST", { engineUrl: engineA, password: "secret-a" })
    expect(await test.json()).toMatchObject({ ok: true, version: "2.1.4-a" })
    const first = await request(CONNECTIONS_ROUTE, "POST", { name: "Local", engineUrl: engineA, password: "secret-a" })
    expect(first.status).toBe(201)
    const { activeId: firstId } = await first.json()
    expect(await (await request("/api/info")).json()).toEqual({ version: "2.1.4-a" })

    const second = await request(CONNECTIONS_ROUTE, "POST", { name: "Other", engineUrl: engineB, password: "secret-b" })
    const { profile: { id: secondId } } = await second.json()
    expect((await request(`${endpoint(secondId)}/activate`, "POST", {})).status).toBe(200)
    expect(await (await request("/api/info")).json()).toEqual({ version: "2.1.4-b" })
    expect((await request(endpoint(secondId), "DELETE")).status).toBe(409)

    expect((await request(`${endpoint(firstId)}/activate`, "POST", {})).status).toBe(200)
    expect((await request(endpoint(secondId), "DELETE")).status).toBe(200)
    expect(await (await request(endpoint(firstId), "DELETE")).json()).toEqual({ activeId: null, active: null, profiles: [] })
    expect((await request("/api/info")).status).toBe(503)
    expect(changes).toEqual([firstId, secondId, firstId, null])
  })
})
