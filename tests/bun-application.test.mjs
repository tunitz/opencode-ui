import { test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { createBunApplication } from "../server/bun-application.ts"
import { createNotificationService } from "../server/notifications.ts"

test("assembled gateway serves assets, guarded APIs, notifications, streams and PTY frames", async () => {
  const dir = await mkdtemp("/tmp/opencode/bun-gateway-test-")
  let receivedAuth
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      receivedAuth = request.headers.get("authorization")
      if (request.headers.get("upgrade") === "websocket") return server.upgrade(request) ? undefined : new Response(null, { status: 400 })
      return new Response("data: fake-event\n\n", { headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" } })
    },
    websocket: { message(ws, data) { ws.send(data) } },
  })
  const target = `http://127.0.0.1:${upstream.port}`
  const security = { allowedHosts: ["127.0.0.1"], allowedOrigins: ["http://trusted.test"] }
  const notifications = createNotificationService({ stateFile: join(dir, "state.json"), startWatcher: false, opencodeBaseUrl: target, sendPush: async () => {} })
  const stub = { handleRequest: async () => new Response("stub") }
  const app = createBunApplication({ target, authorization: "Basic fake-test-value", directory: "dist-bun-build", security, notifications, agents: stub, artifacts: stub })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket: app.websocket })
  const base = `http://127.0.0.1:${server.port}`
  let ws
  try {
    const html = await fetch(base)
    assert.equal(html.status, 200)
    assert.match(await html.text(), /<html/i)
    const blocked = await fetch(`${base}/api/event`, { headers: { origin: "http://untrusted.test" } })
    assert.equal(blocked.status, 403)
    const events = await fetch(`${base}/api/event`, { headers: { origin: "http://trusted.test", authorization: "browser-value" } })
    assert.equal(events.status, 200)
    assert.equal(events.headers.get("access-control-allow-origin"), null)
    assert.equal(events.headers.get("cache-control"), "no-cache, no-transform")
    assert.equal(await events.text(), "data: fake-event\n\n")
    assert.equal(receivedAuth, "Basic fake-test-value")
    const health = await fetch(`${base}/api/ui/notifications/health`)
    assert.deepEqual(await health.json(), { ready: true, watcher: "idle", devices: 0 })
    ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/pty/example/connect`, { headers: { origin: "http://trusted.test" } })
    ws.binaryType = "arraybuffer"
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    const echoed = new Promise((resolve) => { ws.onmessage = ({ data }) => resolve(data) })
    ws.send(new Uint8Array([0, 255, 1]))
    assert.deepEqual(new Uint8Array(await echoed), new Uint8Array([0, 255, 1]))
  } finally {
    ws?.close()
    notifications.stop()
    app.dispose()
    await server.stop(true)
    await upstream.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 5000)

  let disposed = false
  const notifications = createNotificationService({ stateFile: join(dir, "state.json"), startWatcher: false, opencodeBaseUrl: "http://127.0.0.1:1", sendPush: async () => {} })
  const stub = { handleRequest: async () => new Response("stub") }
    handleRequest: async (request) => new Response(JSON.stringify({ path: new URL(request.url).pathname }), {
      headers: { "content-type": "application/json" },
    }),
    dispose: () => { disposed = true },
  }
  const app = createBunApplication({
    target: "http://127.0.0.1:1", authorization: "Basic fake-test-value", directory: "dist-bun-build",
    security: { allowedHosts: ["127.0.0.1"], allowedOrigins: ["http://trusted.test"] },
  })
  try {
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(disposed, false)
  } finally {
    notifications.stop()
    app.dispose()
    await rm(dir, { recursive: true, force: true })
  }
  assert.equal(disposed, true)
})
