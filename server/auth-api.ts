import {
  AuthError,
  buildSessionCookie,
  clearSessionCookie,
  type AuthService,
} from "./auth.ts"

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } })
}

function errorResponse(code: string, status: number): Response {
  return json({ error: { code } }, status)
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body")
    return parsed as Record<string, unknown>
  } catch {
    throw new AuthError(400, "invalid")
  }
}

function methodNotAllowed(): Response {
  return errorResponse("method_not_allowed", 405)
}

/** HTTP surface for the UI password endpoints. Callers apply the shared security headers. */
export function createAuthApiHandler(auth: AuthService) {
  return async (request: Request, remote = "unknown"): Promise<Response> => {
    const path = new URL(request.url).pathname
    try {
      if (path === "/api/ui/auth/status") {
        if (request.method !== "GET") return methodNotAllowed()
        return json(await auth.status(request))
      }
      if (path === "/api/ui/auth/setup") {
        if (request.method !== "POST") return methodNotAllowed()
        const body = await readObject(request)
        const token = await auth.setup(body.password)
        return json({ ok: true }, 200, {
          "set-cookie": buildSessionCookie(token, isSecure(request), auth.cookieName),
        })
      }
      if (path === "/api/ui/auth/login") {
        if (request.method !== "POST") return methodNotAllowed()
        const body = await readObject(request)
        const token = await auth.login(body.password, remote)
        return json({ ok: true }, 200, {
          "set-cookie": buildSessionCookie(token, isSecure(request), auth.cookieName),
        })
      }
      if (path === "/api/ui/auth/logout") {
        if (request.method !== "POST") return methodNotAllowed()
        await auth.logout(request)
        return new Response(null, {
          status: 204,
          headers: {
            "set-cookie": clearSessionCookie(isSecure(request), auth.cookieName),
          },
        })
      }
      if (path === "/api/ui/auth/password") {
        if (request.method !== "PUT") return methodNotAllowed()
        const body = await readObject(request)
        await auth.changePassword(request, body.current, body.next)
        return json({ ok: true })
      }
      return errorResponse("not_found", 404)
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.code, error.status)
      return errorResponse("internal_error", 500)
    }
  }
}
