import { createAuthApiHandler } from "./auth-api.ts"
import { createAuthGate, type AuthService } from "./auth.ts"
import { createPtyWebSocketBridge } from "./pty-websocket-bridge.ts"
import type { SecurityOptions } from "./request-security.ts"
import { createUiEnvironmentHandler } from "./ui-environment.ts"
import { createWebGateway } from "./web-gateway.ts"
import { proxyEngineRequest } from "./web-proxy.ts"
import { createStaticHandler } from "./web-static.ts"

type Service = { handleRequest: (request: Request) => Promise<Response> }
export function createBunApplication(options: {
  target?: string
  authorization?: string
  /** Live target provider; null means that an engine connection is not configured. */
  getTarget?: () => { target: string; authorization: string } | null
  directory: string
  security: Required<Pick<SecurityOptions, "allowedHosts" | "allowedOrigins">> & SecurityOptions
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
  /** Override the home directory used for New Session defaults. */
  sessionHome?: string
}) {
  const resolveTarget = () =>
    options.getTarget
      ? options.getTarget()
      : options.target ? { target: options.target, authorization: options.authorization } : null
  const connectionRequired = () => new Response("Set up an OpenCode engine connection first.\n", {
    status: 503,
    headers: { "cache-control": "no-store" },
  })
  const withEngine = (service: Service) => (request: Request) =>
    resolveTarget() ? service.handleRequest(request) : connectionRequired()
  const bridge = createPtyWebSocketBridge({
    upstream: options.target,
    authorization: options.authorization,
    getTarget: options.getTarget
      ? () => {
          const current = resolveTarget()
          return current ? { upstream: current.target, authorization: current.authorization } : null
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
    plugins: options.plugins && withEngine(options.plugins),
    sessionShortcuts: options.sessionShortcuts?.handleRequest,
    environment: createUiEnvironmentHandler(options.sessionHome),
    artifacts: withEngine(options.artifacts),
    notifications: options.notifications.handleRequest,
    engine: (request) => {
      const current = resolveTarget()
      return current ? proxyEngineRequest(request, current) : connectionRequired()
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
