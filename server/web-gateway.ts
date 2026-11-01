import { createWebDispatcher } from "./web-dispatch.ts"
import type { PtyBridgeServer } from "./pty-websocket-bridge.ts"
import type { SecurityOptions } from "./request-security.ts"

type Handler = (request: Request) => Response | Promise<Response>
type GatewayOptions = {
  security?: SecurityOptions
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
  return async (request: Request, server: PtyBridgeServer & { timeout: (request: Request, seconds: number) => void }) => {
    const path = new URL(request.url).pathname
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return options.bridge.upgrade(request, server)
    }
    // Engine events are long-lived and may legitimately be quiet indefinitely.
    if (path === "/api/event") server.timeout(request, 0)
    return dispatch(request)
  }
}
