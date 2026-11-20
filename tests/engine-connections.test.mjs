import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBunApplication } from "../server/bun-application.ts"
import {
  CONNECTIONS_ROUTE,
  DEFAULT_ENGINE_PROFILE_ID,
  createEngineConnectionsService,
} from "../server/engine-connections.ts"

const cleanup = []

afterEach(async () => {
  while (cleanup.length > 0) {
    const fn = cleanup.pop()
    if (fn) await fn()
  }
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-ui-connections-"))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function makeMockEngine(version, expectedPassword) {
  const expectedAuth = `Basic ${Buffer.from(`opencode:${expectedPassword}`).toString("base64")}`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("authorization") !== expectedAuth) {
        return new Response("Unauthorized", { status: 401 })
      }
      const path = new URL(request.url).pathname
      if (path === "/api/info") {
        return Response.json({ version, pid: process.pid })
      }
      return Response.json({ ok: true, version })
    },
  })
  cleanup.push(() => server.stop(true))
  return {
    url: `http://127.0.0.1:${server.port}`,
    authorization: expectedAuth,
  }
}

function jsonRequest(path, method = "GET", body) {
  return new Request(`http://127.0.0.1:5174${path}`, {
    method,
    headers: {
      host: "127.0.0.1:5174",
      origin: "http://127.0.0.1:5174",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe("engine connections service", () => {
  test("lists startup default without leaking credentials and persists custom profiles with 0600 mode", async () => {
    const dir = await makeTempDir()
    const stateFile = join(dir, "connections.json")
    const engineA = makeMockEngine("2.1.4-a", "secret-a")
    const engineB = makeMockEngine("2.1.4-b", "secret-b")

    const service = createEngineConnectionsService({
      defaultEngineUrl: engineA.url,
      defaultAuthorization: engineA.authorization,
      stateFile,
    })
    await service.init()

    const listRes = await service.handleRequest(jsonRequest(CONNECTIONS_ROUTE))
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.activeId).toBe(DEFAULT_ENGINE_PROFILE_ID)
    expect(listBody.profiles).toHaveLength(1)
    expect(JSON.stringify(listBody)).not.toContain("secret-a")

    // Create a new profile with password auth and activate immediately
    const createRes = await service.handleRequest(
      jsonRequest(CONNECTIONS_ROUTE, "POST", {
        name: "Remote Devbox",
        engineUrl: engineB.url,
        authMode: "password",
        password: "secret-b",
        activate: true,
      })
    )
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.activeId).toBe(created.profile.id)
    expect(created.profile.hasPassword).toBe(true)
    expect(JSON.stringify(created)).not.toContain("secret-b")
    expect(service.getActiveTarget().engineUrl).toBe(engineB.url)

    // File permissions are private 0600
    const info = await stat(stateFile)
    expect(info.mode & 0o777).toBe(0o600)

    // Restarting a fresh service instance restores the saved active profile
    const reloaded = createEngineConnectionsService({
      defaultEngineUrl: engineA.url,
      defaultAuthorization: engineA.authorization,
      stateFile,
    })
    await reloaded.init()
    expect(reloaded.getActiveTarget().engineUrl).toBe(engineB.url)
    expect(reloaded.getActiveTarget().id).toBe(created.profile.id)
  })

  test("refuses credential redirection when URL changes without a new password", async () => {
    const dir = await makeTempDir()
    const stateFile = join(dir, "connections.json")
    const engineA = makeMockEngine("2.1.4-a", "secret-a")
    const engineB = makeMockEngine("2.1.4-b", "secret-b")

    const service = createEngineConnectionsService({
      defaultEngineUrl: engineA.url,
      defaultAuthorization: engineA.authorization,
      stateFile,
    })
    await service.init()

    const created = await (
      await service.handleRequest(
        jsonRequest(CONNECTIONS_ROUTE, "POST", {
          name: "Staging",
          engineUrl: engineB.url,
          authMode: "password",
          password: "secret-b",
        })
      )
    ).json()

    // Attempt to point the existing profile at a new URL without supplying a password
    const badUpdate = await service.handleRequest(
      jsonRequest(`${CONNECTIONS_ROUTE}/${created.profile.id}`, "PUT", {
        engineUrl: "https://other.example.test:4096",
      })
    )
    expect(badUpdate.status).toBe(400)
    expect((await badUpdate.json()).error.code).toBe("credential_required_for_url_change")

    // Attempt to test a different URL reusing profileId's stored password
    const badTest = await service.handleRequest(
      jsonRequest(`${CONNECTIONS_ROUTE}/test`, "POST", {
        profileId: created.profile.id,
        engineUrl: "https://other.example.test:4096",
        authMode: "password",
      })
    )
    expect(badTest.status).toBe(400)
    expect((await badTest.json()).error.code).toBe("credential_required_for_url_change")

    // Updating just the name without changing URL keeps the saved password
    const okRename = await service.handleRequest(
      jsonRequest(`${CONNECTIONS_ROUTE}/${created.profile.id}`, "PUT", {
        name: "Staging Renamed",
      })
    )
    expect(okRename.status).toBe(200)
    expect((await okRename.json()).profile.name).toBe("Staging Renamed")
  })

  test("probes engine reachability and authentication via /test and switches proxy live", async () => {
    const dir = await makeTempDir()
    const stateFile = join(dir, "connections.json")
    const serviceFileB = join(dir, "engine-b-service.json")
    await writeFile(serviceFileB, JSON.stringify({ password: "secret-file-b" }), "utf8")

    const engineA = makeMockEngine("2.1.4-a", "secret-a")
    const engineB = makeMockEngine("2.1.4-b", "secret-file-b")

    const connections = createEngineConnectionsService({
      defaultEngineUrl: engineA.url,
      defaultAuthorization: engineA.authorization,
      stateFile,
    })
    await connections.init()

    let changeCount = 0
    connections.onChange(() => {
      changeCount += 1
    })

    // Test with wrong password -> reachable=true, authenticated=false
    const wrongAuth = await (
      await connections.handleRequest(
        jsonRequest(`${CONNECTIONS_ROUTE}/test`, "POST", {
          engineUrl: engineB.url,
          authMode: "password",
          password: "wrong-password",
        })
      )
    ).json()
    expect(wrongAuth.ok).toBe(false)
    expect(wrongAuth.reachable).toBe(true)
    expect(wrongAuth.authenticated).toBe(false)
    expect(wrongAuth.status).toBe(401)

    // Test with service-file auth -> ok=true, version reported
    const goodTest = await (
      await connections.handleRequest(
        jsonRequest(`${CONNECTIONS_ROUTE}/test`, "POST", {
          engineUrl: engineB.url,
          authMode: "service-file",
          serviceFile: serviceFileB,
        })
      )
    ).json()
    expect(goodTest.ok).toBe(true)
    expect(goodTest.version).toBe("2.1.4-b")

    // Mount in Bun application and verify live proxy switching
    const noopService = { handleRequest: async () => new Response("ok") }
    const app = createBunApplication({
      target: connections.getActiveTarget().engineUrl,
      authorization: connections.getActiveTarget().authorization,
      getTarget: () => {
        const current = connections.getActiveTarget()
        return { target: current.engineUrl, authorization: current.authorization }
      },
      directory: dir,
      security: {
        allowedHosts: ["127.0.0.1"],
        allowedOrigins: ["http://127.0.0.1:5174"],
      },
      agents: noopService,
      artifacts: noopService,
      notifications: noopService,
      connections,
    })
    cleanup.push(() => app.dispose())

    const fakeServer = { upgrade: () => false, timeout: () => {} }
    const infoBefore = await (await app.fetch(jsonRequest("/api/info"), fakeServer)).json()
    expect(infoBefore.version).toBe("2.1.4-a")

    // Create & activate engine B via gateway route
    const created = await (
      await app.fetch(
        jsonRequest(CONNECTIONS_ROUTE, "POST", {
          name: "Local Engine B",
          engineUrl: engineB.url,
          authMode: "service-file",
          serviceFile: serviceFileB,
        }),
        fakeServer
      )
    ).json()

    const activateRes = await app.fetch(
      jsonRequest(`${CONNECTIONS_ROUTE}/${created.profile.id}/activate`, "POST", {}),
      fakeServer
    )
    expect(activateRes.status).toBe(200)
    expect(changeCount).toBe(1)

    // Proxy immediately serves engine B
    const infoAfter = await (await app.fetch(jsonRequest("/api/info"), fakeServer)).json()
    expect(infoAfter.version).toBe("2.1.4-b")

    // Deleting active profile is refused
    const deleteActive = await app.fetch(
      jsonRequest(`${CONNECTIONS_ROUTE}/${created.profile.id}`, "DELETE"),
      fakeServer
    )
    expect(deleteActive.status).toBe(409)

    // Switching back to default succeeds, then deleting B succeeds
    const switchDefault = await app.fetch(
      jsonRequest(`${CONNECTIONS_ROUTE}/${DEFAULT_ENGINE_PROFILE_ID}/activate`, "POST", {}),
      fakeServer
    )
    expect(switchDefault.status).toBe(200)
    const infoBack = await (await app.fetch(jsonRequest("/api/info"), fakeServer)).json()
    expect(infoBack.version).toBe("2.1.4-a")

    const deleteB = await app.fetch(
      jsonRequest(`${CONNECTIONS_ROUTE}/${created.profile.id}`, "DELETE"),
      fakeServer
    )
    expect(deleteB.status).toBe(200)
    const savedRaw = await readFile(stateFile, "utf8")
    expect(JSON.parse(savedRaw).profiles).toHaveLength(0)
  })
})
