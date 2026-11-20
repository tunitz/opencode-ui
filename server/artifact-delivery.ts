import {
  closeSync,
  createReadStream,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs"
import { randomBytes, createHash } from "node:crypto"
import { basename, extname, isAbsolute, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { Readable } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createProjectArtifacts } from "./project-artifacts.ts"

export const DEFAULT_ARTIFACT_ROOTS = ["/tmp/opencode/shots"] as const
export const DEFAULT_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024
export const DEFAULT_ARTIFACT_TTL_MS = 15 * 60 * 1000
export const DEFAULT_ARTIFACT_MAX_ENTRIES = 256
export const MAX_ARTIFACT_RESOLVE_BODY = 8 * 1024
export const MAX_ARTIFACT_SESSION_BYTES = 8 * 1024 * 1024

const ACTIVE_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".svg", ".svgz"])
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".csv", ".tsv", ".log",
  ".yaml", ".yml", ".toml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".css", ".scss", ".sass", ".less", ".py", ".rb", ".rs", ".go", ".java",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".sh", ".zsh", ".bash", ".sql", ".xml",
])
const SECRET_NAME = /^(?:\.env(?:\..*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|service\.json|auth\.json|credentials?(?:\..*)?|.*\.(?:pem|key|p12|pfx|kdbx))$/i

export type ArtifactKind = "image" | "pdf" | "text" | "binary"

export type ArtifactSummary = {
  id: string
  url: string
  name: string
  mime: string
  size: number
  kind: ArtifactKind
  toolName: string
  canonicalId: string
  width?: number
  height?: number
}

type ArtifactRecord = ArtifactSummary & {
  mtimeMs: number
  path: string
  sessionID: string
  createdAt: number
  expiresAt: number
  lastAccess: number
}

type ArtifactError = {
  status: number
  code: string
  message: string
}

type NativeMessagePart = {
  type?: string
  name?: string
  state?: {
    content?: Array<{ type?: string; text?: string }>
  }
}

type NativeMessage = {
  type?: string
  content?: NativeMessagePart[]
}

type ToolText = {
  toolName: string
  text: string
}

type ArtifactDeliveryOptions = {
  roots?: readonly string[]
  opencodeBaseUrl?: string
  authorization?: string
  getTarget?: () => { opencodeBaseUrl: string; authorization?: string }
  fetch?: typeof fetch
  fetchSessionMessages?: (sessionID: string) => Promise<NativeMessage[]>
  ttlMs?: number
  maxBytes?: number
  maxEntries?: number
  now?: () => number
}

function normalizeRoots(roots: readonly string[] | undefined): string[] {
  // An explicit empty list disables local file delivery; only omission uses legacy roots.
  const values = roots ?? DEFAULT_ARTIFACT_ROOTS
  const normalized: string[] = []
  for (const value of values) {
    if (!value || !isAbsolute(value)) continue
    try {
      const real = realpathSync(value)
      if (statSync(real).isDirectory()) normalized.push(real)
    } catch {
      // Missing roots are simply unavailable; do not create them.
    }
  }
  return [...new Set(normalized)]
}

function trimReference(value: string): string {
  return value
    .replace(/[`*"'<>]+$/, "")
    .replace(/[.,;:]+$/, "")
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    url.hash = ""
    return url.href
  } catch {
    return null
  }
}

function normalizeHref(value: string): { kind: "url"; href: string; pathname: string; basename: string } | { kind: "path"; path: string } | null {
  const href = value.trim()
  if (!href || href.length > 4096 || href.includes("\0")) return null
  if (/^https?:\/\//i.test(href)) {
    const normalized = normalizeUrl(href)
    if (!normalized) return null
    const url = new URL(normalized)
    let pathname = url.pathname
    try {
      pathname = decodeURIComponent(pathname)
    } catch {
      return null
    }
    return { kind: "url", href: normalized, pathname, basename: basename(pathname) }
  }
  if (/^file:\/\//i.test(href)) {
    try {
      const path = fileURLToPath(href)
      if (path.includes("\0")) return null
      return { kind: "path", path }
    } catch {
      return null
    }
  }
  if (href.startsWith("//") || href.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(href)) {
    return null
  }
  if (href.startsWith("/")) {
    let path: string
    try {
      path = decodeURIComponent(href)
    } catch {
      return null
    }
    return { kind: "path", path }
  }
  return null
}

export function extractArtifactUrls(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[^\s)\]}>"'`]+/gi)) {
    const value = trimReference(match[0] ?? "")
    const normalized = normalizeUrl(value)
    if (normalized) found.add(normalized)
  }
  return [...found]
}

