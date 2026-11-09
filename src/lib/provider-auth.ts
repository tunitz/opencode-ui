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
  return method.type === "key" || method.type === "oauth"
}

export function pollDeadline(expires: number, now = Date.now(), maxMs = 5 * 60 * 1000): number {
  const finiteExpiry = Number.isFinite(expires) ? expires : now + maxMs
  return Math.min(finiteExpiry, now + maxMs)
}
