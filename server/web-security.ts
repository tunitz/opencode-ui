import {
  evaluateRequest,
  isAllowedHost,
  isProtectedPath,
  SECURITY_HEADERS,
  type SecurityDecision,
  type SecurityOptions,
} from "./request-security.ts"

/** Apply the existing gateway policy to a Bun/Web request, including static routes. */
export function evaluateWebRequest(request: Request, options: SecurityOptions = {}): SecurityDecision {
  const url = new URL(request.url)
  const host = request.headers.get("host") ?? undefined
  if (!isAllowedHost(host, options.allowedHosts)) {
    return { allowed: false, status: 403, reason: "host not allowed" }
  }
  return evaluateRequest({
    method: request.method,
    pathname: url.pathname,
    host,
    origin: request.headers.get("origin") ?? undefined,
    secFetchSite: request.headers.get("sec-fetch-site") ?? undefined,
    contentType: request.headers.get("content-type") ?? undefined,
    contentLength: request.headers.get("content-length") ?? undefined,
    transferEncoding: request.headers.get("transfer-encoding") ?? undefined,
    hasBody: request.body !== null,
  }, options)
}

/** Apply gateway headers without weakening a response's more restrictive CSP. */
export function secureWebResponse(request: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name !== "content-security-policy" || !headers.has(name)) headers.set(name, value)
  }
  if (isProtectedPath(new URL(request.url).pathname)) {
    const isEventStream = headers.get("content-type")?.toLowerCase().includes("text/event-stream")
    headers.set("cache-control", isEventStream ? "no-cache, no-transform" : "no-store")
    const vary = headers.get("vary")
    if (!vary) headers.set("vary", "Origin")
    else if (!vary.split(",").some((value) => ["origin", "*"].includes(value.trim().toLowerCase()))) {
      headers.set("vary", `${vary}, Origin`)
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
