import type { IncomingMessage, ServerResponse } from "node:http"
import type { Socket } from "node:net"

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://tun-minipc.great-vernier.ts.net",
  "https://tun-minipc.great-vernier.ts.net:443",
  "http://100.67.153.70:5174",
  "http://tun-minipc:5174",
  "http://tun-minipc.great-vernier.ts.net:5174",
] as const

export const DEFAULT_ALLOWED_HOSTS = [
  "tun-minipc.great-vernier.ts.net",
  "tun-minipc",
  "100.67.153.70",
  "127.0.0.1",
  "localhost",
] as const

export const DEFAULT_API_PREFIXES = [
  "/api/info",
  "/api/event",
  "/api/project",
  "/api/location",
  "/api/session",
  "/api/agent",
  "/api/model",
  "/api/config",
  "/api/command",
  "/api/skill",
  "/api/fs",
  "/api/vcs",
  "/api/pty",
  "/api/experimental",
  "/api/permission",
  "/api/form",
  "/api/plugin",
  "/api/provider",
  "/api/integration",
  "/api/mcp",
  "/api/worktree",
  "/api/credential",
  "/api/ui",
] as const

const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
])

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
}

export type SecurityOptions = {
  allowedOrigins?: readonly string[]
  allowedHosts?: readonly string[]
  allowedApiPrefixes?: readonly string[]
}

export type RequestSecurityInput = {
  method: string | undefined
  pathname: string
  host: string | undefined
  origin: string | undefined
  secFetchSite: string | undefined
  contentType: string | undefined
  contentLength: string | undefined
  transferEncoding: string | undefined
  hasBody?: boolean
}

export type SecurityDecision =
  | { allowed: true }
  | { allowed: false; status: number; reason: string }

