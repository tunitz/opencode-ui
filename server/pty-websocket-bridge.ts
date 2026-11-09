import { evaluateWebSocketUpgrade, type SecurityOptions } from "./request-security.ts"

/** Structural Bun interfaces keep this adapter usable without installing Bun types. */
export interface PtyBridgeSocket {
  data: PtyBridgeData
  send(message: string | Uint8Array): number
  getBufferedAmount(): number
  close(code?: number, reason?: string): void
  terminate(): void
}

export interface PtyBridgeServer {
  upgrade(request: Request, options: { data: PtyBridgeData; headers: Headers }): boolean
}

interface UpstreamSocket {
  binaryType: string
  readyState: number
  bufferedAmount: number
  send(message: string | Uint8Array): void
  close(code?: number, reason?: string): void
  terminate?(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { code: number }) => void) | null
}

export interface PtyBridgeData {
  /** Internal per-upgrade state; callers must pass this through unchanged. */
  readonly ptyBridge: BridgeState
}

interface BridgeState {
  upstream: UpstreamSocket
  downstream?: PtyBridgeSocket
  queue: (string | Uint8Array)[]
  queuedBytes: number
  stopped: boolean
  timer?: ReturnType<typeof setTimeout>
  cancel: () => void
  failPending: () => void
}

export interface PtyBridgeOptions {
  /** Trusted server configuration only, never derived from the browser request. */
  upstream: string
  authorization: string
  /** Explicit allowlists are required; request validation cannot be bypassed. */
  security: Required<Pick<SecurityOptions, "allowedHosts" | "allowedOrigins">> & SecurityOptions
  connectTimeoutMs?: number
  maxBufferedBytes?: number
  maxPayloadBytes?: number
}

function failure(status: number): Response {
  return new Response("WebSocket connection unavailable", {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  })
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}

/**
 * Bun.serve integration: use upgrade(request, server) from fetch and install
 * websocket as the server's websocket handler. It owns PTY upgrades only; a
 * non-PTY request returns 404, never a successful unvalidated upgrade.
 * Call dispose() before stopping the owning server. No retries (PTY is stateful).
 */
