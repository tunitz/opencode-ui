import { isIP } from "node:net"

/** Only these deliberately authored diagnostics may be printed by the CLI. */
export class BunConfigurationError extends Error {}

export function validatePort(value: string | number): number {
  if (!/^\d+$/.test(String(value))) throw new BunConfigurationError("UI port must be an integer from 1 to 65535 (--port or OPENCODE_UI_PORT).")
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BunConfigurationError("UI port must be an integer from 1 to 65535 (--port or OPENCODE_UI_PORT).")
  return port
}

/** Canonical Host-header form, including brackets around IPv6 literals. */
export function validateHostname(value: string): string {
  const host = value.toLowerCase()
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (isIP(bare) === 6) return new URL(`http://[${bare}]`).hostname
  if (isIP(host) === 4) return host
  if (host.length > 253 || /^[\d.]+$/.test(host) || !host.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) {
    throw new BunConfigurationError("Host must be a hostname or IP address, without a scheme, port, path, credentials, or wildcard (--host / --allowed-host).")
  }
  return host
}

export function validateOrigin(value: string): string {
  try {
    if (!/^https?:\/\/[^/?#\\\s@]+\/?$/i.test(value)) throw new Error()
    const url = new URL(value)
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error()
    validateHostname(url.hostname)
    return url.origin
  } catch {
    throw new BunConfigurationError("Use an absolute HTTP(S) origin without credentials, a path, query, fragment, or wildcard (--engine-url / --allowed-origin).")
  }
}

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "[::1]" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."))
}

export function validatePath(value: string): string {
  if (!value.trim() || value.includes("\0")) throw new BunConfigurationError("Artifact-root paths must be nonempty filesystem paths.")
  return value
}
