import {
  NOTES_ATTACHMENT_BODY_LIMIT,
  NOTES_BODY_LIMIT,
  NOTES_ROUTE,
} from "./notes-api.ts"
import { PLUGINS_BODY_LIMIT, PLUGINS_ROUTE } from "./plugins-api.ts"
import {
  SESSION_SHORTCUTS_BODY_LIMIT,
  SESSION_SHORTCUTS_ROUTE,
} from "./session-shortcuts.ts"
import { evaluateWebRequest, secureWebResponse } from "./web-security.ts"
import type { SecurityOptions } from "./request-security.ts"

type Handler = (request: Request, remote?: string) => Promise<Response> | Response
type DispatcherOptions = {
  security?: SecurityOptions
  auth?: Handler
  notes?: Handler
  plugins?: Handler
  sessionShortcuts?: Handler
  agents: Handler
  notifications: Handler
  artifacts: Handler
  engine: Handler
  frontend: Handler
}

async function boundedRequest(request: Request, limit: number): Promise<Request | null> {
  if (!request.body) return request
  const length = request.headers.get("content-length")
  if (length && Number(length) > limit) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => {})
        return null
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return new Request(request.url, {
    method: request.method, headers: request.headers, body, signal: request.signal,
  })
}

/** HTTP dispatch for the Bun gateway. WebSocket upgrades are handled separately. */
export function createWebDispatcher(options: DispatcherOptions): (request: Request, remote?: string) => Promise<Response> {
  return async (request, remote) => {
    const path = new URL(request.url).pathname
    const decision = evaluateWebRequest(request, options.security)
    if (!decision.allowed) {
      return secureWebResponse(request, new Response(`Forbidden: ${decision.reason}\n`, { status: decision.status }))
    }
    let handler: Handler
    let limit: number | undefined
    if (options.auth && (path === "/api/ui/auth" || path.startsWith("/api/ui/auth/"))) {
      handler = options.auth
      limit = 8 * 1024
    } else if (options.notes && (path === NOTES_ROUTE || path.startsWith(`${NOTES_ROUTE}/`))) {
      handler = options.notes
      limit = path === `${NOTES_ROUTE}/createAttachment` && request.method === "POST"
        ? NOTES_ATTACHMENT_BODY_LIMIT
        : NOTES_BODY_LIMIT
    } else if (options.plugins && (path === PLUGINS_ROUTE || path.startsWith(`${PLUGINS_ROUTE}/`))) {
      handler = options.plugins
      limit = PLUGINS_BODY_LIMIT
    } else if (options.sessionShortcuts && path === SESSION_SHORTCUTS_ROUTE) {
      handler = options.sessionShortcuts
      limit = SESSION_SHORTCUTS_BODY_LIMIT
    } else if (path === "/api/ui/agents" || path === "/api/ui/agents/default") {
      handler = options.agents
      limit = 64 * 1024
    } else if (path === "/api/ui/notifications" || path.startsWith("/api/ui/notifications/")) {
      handler = options.notifications
      limit = 32 * 1024
    } else if (path === "/api/ui" || path.startsWith("/api/ui/")) {
      handler = options.artifacts
      limit = 8 * 1024
    } else if (path === "/api" || path.startsWith("/api/") || path === "/openapi.json") {
      handler = options.engine
    } else {
      handler = options.frontend
    }
    try {
      const bounded = limit === undefined ? request : await boundedRequest(request, limit)
      if (!bounded) {
        return secureWebResponse(request, new Response("Request too large\n", { status: 413 }))
      }
      return secureWebResponse(request, await handler(bounded, remote))
    } catch {
      return secureWebResponse(request, new Response("Request failed\n", { status: 500 }))
    }
  }
}
