import { createWebDispatcher } from "./web-dispatch.ts"
import type { AuthGateDecision } from "./auth.ts"
import type { PtyBridgeServer } from "./pty-websocket-bridge.ts"
import type { SecurityOptions } from "./request-security.ts"
import { secureWebResponse } from "./web-security.ts"

type Handler = (request: Request) => Response | Promise<Response>
type GatewayOptions = {
  security?: SecurityOptions
  /** Optional session gate; runs for HTTP requests and WebSocket upgrades before dispatch. */
  authGate?: (request: Request) => Promise<AuthGateDecision>
  /** Auth endpoint handler mounted at /api/ui/auth/*. */
  auth?: Handler
  /** Notes HTTP API mounted at /api/ui/notes/* (including the change stream). */
  notes?: Handler
  /** Plugins HTTP API mounted at /api/ui/plugins*. */
  plugins?: Handler
  agents: Handler
  notifications: Handler
  artifacts: Handler
  engine: Handler
  frontend: Handler
  bridge: { upgrade: (request: Request, server: PtyBridgeServer) => Promise<Response | undefined> }
}

/** Compose the isolated gateway components without starting services or reading credentials. */
export function createWebGateway(options: GatewayOptions) {
  const dispatch = createWebDispatcher(options)
  return async (request: Request, server: PtyBridgeServer & {
    timeout: (request: Request, seconds: number) => void
    requestIP?: (request: Request) => { address: string } | null
  }) => {
    const path = new URL(request.url).pathname
    const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket"
    if (options.authGate) {
      const decision = await options.authGate(request)
      if (!decision.allowed) {
        // WebSocket clients cannot read a JSON body; a bare 401 is the contract response.
        return secureWebResponse(request, isUpgrade
          ? new Response(null, { status: 401 })
          : new Response(JSON.stringify({ error: { code: decision.code } }), {
            status: 401,
            headers: { "content-type": "application/json; charset=utf-8" },
          }))
      }
    }
    if (isUpgrade) {
      return options.bridge.upgrade(request, server)
    }
    // Engine events are long-lived and may legitimately be quiet indefinitely.
    if (path === "/api/event" || path === "/api/ui/notes/events") server.timeout(request, 0)
    return dispatch(request, server.requestIP?.(request)?.address)
  }
}
