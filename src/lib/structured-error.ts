/**
 * Turn a native structured error into one bounded, human-readable line.
 *
 * Provider failures often carry the actionable cause (for example an expired
 * subscription or exhausted credits) in the response body while `message` is
 * generic. Only message-like fields are extracted; raw provider payloads,
 * HTML documents, and request details are never shown.
 */

export type StructuredErrorLike = {
  type?: string | null
  message?: string | null
  status?: number | null
  response?: { body?: string | null } | null
}

const MAX_MESSAGE_CHARS = 800
const MAX_BODY_CHARS = 16_384

function clean(value: string): string {
  let out = ""
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x7f) continue
    if (code < 0x20 && char !== "\t" && char !== "\n" && char !== "\r") continue
    out += char
  }
  return out.replace(/\s+/g, " ").trim()
}

function messageField(value: unknown, depth = 0): string | null {
  if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>

  for (const key of ["message", "error_description", "detail"]) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.trim()) {
      return clean(candidate)
    }
  }

  const nested = record.error
  if (typeof nested === "string" && nested.trim()) {
    return clean(nested)
  }
  if (nested && typeof nested === "object") {
    const found = messageField(nested, depth + 1)
    if (found) return found
  }

  return null
}

function responseDetail(body: string | null | undefined): string | null {
  if (typeof body !== "string" || !body) return null
  const trimmed = body.trim()
  if (!trimmed) return null

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(0, MAX_BODY_CHARS))
      return messageField(parsed)
    } catch {
      return null
    }
  }

  // Never surface an HTML error page or an unbounded provider payload.
  if (/^<!doctype|^<html|^<\?xml/i.test(trimmed)) return null
  if (trimmed.startsWith("<")) return null

  const cleaned = clean(trimmed)
  return cleaned || null
}

export function structuredErrorMessage(
  error: StructuredErrorLike | null | undefined
): string | null {
  if (!error) return null

  const primary = typeof error.message === "string" ? clean(error.message) : ""
  const detail = responseDetail(error.response?.body)
  const combined =
    detail && detail !== primary
      ? primary
        ? `${primary} — ${detail}`
        : detail
      : primary

  const fallback =
    combined ||
    (typeof error.status === "number"
      ? `Request failed with status ${error.status}.`
      : "")

  if (!fallback) return null
  return fallback.length > MAX_MESSAGE_CHARS
    ? `${fallback.slice(0, MAX_MESSAGE_CHARS - 1)}…`
    : fallback
}
