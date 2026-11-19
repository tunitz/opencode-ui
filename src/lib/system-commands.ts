import type { ServerInfo } from "@opencode/client"

import type { OpenCodeController } from "@/lib/use-opencode"

/* -------------------------------------------------------------------------- */
/* Pure helpers shared by the system command dialogs and tests.               */
/* No browser globals and no React: callers pass everything in explicitly.    */
/* -------------------------------------------------------------------------- */

function versionParts(value: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value)
  if (!match) return [0, 0, 0]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Compare dotted numeric versions. Missing/unparseable parts count as zero. */
export function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export const USAGE_MIN_VERSION = "2.3.2"

export function isVersionAtLeast(
  version: string | null | undefined,
  minimum: string
): boolean {
  if (!version) return false
  return compareVersions(version, minimum) >= 0
}

/**
 * /usage limits landed upstream in v2.3.2 (verified in
 * packages/protocol/src/groups/usage.ts and the v2.3.2 OpenAPI document).
 * The pinned v2.1.4 client has no typed method, so the dialog uses a raw,
 * deliberately version-gated fetch rather than downgrading the command.
 */
export function supportsUsageLimits(version: string | null | undefined): boolean {
  return isVersionAtLeast(version, USAGE_MIN_VERSION)
}

// A version is interpolated into a public URL; never allow path/query injection.
export function safeReleaseVersion(
  version: string | null | undefined
): string | null {
  if (!version) return null
  const trimmed = version.trim()
  return /^[0-9][0-9A-Za-z.+-]{0,40}$/.test(trimmed) ? trimmed : null
}

export function changelogUrl(version: string): string {
  return `https://raw.githubusercontent.com/anomalyco/opencode/v${version}/CHANGELOG.md`
}

export function releaseNotesUrl(version: string): string {
  return `https://github.com/anomalyco/opencode/releases/tag/v${version}`
}

/** Only credential-free http(s) URLs from server info may be shown/opened. */
export function safeServerUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export type ReleaseHighlight = { title: string; body: string }

const TRAILING_LINK = /(?:\s*\(\[[^\]]*\]\([^)]+\)\))\s*$/

function stripTrailingLinks(text: string): string {
  let value = text.trim()
  while (TRAILING_LINK.test(value)) {
    value = value.replace(TRAILING_LINK, "").trim()
  }
  return value
}

/**
 * Parse the upstream `### Highlights` section: bullets shaped
 * `- **Title**: Body ([#1234](https://github.com/.../pull/1234))`.
 * Trailing PR/commit links are removed; nothing is invented when absent.
 */
export function parseHighlights(changelog: string, limit = 5): ReleaseHighlight[] {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => /^###\s+Highlights\s*$/i.test(line.trim()))
  if (start === -1) return []
  const items: ReleaseHighlight[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^#{1,6}\s/.test(line.trim())) break
    // Upstream highlights are top-level bullets; indented/nested bullets are not highlights.
    const match = /^[-*]\s+\*\*(.+?)\*\*\s*:\s*(.+)$/.exec(line)
    if (!match) continue
    const title = match[1].trim()
    const body = stripTrailingLinks(match[2])
    if (title && body) items.push({ title, body })
    if (items.length >= Math.max(1, limit)) break
  }
  return items
}

/** Bounded, credential-free request to a public, read-only source. */
export function highlightRequestInit(timeoutMs = 5000): RequestInit {
  let signal: AbortSignal
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    signal = AbortSignal.timeout(timeoutMs)
  } else {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), timeoutMs)
    signal = controller.signal
  }
  return { signal, credentials: "omit", headers: { accept: "text/plain" } }
}

/**
 * Reuse the existing bracketed location query used by other native fetches.
 * The path is the upstream v2.3.2 native route (see supportsUsageLimits above).
 */
export function usageLimitsUrl(directory: string): string {
  return `/api/experimental/usage/limits?${new URLSearchParams({ "location[directory]": directory })}`
}

export type UsageLimitsPlan =
  | { fetch: true; url: string }
  | { fetch: false; reason: "unsupported-version" | "missing-directory" }

/**
 * Decide whether the /usage dialog may fetch native limits. The version gate
 * runs first so the pinned v2.1.4 engine never receives the raw request.
 */
export function planUsageLimitsRequest(
  version: string | null | undefined,
  directory: string | null | undefined
): UsageLimitsPlan {
  if (!supportsUsageLimits(version)) return { fetch: false, reason: "unsupported-version" }
  if (!directory) return { fetch: false, reason: "missing-directory" }
  return { fetch: true, url: usageLimitsUrl(directory) }
}

export function finiteExpiry(value: number | string): number {
  return typeof value === "number" ? value : Number.NaN
}

const SENSITIVE_KEY = /(secret|token|password|credential|authorization|api[_-]?key)/i

/** Flatten an unknown native payload into a small, safe label/value list. */
export function flattenUsagePayload(
  value: unknown,
  limit = 30
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const walk = (record: Record<string, unknown>, prefix: string) => {
    for (const [key, item] of Object.entries(record)) {
      if (SENSITIVE_KEY.test(key)) continue
      const label = prefix ? `${prefix}.${key}` : key
      if (item && typeof item === "object" && !Array.isArray(item)) {
        walk(item as Record<string, unknown>, label)
      } else if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        rows.push({ label, value: String(item) })
      }
      if (rows.length >= limit) return
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    walk(value as Record<string, unknown>, "")
  }
  return rows.slice(0, limit)
}

/** Allowlisted status lines shared by the /status dialog and inline status. */
export function buildStatusLines(
  info: ServerInfo | null,
  controller: Pick<
    OpenCodeController,
    "connection" | "streamStatus" | "scope" | "location" | "activeSession"
  >
): string[] {
  const session = controller.activeSession
  const project =
    controller.scope === "all"
      ? "All projects"
      : (controller.location?.project.canonical ?? "No project")
  const model = session?.model
    ? `${session.model.providerID}/${session.model.id}${session.model.variant ? ` · ${session.model.variant}` : ""}`
    : "none"
  const urls = info
    ? info.urls.map(safeServerUrl).filter((value): value is string => Boolean(value))
    : []
  return [
    `Connection: ${controller.connection}`,
    `Stream: ${controller.streamStatus}`,
    `Project: ${project}`,
    session ? `Session: ${session.id}` : "Session: none",
    `Model: ${model}`,
    `Server version: ${info?.version ?? "unavailable"}`,
    ...(info ? [`Server PID: ${info.pid}`] : []),
    ...(info ? [`Server URLs: ${urls.join(", ") || "none"}`] : []),
    ...(info?.capabilities?.persistentPty !== undefined
      ? [`Persistent PTY: ${info.capabilities.persistentPty ? "available" : "unavailable"}`]
      : []),
  ]
}