export function extractArtifactPaths(text: string): string[] {
  const found = new Set<string>()
  // Extract any absolute candidate path. The caller still enforces the
  // configured artifact roots with realpath checks; this avoids missing a
  // valid configured root merely because it is not under /tmp, /home, etc.
  for (const match of text.matchAll(/\/[^\s)\]}>"'`]+/g)) {
    const value = trimReference(match[0] ?? "")
    if (!value || value === "/" || value.startsWith("//") || value.includes("\0") || value.includes("\\")) continue
    found.add(value)
  }
  return [...found]
}

function toolTexts(messages: NativeMessage[]): ToolText[] {
  const values: ToolText[] = []
  for (const message of messages) {
    if (message.type !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "tool" || !part.name || !Array.isArray(part.state?.content)) continue
      for (const content of part.state.content) {
        if (content.type === "text" && typeof content.text === "string") {
          values.push({ toolName: part.name, text: content.text })
        }
      }
    }
  }
  return values
}

function matchToolReference(
  messages: NativeMessage[],
  href: string,
  roots: readonly string[]
): { path: string; toolName: string } | null {
  const requested = normalizeHref(href)
  if (!requested) return null
  const texts = toolTexts(messages)
  if (texts.length === 0) return null
  const inRoot = (candidate: string) => insideRoot(resolve(candidate), [...roots])

  if (requested.kind === "url") {
    const matchingUrl = texts.find((entry) =>
      extractArtifactUrls(entry.text).some((candidate) => normalizeUrl(candidate) === requested.href)
    )
    if (!matchingUrl) return null
    const candidates = extractArtifactPaths(matchingUrl.text).filter(
      (candidate) => basename(candidate) === requested.basename
    )
    // Prefer an in-root candidate when a tool message mentions several files
    // with the same basename. If only an outside-root candidate exists, keep
    // it so the caller can answer with the honest 403 root error instead of a
    // misleading 404 "no provenance".
    const path = candidates.find(inRoot) ?? candidates[0]
    return path ? { path, toolName: matchingUrl.toolName } : null
  }

  const exact = texts.find((entry) =>
    extractArtifactPaths(entry.text).some(
      (candidate) => resolve(candidate) === resolve(requested.path)
    )
  )
  if (!exact) return null
  const path = extractArtifactPaths(exact.text).find(
    (candidate) => resolve(candidate) === resolve(requested.path)
  )
  return path ? { path, toolName: exact.toolName } : null
}

function insideRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}${sep}`))
}

function sniffBytes(path: string): Uint8Array {
  const fd = openSync(path, "r")
  try {
    const buffer = Buffer.alloc(512)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return new Uint8Array(buffer.subarray(0, read))
  } finally {
    closeSync(fd)
  }
}

function startsAscii(bytes: Uint8Array, value: string): boolean {
  if (bytes.length < value.length) return false
  return value.split("").every((char, index) => bytes[index] === char.charCodeAt(0))
}

function activeText(bytes: Uint8Array, path: string): boolean {
  if (ACTIVE_EXTENSIONS.has(extname(path).toLowerCase())) return true
  const head = Buffer.from(bytes.subarray(0, 512)).toString("utf8").trimStart().toLowerCase()
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<svg") ||
    (head.startsWith("<?xml") && (head.includes("<svg") || head.includes("<html")))
  )
}

function sniffMime(path: string, bytes: Uint8Array): { mime: string; kind: ArtifactKind; width?: number; height?: number } | null {
  if (startsAscii(bytes, "\x89PNG\r\n\x1a\n")) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = bytes.length >= 24 ? view.getUint32(16) : undefined
    const height = bytes.length >= 24 ? view.getUint32(20) : undefined
    return {
      mime: "image/png",
      kind: "image",
      ...(width && height ? { width, height } : {}),
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", kind: "image" }
  }
  if (startsAscii(bytes, "GIF87a") || startsAscii(bytes, "GIF89a")) {
    return { mime: "image/gif", kind: "image" }
  }
  if (startsAscii(bytes, "RIFF") && bytes.length >= 12 && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return { mime: "image/webp", kind: "image" }
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(4, 12)).toString("ascii").startsWith("ftypavi")) {
    return { mime: "image/avif", kind: "image" }
  }
  if (startsAscii(bytes, "%PDF-")) return { mime: "application/pdf", kind: "pdf" }
  if (activeText(bytes, path)) return { mime: "text/html", kind: "binary" }
  const extension = extname(path).toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) {
    const sample = bytes.subarray(0, 32)
    if (!sample.includes(0)) return { mime: "text/plain; charset=utf-8", kind: "text" }
  }
  return { mime: "application/octet-stream", kind: "binary" }
}

function fileError(status: number, code: string, message: string): ArtifactError {
  return { status, code, message }
}

function resolveArtifactFile({
  path,
  roots,
  maxBytes,
}: {
  path: string
  roots: string[]
  maxBytes: number
}): { path: string; name: string; mime: string; kind: ArtifactKind; size: number; mtimeMs: number; width?: number; height?: number } | ArtifactError {
  if (!path || path.includes("\0") || path.includes("\\") || !isAbsolute(path)) {
    return fileError(403, "unsafe_path", "Artifact path is not allowed.")
  }
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return fileError(404, "not_found", "Artifact is unavailable.")
  }
  if (!insideRoot(real, roots)) {
    return fileError(403, "outside_root", "Artifact is outside the approved artifact root.")
  }
  let stats
  try {
    stats = statSync(real)
  } catch {
    return fileError(404, "not_found", "Artifact is unavailable.")
  }
  if (!stats.isFile()) return fileError(403, "not_file", "Artifact is not a regular file.")
  if (stats.size <= 0 || stats.size > maxBytes) {
    return fileError(413, "size", "Artifact size is outside the allowed range.")
  }
  const name = basename(real)
  if (!name || SECRET_NAME.test(name)) {
    return fileError(403, "secret", "Artifact is not allowed.")
  }
  const bytes = sniffBytes(real)
  const mime = sniffMime(real, bytes)
  if (!mime) return fileError(415, "mime", "Artifact type is not allowed.")
  if (mime.kind === "binary" && ACTIVE_EXTENSIONS.has(extname(real).toLowerCase())) {
    return fileError(415, "active", "Active HTML/SVG artifacts cannot be served.")
  }
  if (mime.mime === "text/html") {
    return fileError(415, "active", "Active HTML/SVG artifacts cannot be served.")
  }
  return {
    path: real,
    name,
    mime: mime.mime,
    kind: mime.kind,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ...(mime.width && mime.height ? { width: mime.width, height: mime.height } : {}),
  }
}

function canonicalId(path: string, size: number, mtimeMs: number): string {
  return createHash("sha256")
    .update(`${path}\0${size}\0${mtimeMs}`)
    .digest("hex")
    .slice(0, 32)
}

function safeDownloadName(value: string): string {
  const stripped = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join("")
  return stripped
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 180) || "artifact"
}

function contentDisposition(name: string, inline: boolean, download: boolean): string {
  const disposition = inline && !download ? "inline" : "attachment"
  const safe = safeDownloadName(name)
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "artifact"
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function parseRange(value: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return "invalid"
  const [, rawStart = "", rawEnd = ""] = match
  if (!rawStart && !rawEnd) return "invalid"
  let start: number
  let end: number
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid"
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return "invalid"
    }
    if (start >= size) return "invalid"
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
    },
  })
}

function errorResponse(error: ArtifactError): Response {
  return jsonResponse(error.status, { error: { code: error.code, message: error.message } })
}

export function createArtifactDelivery(options: ArtifactDeliveryOptions = {}) {
  const projectArtifacts = createProjectArtifacts(options)
  const roots = normalizeRoots(options.roots)
  const ttlMs = options.ttlMs ?? DEFAULT_ARTIFACT_TTL_MS
  const maxBytes = options.maxBytes ?? DEFAULT_ARTIFACT_MAX_BYTES
  const maxEntries = options.maxEntries ?? DEFAULT_ARTIFACT_MAX_ENTRIES
  const now = options.now ?? Date.now
  const records = new Map<string, ArtifactRecord>()
  const canonicalIds = new Map<string, string>()
  const sessionMessages = new Map<string, { at: number; promise: Promise<NativeMessage[]> }>()

  const resolveTarget = () => {
    if (options.getTarget) return options.getTarget()
    return { opencodeBaseUrl: options.opencodeBaseUrl ?? "", authorization: options.authorization }
  }

  const fetchSessionMessages = options.fetchSessionMessages ?? (async (sessionID: string) => {
    const { opencodeBaseUrl, authorization } = resolveTarget()
    if (!opencodeBaseUrl) {
      throw fileError(503, "upstream", "Artifact source is unavailable.")
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await (options.fetch ?? fetch)(
        `${opencodeBaseUrl.replace(/\/$/, "")}/api/session/${encodeURIComponent(sessionID)}/message?limit=200&order=desc`,
        {
          headers: { ...(authorization ? { authorization } : {}), accept: "application/json" },
          redirect: "manual",
          proxy: false,
          signal: controller.signal,
        } as RequestInit
      )
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw fileError(404, "session", "Session artifact source is unavailable.")
      }
      const text = await response.text()
      if (text.length > MAX_ARTIFACT_SESSION_BYTES) throw fileError(502, "upstream", "Session artifact source is too large.")
      const body = JSON.parse(text) as unknown
      if (Array.isArray(body)) return body as NativeMessage[]
      if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
        return (body as { data: NativeMessage[] }).data
      }
      return []
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) throw error
      throw fileError(502, "upstream", "Session artifact source is unavailable.")
    } finally {
      clearTimeout(timeout)
    }
  })

  function loadSessionMessages(sessionID: string): Promise<NativeMessage[]> {
    const time = now()
    const cacheKey = `${resolveTarget().opencodeBaseUrl}\0${sessionID}`
    const cached = sessionMessages.get(cacheKey)
    if (cached && time - cached.at < 10_000) return cached.promise
    const promise = fetchSessionMessages(sessionID)
    if (sessionMessages.size >= 64) {
      const oldest = [...sessionMessages.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) sessionMessages.delete(oldest[0])
    }
    sessionMessages.set(cacheKey, { at: time, promise })
    void promise.catch(() => {
      if (sessionMessages.get(cacheKey)?.promise === promise) sessionMessages.delete(cacheKey)
    })
    return promise
  }

  function prune() {
    const time = now()
    for (const [id, record] of records) {
      if (record.expiresAt <= time) {
        records.delete(id)
        canonicalIds.delete(`${record.sessionID}:${record.canonicalId}`)
      }
    }
    if (records.size <= maxEntries) return
    const oldest = [...records.values()].sort((a, b) => a.lastAccess - b.lastAccess)
    for (const record of oldest.slice(0, records.size - maxEntries)) {
      records.delete(record.id)
      canonicalIds.delete(`${record.sessionID}:${record.canonicalId}`)
    }
  }

  function summary(record: ArtifactRecord): ArtifactSummary {
    return {
      id: record.id,
      url: `/api/ui/artifacts/${record.id}`,
      name: record.name,
      mime: record.mime,
      size: record.size,
      kind: record.kind,
      toolName: record.toolName,
      canonicalId: record.canonicalId,
      ...(record.width && record.height ? { width: record.width, height: record.height } : {}),
    }
  }

  async function resolve({ sessionID, href }: { sessionID: string; href: string }): Promise<ArtifactSummary> {
    if (!/^[A-Za-z0-9_-]{6,160}$/.test(sessionID)) {
      throw fileError(400, "session", "Session identifier is invalid.")
    }
    const requested = normalizeHref(href)
    if (!requested) throw fileError(400, "href", "Artifact link is not supported.")
    const messages = await loadSessionMessages(sessionID)
    const match = matchToolReference(messages, href, roots)
    if (!match) throw fileError(404, "provenance", "No verified tool artifact matches this link.")
    const file = resolveArtifactFile({ path: match.path, roots, maxBytes })
    if ("status" in file) throw file
    prune()
    const canonical = canonicalId(file.path, file.size, file.mtimeMs)
    const key = `${sessionID}:${canonical}`
    const existingId = canonicalIds.get(key)
    const existing = existingId ? records.get(existingId) : undefined
    if (existing && existing.expiresAt > now()) {
      existing.lastAccess = now()
      return summary(existing)
    }
    const id = randomBytes(24).toString("base64url")
    const record: ArtifactRecord = {
      id,
      url: `/api/ui/artifacts/${id}`,
      name: file.name,
      mime: file.mime,
      size: file.size,
      kind: file.kind,
      toolName: match.toolName,
      canonicalId: canonical,
      mtimeMs: file.mtimeMs,
      ...(file.width && file.height ? { width: file.width, height: file.height } : {}),
      path: file.path,
      sessionID,
      createdAt: now(),
      expiresAt: now() + ttlMs,
      lastAccess: now(),
    }
    records.set(id, record)
    canonicalIds.set(key, id)
    prune()
    return summary(record)
  }

  function get(id: string): ArtifactRecord | null {
    prune()
    const record = records.get(id)
    if (!record || record.expiresAt <= now()) return null
    try {
      const stats = statSync(record.path)
      if (!stats.isFile() || stats.size !== record.size || stats.mtimeMs !== record.mtimeMs) {
        records.delete(id)
        canonicalIds.delete(`${record.sessionID}:${record.canonicalId}`)
        return null
      }
    } catch {
      records.delete(id)
      canonicalIds.delete(`${record.sessionID}:${record.canonicalId}`)
      return null
    }
    record.lastAccess = now()
    return record
  }

  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname
    if (pathname === "/api/ui/project-artifacts" || pathname.startsWith("/api/ui/project-artifacts/")) return projectArtifacts.handleRequest(request)
    if (pathname === "/api/ui/artifacts/resolve") {
      if (request.method !== "POST") return jsonResponse(405, { error: { code: "method", message: "Method not allowed." } })
      let body: unknown
      try {
        const text = await request.text()
        if (new TextEncoder().encode(text).byteLength > MAX_ARTIFACT_RESOLVE_BODY) {
          return errorResponse(fileError(413, "body", "Request body is too large."))
        }
        body = JSON.parse(text)
      } catch {
        return errorResponse(fileError(400, "body", "Request body must be JSON."))
      }
      const sessionID = body && typeof body === "object" ? (body as { sessionID?: unknown }).sessionID : null
      const href = body && typeof body === "object" ? (body as { href?: unknown }).href : null
      if (typeof sessionID !== "string" || typeof href !== "string") {
        return errorResponse(fileError(400, "input", "sessionID and href are required."))
      }
      try {
        const data = await resolve({ sessionID, href })
        return jsonResponse(200, { data })
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && "code" in error && "message" in error) {
          return errorResponse(error as ArtifactError)
        }
        return errorResponse(fileError(500, "internal", "Artifact could not be resolved."))
      }
    }

    const match = /^\/api\/ui\/artifacts\/([A-Za-z0-9_-]{16,80})$/.exec(pathname)
    if (!match) return jsonResponse(404, { error: { code: "not_found", message: "Artifact route not found." } })
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse(405, { error: { code: "method", message: "Method not allowed." } })
    }
    const record = get(match[1] ?? "")
    if (!record) return jsonResponse(404, { error: { code: "not_found", message: "Artifact is unavailable." } })
    const range = parseRange(request.headers.get("range"), record.size)
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${record.size}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      })
    }
    const download = url.searchParams.get("download") === "1"
    const start = range ? range.start : 0
    const end = range ? range.end : record.size - 1
    const length = end - start + 1
    const headers: Record<string, string> = {
      "content-type": record.mime,
      "content-length": String(length),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-disposition": contentDisposition(record.name, record.kind === "image", download),
    }
    if (range) headers["content-range"] = `bytes ${start}-${end}/${record.size}`
    if (request.method === "HEAD") {
      return new Response(null, { status: range ? 206 : 200, headers })
    }
    const nodeStream = createReadStream(record.path, { start, end })
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    })
  }

  return { handleRequest, resolve, get, roots, maxBytes, maxEntries, ttlMs }
}

export type ArtifactDelivery = ReturnType<typeof createArtifactDelivery>

function headersFromNode(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (typeof value === "string") {
      headers.set(key, value)
    }
  }
  return headers
}

async function readNodeBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    total += buffer.byteLength
    if (total > limit) throw new Error("body too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function createArtifactMiddleware(delivery: ArtifactDelivery) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = new URL(request.url ?? "/", "http://local").pathname
    if (pathname !== "/api/ui" && !pathname.startsWith("/api/ui/")) {
      next()
      return
    }
    void (async () => {
      try {
        const host = request.headers.host ?? "127.0.0.1"
        const body = request.method === "POST" || request.method === "PUT" || request.method === "PATCH"
          ? await readNodeBody(request, MAX_ARTIFACT_RESOLVE_BODY)
          : undefined
        const webRequest = new Request(`http://${host}${request.url ?? "/"}`, {
          method: request.method,
          headers: headersFromNode(request),
          body: body && body.byteLength > 0 ? body : undefined,
          ...(body ? { duplex: "half" as const } : {}),
        })
        const webResponse = await delivery.handleRequest(webRequest)
        response.statusCode = webResponse.status
        webResponse.headers.forEach((value, key) => response.setHeader(key, value))
        if (!webResponse.body) {
          response.end()
          return
        }
        Readable.fromWeb(webResponse.body as import("node:stream/web").ReadableStream)
          .on("error", () => response.destroy())
          .pipe(response)
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === "body too large"
        if (!response.headersSent) {
          response.statusCode = tooLarge ? 413 : 500
          response.setHeader("content-type", "application/json; charset=utf-8")
          response.setHeader("cache-control", "private, no-store")
        }
        response.end(JSON.stringify({ error: { code: tooLarge ? "body" : "internal", message: tooLarge ? "Request body is too large." : "Artifact request failed." } }))
      }
    })()
  }
}
