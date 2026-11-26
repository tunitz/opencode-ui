import { test } from "node:test"
import assert from "node:assert/strict"
import { createPtyWebSocketBridge } from "../server/pty-websocket-bridge.ts"

const security = { allowedHosts: ["127.0.0.1"], allowedOrigins: ["http://trusted.test"] }
const headers = { host: "127.0.0.1", origin: "http://trusted.test", upgrade: "websocket" }
const request = (path = "/api/pty/pty_123/connect?cursor=0&directory=%2Ftmp%2Fa+b", extra = {}) =>
  new Request(`http://127.0.0.1${path}`, { headers: { ...headers, ...extra } })
const options = (port, extra = {}) => ({
  upstream: `http://127.0.0.1:${port}`, authorization: "Bearer server-secret", security,
  connectTimeoutMs: 500, ...extra,
})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function deadline(promise) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Test deadline exceeded")), 2000)
  })]).finally(() => clearTimeout(timer))
}
function opened(ws) {
  return deadline(new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error("Unexpected socket error"))
  }))
}
function nextMessage(ws) {
  return deadline(new Promise((resolve) => { ws.onmessage = ({ data }) => resolve(data) }))
}

test("validation is enforced before any upstream connection", async () => {
  const bridge = createPtyWebSocketBridge(options(1))
  const server = { upgrade() { throw new Error("Must not upgrade") } }
  try {
    for (const [input, status] of [
      [request("/api/session/x/connect"), 404],
      [request(undefined, { origin: "http://evil.test" }), 403],
      [request(undefined, { host: "evil.test" }), 403],
      [request(undefined, { origin: "" }), 403],
      [request(undefined, { "sec-fetch-site": "cross-site" }), 403],
      [request(undefined, { "sec-websocket-protocol": "secret" }), 400],
      [request(undefined, { upgrade: "" }), 400],
    ]) {
      const response = await bridge.upgrade(input, server)
      assert.equal(response.status, status)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.ok(!(await response.text()).includes("server-secret"))
    }
  } finally { bridge.dispose() }
})

