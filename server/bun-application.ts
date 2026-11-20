import { createAuthApiHandler } from "./auth-api.ts"
import { createAuthGate, type AuthService } from "./auth.ts"
import { createPtyWebSocketBridge } from "./pty-websocket-bridge.ts"
import type { SecurityOptions } from "./request-security.ts"
import { createWebGateway } from "./web-gateway.ts"
import { proxyEngineRequest } from "./web-proxy.ts"
import { createStaticHandler } from "./web-static.ts"

type Service = { handleRequest: (request: Request) => Promise<Response> }
export function createBunApplication(options: {
  target: string
  authorization: string
  /** Optional live target provider when switching engines at runtime. */
  getTarget?: () => { target: string; authorization: string }
  directory: string
  security: Required<Pick<SecurityOptions, "allowedHosts" | "allowedOrigins">> & SecurityOptions
  agents: Service
  artifacts: Service
  notifications: Service
  /** Optional; existing deployments without a password keep the previous pass-through behavior. */
  auth?: AuthService
  /** Optional Engine Connections HTTP API mounted at /api/ui/connections*. */
  connections?: Service
  /** Optional Notes HTTP API; when absent /api/ui/notes/* keeps its previous routing. */
  notes?: Service & { dispose?: () => void }
  /** Optional Plugins HTTP API; when absent /api/ui/plugins* keeps its previous routing. */
  plugins?: Service
  /** Optional shared session pins/labels API. */
  sessionShortcuts?: Service & { dispose?: () => void }
}) {
  const resolveTarget = () =>
    options.getTarget
      ? options.getTarget()
      : { target: options.target, authorization: options.authorization }
  const bridge = createPtyWebSocketBridge({
    upstream: options.target,
    authorization: options.authorization,
    getTarget: options.getTarget
      ? () => {
          const current = resolveTarget()
          return { upstream: current.target, authorization: current.authorization }
        }
      : undefined,
    security: options.security,
  })
  const fetch = createWebGateway({
    security: options.security,
    authGate: options.auth ? createAuthGate(options.auth) : undefined,
    auth: options.auth ? createAuthApiHandler(options.auth) : undefined,
    connections: options.connections?.handleRequest,
    notes: options.notes?.handleRequest,
    plugins: options.plugins?.handleRequest,
    sessionShortcuts: options.sessionShortcuts?.handleRequest,
    agents: options.agents.handleRequest, artifacts: options.artifacts.handleRequest,
    notifications: options.notifications.handleRequest,
    engine: (request) => {
      const current = resolveTarget()
      return proxyEngineRequest(request, { target: current.target, authorization: current.authorization })
    },
    frontend: createStaticHandler(options.directory), bridge,
  })
  return {
    fetch,
    websocket: bridge.websocket,
    resetEngineConnections: () => {
      bridge.reset()
    },
    dispose: () => {
      options.notes?.dispose?.()
      options.sessionShortcuts?.dispose?.()
      bridge.dispose()
    },
  }
}
