/**
 * Pure helpers for the browser-only PTY surface. No engine credentials, no
 * service state, and no browser globals are read here: callers pass the page
 * location in explicitly so this module stays trivially testable.
 *
 * The server bridge (`server/pty-websocket-bridge.ts`) owns the engine Basic
 * credential and performs Host/Origin checks on the upgrade. The browser only
 * ever sees a short-lived connect ticket, which is placed in the query string
 * exactly as the native `@opencode/client` PTY client does.
 */

export type ConnectTicket = {
  ticket: string
  expiresIn: number | null
}

export type TicketQueryParams = {
  ticket: string
  directory?: string
  cursor?: number
}

export type PageLocation = {
  protocol: string
  host: string
}

/** Strip control characters (including ANSI escapes) and cap the length so a
 * close frame or error string can never inject terminal control sequences or
 * flood the UI. Plain text only; React still escapes it when rendered. */
export function sanitizeTerminalText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback
  const cleaned = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned ? cleaned.slice(0, 160) : fallback
}

/** Build the query for `/api/pty/:id/connect`, matching the native client:
 * `location[directory]`, optional `cursor`, then `ticket`. */
export function buildConnectQuery(params: TicketQueryParams): URLSearchParams {
  const query = new URLSearchParams()
  if (params.directory) query.set("location[directory]", params.directory)
  if (params.cursor !== undefined && Number.isFinite(params.cursor)) {
    query.set("cursor", String(params.cursor))
  }
  query.set("ticket", params.ticket)
  return query
}

/**
 * Derive a same-origin WebSocket URL from the page location. `http:` maps to
 * `ws:` and `https:` maps to `wss:`; there is no HTTPS gate, so plain HTTP
 * (including non-loopback origins) works because the server bridge performs
 * the real authentication and Host/Origin validation.
 */
export function ptyWebSocketUrl(
  page: PageLocation,
  params: TicketQueryParams & { ptyID: string }
): string {
  const scheme = page.protocol === "https:" ? "wss:" : "ws:"
  const query = buildConnectQuery(params).toString()
  const path = `/api/pty/${encodeURIComponent(params.ptyID)}/connect`
  return query ? `${scheme}//${page.host}${path}?${query}` : `${scheme}//${page.host}${path}`
}

/**
 * An opaque connect ticket is a credential, not display text: validate its
 * charset and length directly instead of sanitizing it. Any unexpected byte is
 * a hard error rather than a silently rewritten ticket.
 */
const CONNECT_TICKET_MAX_LENGTH = 512
const CONNECT_TICKET_PATTERN = /^[A-Za-z0-9._~+/=-]+$/

export function isValidConnectTicket(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CONNECT_TICKET_MAX_LENGTH &&
    CONNECT_TICKET_PATTERN.test(value)
  )
}

/**
 * Parse a `pty.connect.token` response. The native client returns
 * `{ data: { ticket, expires_in } }`; the bare token shape is accepted too so
 * a future/simple proxy response still works. Never trust the values: a
 * missing, blank, or malformed ticket is a hard error rather than a silent
 * bad request.
 */
export function parseConnectTicket(response: unknown): ConnectTicket {
  const candidate =
    typeof response === "object" && response !== null && "data" in response
      ? (response as { data: unknown }).data
      : response
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Connect ticket response was empty")
  }
  const record = candidate as { ticket?: unknown; expires_in?: unknown; expiresIn?: unknown }
  if (typeof record.ticket !== "string" || !record.ticket.trim()) {
    throw new Error("Connect ticket was missing")
  }
  const ticket = record.ticket.trim()
  if (!isValidConnectTicket(ticket)) {
    throw new Error("Connect ticket was invalid")
  }
  const rawExpiry = record.expires_in ?? record.expiresIn
  const expiresIn =
    typeof rawExpiry === "number" && Number.isFinite(rawExpiry) && rawExpiry >= 0
      ? rawExpiry
      : null
  return { ticket, expiresIn }
}

/** Turn a WebSocket close/error into an honest, sanitized user message. The
 * bridge only ever sends generic reasons, but we treat them as untrusted. */
export function terminalDisconnectMessage(event?: {
  code?: number
  reason?: unknown
  wasClean?: boolean
}): string {
  const reason = sanitizeTerminalText(event?.reason)
  const code = event?.code
  if (code === 1013 || /backpressure/i.test(reason)) {
    return "Terminal disconnected — backpressure limit reached"
  }
  if (code === 1009 || /message too large/i.test(reason)) {
    return "Terminal disconnected — message too large"
  }
  if (code === 1000 && event?.wasClean) return "Terminal closed"
  return reason ? `Terminal disconnected — ${reason}` : "Terminal disconnected"
}
