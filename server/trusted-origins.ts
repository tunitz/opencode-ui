import { networkInterfaces } from "node:os"

import { isLoopbackHost, validateHostname, validateOrigin } from "./bun-config.ts"

export type ResolvedTrust = {
  allowedHosts: string[]
  allowedOrigins: string[]
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"] as const

function isPrivateIPv4(value: string): boolean {
  const octets = value.split(".").map((part) => Number(part))
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  const [first, second] = octets
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
}

/**
 * Literal RFC1918 addresses assigned to this host. Tailscale's 100.64/10 range
 * and public addresses are deliberately excluded; those need explicit flags.
 */
export function localLanHosts(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
  const hosts = new Set<string>()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      const family = entry.family === "IPv4" || (entry.family as unknown) === 4
      if (!family || !isPrivateIPv4(entry.address)) continue
      hosts.add(entry.address)
    }
  }
  return [...hosts].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
}

/**
 * Resolve the Host/Origin allowlists without weakening either check.
 *
 * Explicit origins also supply their hostname; explicit non-loopback hosts get
 * a matching plain-HTTP origin. With no explicit trust and a non-loopback bind,
 * the host's own private LAN addresses are used.
 */
export function resolveTrustedOrigins(input: {
  hostname?: string
  port: number
  allowedHosts?: readonly string[]
  allowedOrigins?: readonly string[]
  localHosts?: readonly string[]
}): ResolvedTrust {
  const hostname = validateHostname(input.hostname ?? "127.0.0.1")
  const explicitHosts = (input.allowedHosts ?? []).map(validateHostname)
  const explicitOrigins = (input.allowedOrigins ?? []).map(validateOrigin)

  const allowedHosts = new Set<string>(LOOPBACK_HOSTS)
  const allowedOrigins = new Set<string>(
    LOOPBACK_HOSTS.map((host) => `http://${host}:${input.port}`),
  )

  for (const origin of explicitOrigins) {
    allowedOrigins.add(origin)
    allowedHosts.add(new URL(origin).hostname.toLowerCase())
  }

  for (const host of explicitHosts) {
    allowedHosts.add(host)
    if (!isLoopbackHost(host)) allowedOrigins.add(`http://${host}:${input.port}`)
  }

  if (explicitHosts.length === 0 && explicitOrigins.length === 0 && !isLoopbackHost(hostname)) {
    for (const host of input.localHosts ?? localLanHosts()) {
      const valid = validateHostname(host)
      allowedHosts.add(valid)
      allowedOrigins.add(`http://${valid}:${input.port}`)
    }
  }

  return {
    allowedHosts: [...allowedHosts],
    allowedOrigins: [...allowedOrigins],
  }
}