test("native Bun bridge preserves path/query, server auth, text/binary and closes upstream", async () => {
  let seen
  let upstreamClosed
  const closed = new Promise((resolve) => { upstreamClosed = resolve })
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req, server) {
      seen = { url: new URL(req.url), headers: req.headers }
      if (server.upgrade(req)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(ws) { ws.send("early frame") },
      message(ws, message) { ws.send(message) },
      close() { upstreamClosed() },
    },
  })
  const bridge = createPtyWebSocketBridge(options(upstream.port))
  const gateway = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (req, server) => bridge.upgrade(req, server),
    websocket: bridge.websocket,
  })
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/api/pty/pty_%31/connect?cursor=0&directory=%2Ftmp%2Fa+b&token=browser-capability`, {
    headers: { origin: "http://trusted.test", authorization: "Bearer browser-secret", cookie: "private=yes" },
  })
  ws.binaryType = "arraybuffer"
  const first = nextMessage(ws)
  try {
    await opened(ws)
    assert.equal(await first, "early frame")
    assert.equal(seen.url.pathname, "/api/pty/pty_%31/connect")
    assert.equal(seen.url.search, "?cursor=0&directory=%2Ftmp%2Fa+b&token=browser-capability")
    assert.equal(seen.headers.get("authorization"), "Bearer server-secret")
    assert.equal(seen.headers.get("cookie"), null)
    assert.equal(seen.headers.get("origin"), null)
    let message = nextMessage(ws)
    ws.send("hello\u0000世界")
    assert.equal(await message, "hello\u0000世界")
    message = nextMessage(ws)
    ws.send(new Uint8Array([0, 255, 1, 128]))
    assert.deepEqual(new Uint8Array(await message), new Uint8Array([0, 255, 1, 128]))
    message = nextMessage(ws)
    ws.send("")
    assert.equal(await message, "")
    ws.close(1000)
    await deadline(closed)
  } finally {
    ws.close()
    bridge.dispose()
    await gateway.stop(true)
    await upstream.stop(true)
  }
})

test("failed upstream and handshake timeout return bounded generic errors", async () => {
  const rejector = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("private", { status: 401 }) })
  const hanging = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise(() => {}) })
  try {
    for (const [port, status] of [[rejector.port, 502], [hanging.port, 504]]) {
      const bridge = createPtyWebSocketBridge(options(port, { connectTimeoutMs: 50 }))
      try {
        const response = await deadline(bridge.upgrade(request(), { upgrade: () => false }))
        assert.equal(response.status, status)
        assert.ok(!(await response.text()).includes("private"))
      } finally { bridge.dispose() }
    }
  } finally { await rejector.stop(true); await hanging.stop(true) }
})

test("bounded pre-open queue, failed browser upgrade, disposal and backpressure cleanup", async () => {
  let active = 0
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (req, server) => server.upgrade(req) ? undefined : new Response(null, { status: 400 }),
    websocket: {
      open(ws) { active++; ws.send("queued") },
      message() {},
      close() { active-- },
    },
  })
  try {
    const bridge = createPtyWebSocketBridge(options(upstream.port, { maxBufferedBytes: 8 }))
    let data
    const server = { upgrade(_req, input) { data = input.data; return true } }
    await bridge.upgrade(request(), server)
    let closeCode
    const socket = {
      data, send: () => -1, getBufferedAmount: () => 8,
      close(code) { closeCode = code }, terminate() {},
    }
    bridge.websocket.open(socket)
    // The queued frame cannot fit behind already-buffered data.
    await delay(10)
    assert.equal(closeCode, 1013)
    bridge.dispose()
    assert.equal((await bridge.upgrade(request(), server)).status, 503)

    const failed = createPtyWebSocketBridge(options(upstream.port))
    assert.equal((await failed.upgrade(request(), { upgrade: () => false })).status, 502)
    failed.dispose()

    const overflowing = createPtyWebSocketBridge(options(upstream.port, { maxBufferedBytes: 2 }))
    await overflowing.upgrade(request(), { upgrade: () => true })
    await delay(20)
    overflowing.dispose()
    await delay(20)
    assert.equal(active, 0)
  } finally { await upstream.stop(true) }
})

test("upstream close reasons stay private and pending upgrades abort on disposal", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (req, server) => server.upgrade(req) ? undefined : new Response(null, { status: 400 }),
    websocket: { open() {}, message(ws) { ws.close(4001, "private token") } },
  })
  const bridge = createPtyWebSocketBridge(options(upstream.port))
  try {
    let data
    await bridge.upgrade(request(), { upgrade(_req, input) { data = input.data; return true } })
    let closed
    const onClose = new Promise((resolve) => { closed = resolve })
    const socket = { data, getBufferedAmount: () => 0, send: () => 1,
      close(code, reason) { closed({ code, reason }) }, terminate() {} }
    bridge.websocket.open(socket)
    bridge.websocket.message(socket, "close")
    assert.deepEqual(await deadline(onClose), { code: 4001, reason: "Upstream closed" })

    const controller = new AbortController()
    const hanging = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise(() => {}) })
    try {
      const pendingBridge = createPtyWebSocketBridge(options(hanging.port))
      const pending = pendingBridge.upgrade(new Request(request(), { signal: controller.signal }), { upgrade: () => true })
      controller.abort()
      assert.equal((await deadline(pending)).status, 400)
      pendingBridge.dispose()
      const disposable = createPtyWebSocketBridge(options(hanging.port))
      const disposing = disposable.upgrade(request(), { upgrade: () => true })
      disposable.dispose()
      assert.equal((await deadline(disposing)).status, 502)
    } finally { await hanging.stop(true) }
  } finally { bridge.dispose(); await upstream.stop(true) }
})

test("upstream redirects do not forward the engine credential", async () => {
  let leaked = false
  const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    leaked = true
    return new Response(null, { status: 400 })
  } })
  const redirect = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${target.port}/` } })
  } })
  const bridge = createPtyWebSocketBridge(options(redirect.port))
  try {
    assert.equal((await bridge.upgrade(request(), { upgrade: () => true })).status, 502)
    assert.equal(leaked, false)
  } finally { bridge.dispose(); await redirect.stop(true); await target.stop(true) }
})

test("accepted backpressure is not retried; dropped frames and upstream saturation close", async () => {
  let messages = 0
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (req, server) => server.upgrade(req) ? undefined : new Response(null, { status: 400 }),
    websocket: { open() {}, message() { messages++ } },
  })
  try {
    for (const result of [-1, 0]) {
      const bridge = createPtyWebSocketBridge(options(upstream.port, { maxBufferedBytes: 8, maxPayloadBytes: 16 }))
      try {
        let data
        await bridge.upgrade(request(), { upgrade(_req, input) { data = input.data; return true } })
        let sends = 0
        let closeCode
        const socket = { data, getBufferedAmount: () => 0,
          send() { sends++; return result }, close(code) { closeCode = code }, terminate() {} }
        bridge.websocket.open(socket)
        // Drive the native upstream receive callback without inducing OS-dependent pressure.
        data.ptyBridge.upstream.onmessage({ data: "hello" })
        assert.equal(sends, 1)
        if (result === 0) assert.equal(closeCode, 1013)
        else {
          assert.equal(closeCode, undefined)
          bridge.websocket.message(socket, "123456789")
          assert.equal(closeCode, 1013)
        }
      } finally { bridge.dispose() }
    }
    assert.equal(messages, 0)
  } finally { await upstream.stop(true) }
})
