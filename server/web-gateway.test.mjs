import { describe, expect, test } from "bun:test"
import { createWebGateway } from "./web-gateway.ts"

const handler = (name) => () => new Response(name)
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
})
