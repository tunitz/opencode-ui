import { createPtyWebSocketBridge } from "./pty-websocket-bridge.ts"
import type { SecurityOptions } from "./request-security.ts"
import { createWebGateway } from "./web-gateway.ts"
import { proxyEngineRequest } from "./web-proxy.ts"
import { createStaticHandler } from "./web-static.ts"

type Service = { handleRequest: (request: Request) => Promise<Response> }
export function createBunApplication(options: {
  target: string
  authorization: string
  directory: string
  security: Required<Pick<SecurityOptions, "allowedHosts" | "allowedOrigins">> & SecurityOptions
  agents: Service
  artifacts: Service
  notifications: Service
}) {
  const bridge = createPtyWebSocketBridge({ upstream: options.target, authorization: options.authorization, security: options.security })
  const fetch = createWebGateway({
    security: options.security,
    agents: options.agents.handleRequest, artifacts: options.artifacts.handleRequest,
    notifications: options.notifications.handleRequest,
    engine: (request) => proxyEngineRequest(request, { target: options.target, authorization: options.authorization }),
    frontend: createStaticHandler(options.directory), bridge,
  })
  return { fetch, websocket: bridge.websocket, dispose: bridge.dispose }
}