function normalizedOrigin(value: string | undefined): string | null {
  if (!value || value === "null" || value === "*") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

function normalizedHost(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(`http://${value}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function isProtectedPath(pathname: string): boolean {
  return pathname === "/openapi.json" || pathname === "/api" || pathname.startsWith("/api/")
}

export function isAllowedApiPath(
  pathname: string,
  prefixes: readonly string[] = DEFAULT_API_PREFIXES
): boolean {
  if (pathname === "/openapi.json") return true
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS
): boolean {
  const normalized = normalizedOrigin(origin)
  if (!normalized) return false
  return allowedOrigins.some(
    (allowed) => normalizedOrigin(allowed) === normalized
  )
}

export function isAllowedHost(
  host: string | undefined,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS
): boolean {
  const normalized = normalizedHost(host)
  if (!normalized) return false
  return allowedHosts.some(
    (allowed) => allowed.toLowerCase() === normalized
  )
}

export function isStateChanging(method: string | undefined): boolean {
  return STATE_CHANGING_METHODS.has((method ?? "GET").toUpperCase())
}

export function hasRequestBody(input: {
  contentLength: string | undefined
  transferEncoding: string | undefined
}): boolean {
  const length = Number(input.contentLength ?? 0)
  return (
    (Number.isFinite(length) && length > 0) ||
    Boolean(input.transferEncoding)
  )
}

export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase()
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"))
}

/** Validate browser-sensitive API/WS requests before the Vite upstream proxy. */
export function evaluateRequest(
  input: RequestSecurityInput,
  options: SecurityOptions = {}
): SecurityDecision {
  const method = (input.method ?? "GET").toUpperCase()
  const pathname = input.pathname
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS
  const allowedApiPrefixes = options.allowedApiPrefixes ?? DEFAULT_API_PREFIXES

  if (!isProtectedPath(pathname)) return { allowed: true }
  if (!ALLOWED_METHODS.has(method)) {
    return { allowed: false, status: 405, reason: "method not allowed" }
  }
  if (!isAllowedHost(input.host, allowedHosts)) {
    return { allowed: false, status: 403, reason: "host not allowed" }
  }
  if (!isAllowedApiPath(pathname, allowedApiPrefixes)) {
    return { allowed: false, status: 403, reason: "API path not allowed" }
  }

  const hasOrigin = Boolean(input.origin)
  if (hasOrigin && !isAllowedOrigin(input.origin, allowedOrigins)) {
    return { allowed: false, status: 403, reason: "origin not allowed" }
  }
  if (input.secFetchSite === "cross-site") {
    return { allowed: false, status: 403, reason: "cross-site request" }
  }
  if (isStateChanging(method) && !hasOrigin) {
    return { allowed: false, status: 403, reason: "missing origin" }
  }

  if (
    isStateChanging(method) &&
    (input.hasBody || hasRequestBody({
      contentLength: input.contentLength,
      transferEncoding: input.transferEncoding,
    })) &&
    !isJsonContentType(input.contentType)
  ) {
    return { allowed: false, status: 415, reason: "browser mutation must be JSON" }
  }

  return { allowed: true }
}

export function evaluateWebSocketUpgrade(
  input: Pick<RequestSecurityInput, "pathname" | "host" | "origin" | "secFetchSite">,
  options: SecurityOptions = {}
): SecurityDecision {
  if (!isProtectedPath(input.pathname)) return { allowed: true }
  if (!isAllowedHost(input.host, options.allowedHosts)) {
    return { allowed: false, status: 403, reason: "host not allowed" }
  }
  if (!isAllowedApiPath(input.pathname, options.allowedApiPrefixes)) {
    return { allowed: false, status: 403, reason: "API path not allowed" }
  }
  if (!input.origin) {
    return { allowed: false, status: 403, reason: "missing origin" }
  }
  if (!isAllowedOrigin(input.origin, options.allowedOrigins)) {
    return { allowed: false, status: 403, reason: "origin not allowed" }
  }
  if (input.secFetchSite === "cross-site") {
    return { allowed: false, status: 403, reason: "cross-site upgrade" }
  }
  return { allowed: true }
}

export function applySecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value)
  }
}

export function applyApiResponsePolicy(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store")
  const vary = response.getHeader("vary")
  if (typeof vary === "string" && vary.trim()) {
    if (!vary.toLowerCase().split(",").map((value) => value.trim()).includes("origin")) {
      response.setHeader("vary", `${vary}, Origin`)
    }
  } else {
    response.setHeader("vary", "Origin")
  }
}

export function createSecurityMiddleware(options: SecurityOptions = {}) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    applySecurityHeaders(response)
    const pathname = new URL(request.url ?? "/", "http://local").pathname
    if (!isProtectedPath(pathname)) {
      next()
      return
    }
    applyApiResponsePolicy(response)
    const decision = evaluateRequest(
      {
        method: request.method,
        pathname,
        host: request.headers.host,
        origin: request.headers.origin,
        secFetchSite: request.headers["sec-fetch-site"],
        contentType: request.headers["content-type"],
        contentLength: request.headers["content-length"],
        transferEncoding: request.headers["transfer-encoding"],
      },
      options
    )
    if (!decision.allowed) {
      response.statusCode = decision.status
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.end(`Forbidden: ${decision.reason}\n`)
      return
    }
    next()
  }
}

export function createUpgradeGuard(options: SecurityOptions = {}) {
  return (request: IncomingMessage, socket: Socket): boolean => {
    const pathname = new URL(request.url ?? "/", "http://local").pathname
    if (!isProtectedPath(pathname)) return true
    const decision = evaluateWebSocketUpgrade(
      {
        pathname,
        host: request.headers.host,
        origin: request.headers.origin,
        secFetchSite: request.headers["sec-fetch-site"],
      },
      options
    )
    if (decision.allowed) return true
    socket.write(
      `HTTP/1.1 ${decision.status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    )
    socket.destroy()
    return false
  }
}

export function stripUpstreamCorsHeaders(
  headers: Record<string, string | string[] | undefined>
): void {
  delete headers["access-control-allow-origin"]
  delete headers["access-control-allow-credentials"]
  delete headers["access-control-allow-methods"]
  delete headers["access-control-allow-headers"]
  delete headers["access-control-expose-headers"]
  delete headers["access-control-max-age"]
}
