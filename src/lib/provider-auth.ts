import type { IntegrationInfo, IntegrationMethod } from "@/lib/opencode"

/** Only explicit absolute HTTPS authorization URLs may be opened by the user. */
export function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export const safeOAuthUrl = safeExternalUrl

/**
 * Accept either an authorization code or the full redirect URL a browser
 * landed on. This mirrors the TUI's paste fallback for remote/headless flows.
 */
export function parseOAuthCallback(
  input: string,
  authorizeUrl?: string | null
): { code: string | null; error: string | null } {
  const value = input.trim()
  if (!value) return { code: null, error: "Paste the redirect URL or authorization code." }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    // A bare code is valid for code-mode attempts; reject other free text.
    if (/^[A-Za-z0-9._~-]{1,4096}$/.test(value)) return { code: value, error: null }
    return { code: null, error: "Paste the full URL from the browser address bar." }
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { code: null, error: "Only HTTP(S) redirect URLs are accepted." }
  }

  const providerError = url.searchParams.get("error")
  if (providerError) {
    return { code: null, error: `The provider returned an error: ${providerError}` }
  }

  const pastedState = url.searchParams.get("state")
  if (authorizeUrl && pastedState) {
    try {
      const expectedState = new URL(authorizeUrl).searchParams.get("state")
      if (expectedState && expectedState !== pastedState) {
        return { code: null, error: "This URL belongs to a different sign-in attempt." }
      }
    } catch {
      // An invalid authorize URL cannot be used for state verification.
    }
  }

  const fromHash = new URLSearchParams(url.hash.replace(/^#/, ""))
  const code =
    url.searchParams.get("code") ?? fromHash.get("code") ?? fromHash.get("access_token")
  if (!code) return { code: null, error: "The redirect URL has no authorization code." }
  return { code, error: null }
}

/** Prevent a submitted secret from being reflected in an upstream error string. */
export function redactSecret(message: string, secret: string): string {
  if (!secret) return message
  return message.split(secret).join("[redacted]")
}

export function connectedSummary(integration: IntegrationInfo): string | null {
  if (integration.connections.some((connection) => connection.status?.status === "needs_auth")) {
    return "Sign in required"
  }
  if (integration.connections.length > 1) {
    return `${integration.connections.length} connections`
  }
  const connection = integration.connections[0]
  if (!connection) return null
  return connection.type === "credential" ? connection.label : `$${connection.name}`
}

export function connectMethodLabel(method: IntegrationMethod): string {
  if (method.type === "key") return method.label ?? "API key"
  if (method.type === "env") {
    return `Environment: ${method.names.map((name) => `$${name}`).join(", ")}`
  }
  return method.label
}

export function isBrowserConnectMethod(method: IntegrationMethod): boolean {
  // `env` reads a process variable and has no browser-native API; every other
  // method has a typed native client call that works over plain HTTP.
  return method.type === "key" || method.type === "oauth" || method.type === "external" || method.type === "command"
}

export function pollDeadline(expires: number, now = Date.now(), maxMs = 5 * 60 * 1000): number {
  const finiteExpiry = Number.isFinite(expires) ? expires : now + maxMs
  return Math.min(finiteExpiry, now + maxMs)
}
