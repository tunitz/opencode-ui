import { describe, expect, test } from "bun:test"
import { createWebGateway } from "../server/web-gateway.ts"

const handler = (name) => () => new Response(name)

function mediaGateway(overrides = {}) {
  let calls = 0
  const gateway = createWebGateway({
    security: { allowedHosts: ["localhost"], allowedOrigins: ["http://localhost"] },
      calls += 1
    },
    agents: handler("agent"), artifacts: handler("artifact"), notifications: handler("notification"),
    engine: handler("engine"), frontend: handler("frontend"),
    bridge: { upgrade: async () => new Response(null, { status: 400 }) },
    ...overrides,
  })
}

const mediaRequest = (path, init = {}) => new Request(`http://localhost${path}`, {
  ...init,
  headers: { host: "localhost", origin: "http://localhost", ...init.headers },
})
describe("gateway composition", () => {
  test("routes WebSocket upgrades to the bridge before HTTP dispatch", async () => {
    let called = false
    const gateway = createWebGateway({
      agents: handler("agent"), artifacts: handler("artifact"), notifications: handler("notification"),
      engine: handler("engine"), frontend: handler("frontend"),
      bridge: { upgrade: async () => { called = true; return new Response(null, { status: 403 }) } },
    })
    const response = await gateway(new Request("http://localhost/api/pty/id/connect", { headers: { upgrade: "websocket" } }), { timeout() {} })
    expect(called).toBe(true)
    expect(response.status).toBe(403)
  })
  test("disables timeout for the event stream", async () => {
    let timeout
    const gateway = createWebGateway({
      security: { allowedHosts: ["localhost"] },
      agents: handler("agent"), artifacts: handler("artifact"), notifications: handler("notification"),
      engine: handler("engine"), frontend: handler("frontend"),
      bridge: { upgrade: async () => new Response(null, { status: 400 }) },
    })
    const response = await gateway(new Request("http://localhost/api/event", { headers: { host: "localhost" } }), { timeout(_request, seconds) { timeout = seconds } })
    expect(timeout).toBe(0)
    expect(await response.text()).toBe("engine")
  })
    const gateway = createWebGateway({
      security: { allowedHosts: ["localhost"] },
      agents: handler("agent"), artifacts: handler("artifact"), notifications: handler("notification"),
      engine: handler("engine"), frontend: handler("frontend"),
      bridge: { upgrade: async () => new Response(null, { status: 400 }) },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("vary")).toBe("Origin")
    expect(unknown.status).toBe(404)
  })
    const { gateway, calls, dispose } = mediaGateway()
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(256 * 1024 + 1),
    }), { timeout() {} })
    expect(oversized.status).toBe(413)
    expect(oversized.headers.get("content-type")).toBe("application/json; charset=utf-8")
    expect(oversized.headers.get("cache-control")).toBe("no-store")
    expect(await oversized.json()).toEqual({ error: { code: "payload_too_large" } })

      method: "POST", headers: { "content-type": "text/plain" }, body: "name=x",
    }), { timeout() {} })
    expect(nonJson.status).toBe(415)
    expect(await nonJson.json()).toEqual({
      error: { code: "invalid", message: "Mutations must be sent as JSON" },
    })

      headers: { host: "localhost", origin: "http://evil.test" },
    }), { timeout() {} })
    expect(untrusted.status).toBe(403)
    expect(await untrusted.json()).toEqual({ error: { code: "forbidden" } })
    expect(calls()).toBe(0)
    dispose()
  })
    const { gateway, calls, dispose } = mediaGateway({
      authGate: async () => ({ allowed: false, code: "auth_required" }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: { code: "auth_required" } })
    expect(calls()).toBe(0)
    dispose()
  })
    const notes = { handleRequest: async () => new Response("notes") }
    const { gateway, calls, dispose } = mediaGateway({ notes })
    const oversizedNotes = await gateway(mediaRequest("/api/ui/notes/create", {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1024 * 1024 + 1),
    }), { timeout() {} })
    expect(oversizedNotes.status).toBe(413)
    expect(await oversizedNotes.text()).toBe("Request too large\n")

    const nonJsonNotes = await gateway(mediaRequest("/api/ui/notes/create", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "x",
    }), { timeout() {} })
    expect(nonJsonNotes.status).toBe(415)
    expect(await nonJsonNotes.text()).toBe("Forbidden: browser mutation must be JSON\n")

      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(8 * 1024 + 1),
    }), { timeout() {} })
    expect(collision.status).toBe(413)
    expect(await collision.text()).toBe("Request too large\n")
    expect(calls()).toBe(0)
    dispose()
  })
})