export function createPtyWebSocketBridge(options: PtyBridgeOptions) {
  const base = new URL(options.upstream)
  if (!["http:", "https:", "ws:", "wss:"].includes(base.protocol) ||
    base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Upstream must be a trusted HTTP/WebSocket origin")
  }
  if (!options.authorization || /[\r\n]/.test(options.authorization)) {
    throw new Error("Server-side authorization is required")
  }
  const security = {
    ...options.security,
    allowedHosts: [...options.security.allowedHosts],
    allowedOrigins: [...options.security.allowedOrigins],
    allowedApiPrefixes: [...(options.security.allowedApiPrefixes ?? ["/api/pty"])],
  }
  const authorization = options.authorization
  const timeout = positiveInteger(options.connectTimeoutMs ?? 10_000, "connectTimeoutMs")
  const capacity = positiveInteger(options.maxBufferedBytes ?? 1024 * 1024, "maxBufferedBytes")
  const payloadLimit = positiveInteger(options.maxPayloadBytes ?? 1024 * 1024, "maxPayloadBytes")
  const encoder = new TextEncoder()
  const states = new Set<BridgeState>()
  let disposed = false
  const bytes = (message: string | Uint8Array) =>
    typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength

  function stop(state: BridgeState, code = 1011, reason = "Bridge closed") {
    if (state.stopped) return
    state.stopped = true
    clearTimeout(state.timer)
    state.cancel()
    state.failPending()
    state.queue = []
    state.queuedBytes = 0
    states.delete(state)
    // Never reflect upstream close reasons (which may contain private information).
    try { state.downstream?.close(code, reason) } catch {
      try { state.downstream?.terminate() } catch { /* Already closed. */ }
    }
    try {
      if (state.upstream.terminate) state.upstream.terminate()
      else state.upstream.close(1000, "Bridge closed")
    } catch { /* Already closed. */ }
  }

  function deliver(state: BridgeState, message: string | Uint8Array) {
    if (state.stopped) return
    const length = bytes(message)
    if (length > payloadLimit) return stop(state, 1009, "Message too large")
    const downstream = state.downstream
    if (!downstream) {
      // Count empty frames too, so a peer cannot grow the queue without bound.
      if (state.queuedBytes + Math.max(1, length) > capacity) {
        return stop(state, 1013, "Backpressure limit")
      }
      state.queue.push(message)
      state.queuedBytes += Math.max(1, length)
      return
    }
    try {
      if (downstream.getBufferedAmount() + length > capacity) {
        return stop(state, 1013, "Backpressure limit")
      }
      // Bun -1 means accepted with backpressure; 0 means dropped, not retryable.
      if (downstream.send(message) === 0) stop(state, 1013, "Backpressure limit")
    } catch { stop(state) }
  }

  return {
    async upgrade(request: Request, server: PtyBridgeServer): Promise<Response | undefined> {
      if (disposed) return failure(503)
      const url = new URL(request.url)
      if (!/^\/api\/pty\/[^/]+\/connect$/.test(url.pathname)) return failure(404)
      if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return failure(400)
      }
      const decision = evaluateWebSocketUpgrade({
        pathname: url.pathname,
        host: request.headers.get("host") ?? undefined,
        origin: request.headers.get("origin") ?? undefined,
        secFetchSite: request.headers.get("sec-fetch-site") ?? undefined,
      }, security)
      if (!decision.allowed) return failure(decision.status)
      // PTY uses no subprotocol; do not forward browser-supplied credentials/headers.
      if (request.headers.has("sec-websocket-protocol")) return failure(400)
      if (request.signal.aborted) return failure(400)
      const target = new URL(base)
      target.protocol = base.protocol === "https:" || base.protocol === "wss:" ? "wss:" : "ws:"
      target.pathname = url.pathname
      target.search = url.search
      // Bun's native client accepts server-only headers in its second argument.
      const NativeWebSocket = globalThis.WebSocket as unknown as new (
        url: string, options: { headers: Record<string, string> },
      ) => UpstreamSocket
      let upstream: UpstreamSocket
      try { upstream = new NativeWebSocket(target.href, { headers: { authorization } }) }
      catch { return failure(502) }
      upstream.binaryType = "arraybuffer"
      const state: BridgeState = {
        upstream, queue: [], queuedBytes: 0, stopped: false, cancel: () => {}, failPending: () => {},
      }
      states.add(state)
      return await new Promise<Response | undefined>((resolve) => {
        let settled = false
        const finish = (response: Response | undefined) => {
          if (settled) return
          settled = true
          resolve(response)
        }
        const abort = () => { finish(failure(400)); stop(state) }
        request.signal.addEventListener("abort", abort, { once: true })
        state.cancel = () => {
          request.signal.removeEventListener("abort", abort)
        }
        state.failPending = () => finish(failure(502))
        state.timer = setTimeout(() => {
          finish(failure(504))
          stop(state)
        }, timeout)
        upstream.onerror = () => { stop(state); finish(failure(502)) }
        upstream.onclose = ({ code }) => {
          // Only meaningful, sendable close codes cross the bridge.
          const safeCode = code === 1000 || code === 1001 || (code >= 3000 && code <= 4999) ? code : 1011
          stop(state, safeCode, "Upstream closed")
        }
        upstream.onmessage = ({ data }) => {
          if (typeof data === "string") deliver(state, data)
          else if (data instanceof ArrayBuffer) deliver(state, new Uint8Array(data))
          else if (ArrayBuffer.isView(data)) {
            deliver(state, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
          } else stop(state, 1003, "Unsupported frame")
        }
        upstream.onopen = () => {
          if (state.stopped) return
          try {
            if (!server.upgrade(request, {
              data: { ptyBridge: state }, headers: new Headers({ "cache-control": "no-store" }),
            })) { stop(state); return }
            finish(undefined)
          } catch { stop(state) }
        }
      })
    },
    websocket: {
      maxPayloadLength: payloadLimit,
      backpressureLimit: capacity,
      closeOnBackpressureLimit: true,
      open(socket: PtyBridgeSocket) {
        const state = socket.data.ptyBridge
        if (!states.has(state) || state.stopped) { socket.close(1011, "Bridge closed"); return }
        state.downstream = socket
        clearTimeout(state.timer)
        state.cancel()
        const queued = state.queue
        state.queue = []
        state.queuedBytes = 0
        for (const message of queued) deliver(state, message)
      },
      message(socket: PtyBridgeSocket, message: string | Uint8Array) {
        const state = socket.data.ptyBridge
        if (!states.has(state) || state.stopped) return
        const length = bytes(message)
        if (length > payloadLimit) return stop(state, 1009, "Message too large")
        if (state.upstream.readyState !== 1) return stop(state)
        if (state.upstream.bufferedAmount + length > capacity) {
          return stop(state, 1013, "Backpressure limit")
        }
        try { state.upstream.send(message) } catch { stop(state) }
      },
      close(socket: PtyBridgeSocket) { stop(socket.data.ptyBridge, 1000, "Client closed") },
    },
    dispose() {
      disposed = true
      for (const state of states) stop(state, 1001, "Server shutdown")
    },
  }
}
