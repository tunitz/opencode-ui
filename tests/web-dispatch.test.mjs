import { describe, expect, test } from "bun:test"
import { createWebDispatcher } from "../server/web-dispatch.ts"

const handler = (name) => async () => new Response(name)
const dispatch = createWebDispatcher({
  security: { allowedHosts: ["example.test"], allowedOrigins: ["https://example.test"] },
  agents: handler("agents"), notifications: handler("notifications"), artifacts: handler("artifacts"),
  engine: handler("engine"), frontend: handler("frontend"),
})
const request = (path, init = {}) => new Request(`https://example.test${path}`, {
  ...init, headers: { host: "example.test", origin: "https://example.test", ...init.headers },
})

describe("Web gateway dispatch", () => {
  test("dispatches specific UI handlers before artifacts and engine", async () => {
    for (const [path, expected] of [["/api/ui/agents", "agents"], ["/api/ui/notifications/state", "notifications"], ["/api/ui/artifacts/resolve", "artifacts"], ["/api/event", "engine"], ["/", "frontend"]]) {
      expect(await (await dispatch(request(path))).text()).toBe(expected)
    }
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
  test("routes permitted notes RPC to the engine with no-store", async () => {
    const response = await dispatch(request("/api/rpc/opencode-notes/list", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }))
    expect(await response.text()).toBe("engine")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
