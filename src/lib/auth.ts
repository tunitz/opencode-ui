export type AuthStatus = {
  configured: boolean
  required: boolean
  authenticated: boolean
}

type AuthErrorBody = {
  error?: {
    code?: unknown
    message?: unknown
  }
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_required: "Sign in to continue.",
  setup_required: "Set a password to continue.",
  invalid_credentials: "That password is incorrect.",
  too_many_attempts: "Too many attempts. Try again in a minute.",
  not_configured: "No password is set yet. Set one to sign in.",
  already_configured: "A password is already set.",
  password_required: "A password is required on this network.",
  invalid: "Use a password of 8–256 characters.",
  not_found: "The auth endpoint was not found.",
  method_not_allowed: "The server rejected this request.",
  internal_error: "The server could not complete the request.",
  network: "The server could not be reached.",
  invalid_response: "The server returned an unexpected auth status.",
  request_failed: "The auth request failed.",
}

/** Engine-proxied `/api/*` failures are not UI password failures. */
function isUiApiRequest(input: Parameters<typeof fetch>[0]): boolean {
  const raw =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : ""
  if (!raw) return false
  try {
    const base =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    return new URL(raw, base).pathname.startsWith("/api/ui/")
  } catch {
    return false
  }
}

/** Expected auth failures carry the HTTP status and stable server error code. */
export class AuthApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? AUTH_ERROR_MESSAGES[code] ?? "The auth request failed.")
    this.name = "AuthApiError"
    this.status = status
    this.code = code
  }
}

/** True when a gated API response reports that a session or password is needed. */
export function isAuthErrorPayload(body: unknown): boolean {
  if (!body || typeof body !== "object") return false
  const error = (body as AuthErrorBody).error
  if (!error || typeof error !== "object") return false
  return error.code === "auth_required" || error.code === "setup_required"
}

type UnauthorizedHandler = (code?: string) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

export function registerUnauthorizedHandler(
  handler: UnauthorizedHandler | null
): () => void {
  unauthorizedHandler = handler
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null
  }
}

export function notifyUnauthorized(code?: string): void {
  unauthorizedHandler?.(code)
}

/**
 * Fetch wrapper that forwards mid-session 401 auth/setup errors from any gated
 * `/api/*` call straight to the active `AuthGateProvider` without polling.
 */
export async function authAwareFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status === 401 && unauthorizedHandler && isUiApiRequest(input)) {
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    if (isAuthErrorPayload(body)) {
      const code = (body as AuthErrorBody).error?.code
      unauthorizedHandler(typeof code === "string" ? code : undefined)
    }
  }
  return response
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new AuthApiError(0, "network")
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorFrom(status: number, body: unknown): AuthApiError {
  const error = (body as AuthErrorBody | null)?.error
  const code =
    typeof error?.code === "string" && error.code
      ? error.code
      : "request_failed"
  const message =
    typeof error?.message === "string" && error.message
      ? error.message
      : undefined
  return new AuthApiError(status, code, message)
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await request("/api/ui/auth/status")
  const body = await readBody(response)
  if (!response.ok) throw errorFrom(response.status, body)
  const status = body as Partial<AuthStatus> | null
  if (
    !status ||
    typeof status.configured !== "boolean" ||
    typeof status.required !== "boolean" ||
    typeof status.authenticated !== "boolean"
  ) {
    throw new AuthApiError(response.status, "invalid_response")
  }
  return {
    configured: status.configured,
    required: status.required,
    authenticated: status.authenticated,
  }
}

async function send(
  path: string,
  method: "POST" | "PUT",
  payload?: unknown
): Promise<void> {
  const response = await request(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) throw errorFrom(response.status, await readBody(response))
}

export function setupPassword(password: string): Promise<void> {
  return send("/api/ui/auth/setup", "POST", { password })
}

export function login(password: string): Promise<void> {
  return send("/api/ui/auth/login", "POST", { password })
}

export function logout(): Promise<void> {
  return send("/api/ui/auth/logout", "POST")
}

export function changePassword(current: string, next: string): Promise<void> {
  return send("/api/ui/auth/password", "PUT", { current, next })
}
