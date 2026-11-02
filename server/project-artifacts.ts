import { createHash, randomBytes } from "node:crypto"
import { posix } from "node:path"
import { fromMarkdown } from "mdast-util-from-markdown"
import type { ArtifactSummary } from "./artifact-delivery.ts"

type Options = { opencodeBaseUrl?: string; authorization?: string; fetch?: typeof fetch }
type Location = { directory: string; workspaceID?: string }
type Message = {
  id: string; type: string; outcome?: string; finish?: string; error?: unknown
  time?: { completed?: number }; content?: { type: string; text?: string }[]
  location?: Location; previous?: { location?: Location }
}
type RecordEntry = { sessionID: string; messageID: string; href: string; directory: string; path: string }
class Failure extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
const unavailable = () => new Failure(404, "unavailable", "Project attachment is unavailable.")
const outside = () => new Failure(403, "outside", "Attachment is outside the project.")
const hasControls = (value: string) => Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const safeHeaders = {
  "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer",
  "content-security-policy": "sandbox; default-src 'none'",
}
function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { ...safeHeaders, "content-type": "application/json; charset=utf-8" } })
}

/** Parse Markdown, not prose/regex: code, images and bare paths never grant access. */
export function projectMarkdownLinks(text: string): string[] {
  const tree = fromMarkdown(text)
  const definitions = new Map<string, string>()
  const links: string[] = []
  type Node = { type: string; url?: string; identifier?: string; children?: Node[] }
  const visit = (node: Node, fn: (node: Node) => void) => { fn(node); node.children?.forEach((child) => visit(child, fn)) }
  visit(tree, (node) => { if (node.type === "definition" && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url) })
  visit(tree, (node) => {
    if (node.type === "link" && node.url) links.push(node.url)
    if (node.type === "linkReference" && node.identifier && definitions.has(node.identifier)) links.push(definitions.get(node.identifier)!)
  })
  return links
}

export function projectRelativePath(href: string, directory: string): string {
  // Decode exactly once, then encode each segment for the engine's single decode.
  if (!href || href !== href.trim() || hasControls(href) || /[\\?#]/.test(href) || href.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(href)) throw outside()
  let path: string
  try { path = decodeURIComponent(href) } catch { throw outside() }
  if (hasControls(path) || /[\\?#]/.test(path) || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path) || path.split("/").includes("..")) throw outside()
  if (!posix.isAbsolute(directory) || directory.includes("\\") || hasControls(directory)) throw unavailable()
  const root = posix.normalize(directory)
  if (posix.isAbsolute(path)) {
    path = posix.relative(root, posix.normalize(path))
    if (path === ".." || path.startsWith("../")) throw outside()
  }
  path = posix.normalize(path)
  if (!path || path === "." || path.startsWith("/")) throw outside()
  return path
}

  const mime = value?.split(";", 1)[0]?.toLowerCase()
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mime ?? "")) return { mime: mime!, kind: "image" }
  if (mime === "application/pdf") return { mime, kind: "pdf" }
  if (mime?.startsWith("text/") && !["text/html", "text/xml"].includes(mime)) return { mime: "text/plain; charset=utf-8", kind: "text" }
  return { mime: "application/octet-stream", kind: "binary" }
}
function disposition(name: string, inline: boolean) {
  const safe = Array.from(name).slice(0, 180).map((char) => hasControls(char) || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) ? "_" : char).join("").replace(/["\\/\u202a-\u202e\u2066-\u2069]/g, "_") || "attachment"
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_")
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`
}

export function createProjectArtifacts(options: Options) {
  // Capabilities are process-local, not a path API. No artifact count or byte cap.
  const records = new Map<string, RecordEntry>()
  const ids = new Map<string, string>()
  const upstreamFetch = options.fetch ?? fetch
  async function upstream(path: string, signal: AbortSignal, headers?: Record<string, string>) {
    if (!options.opencodeBaseUrl || !options.authorization) throw unavailable()
    return upstreamFetch(`${options.opencodeBaseUrl.replace(/\/$/, "")}${path}`, {
      headers: { authorization: options.authorization, ...Object.fromEntries(new Headers(headers)) },
      redirect: "manual", signal,
      // Bun must not send the server-held credential through HTTP(S)_PROXY.
      proxy: false,
    } as RequestInit)
  }
  async function data<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await upstream(path, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
    if (response.status !== 200) { await response.body?.cancel(); throw unavailable() }
    return await response.json() as T
  }
  async function verify(sessionID: string, messageID: string, href: string, signal: AbortSignal): Promise<RecordEntry> {
    const session = await data<{ data: { location: Location } }>(`/api/session/${sessionID}`, signal)
    const messages: Message[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const query = cursor ? `cursor=${encodeURIComponent(cursor)}` : "order=asc&limit=200"
      const page = await data<{ data: Message[]; cursor: { next?: string } }>(`/api/session/${sessionID}/message?${query}`, signal)
      if (!Array.isArray(page.data) || !page.cursor) throw unavailable()
      messages.push(...page.data)
      if (page.data.length === 0) break
      cursor = page.cursor.next
      if (cursor && cursors.has(cursor)) throw unavailable()
      if (cursor) cursors.add(cursor)
    } while (cursor)
    const index = messages.findIndex((message) => message.id === messageID)
    if (index < 0) throw unavailable()
    const message = messages[index]!
    const end = messages.findIndex((item, i) => i > index && item.type === "idle")
    if (end < 0 || messages[end]!.outcome !== "succeeded" || messages[end]!.error != null) throw unavailable()
    let start = index
    while (start > 0 && messages[start - 1]!.type !== "idle") start--
    const turn = messages.slice(start, end)
    const last = turn.filter((item) => item.type === "assistant").at(-1)
    if (last?.id !== messageID || message.finish !== "stop" || message.time?.completed == null || message.error != null || turn.some((item) => item.type === "location-switched")) throw unavailable()
    if (!message.content?.some((part) => part.type === "text" && typeof part.text === "string" && projectMarkdownLinks(part.text).includes(href))) throw unavailable()
    const location = session.data.location
    // Public history omits workspace placement. Even a previous directory cannot
    // prove the historical filesystem identity across a switch. Fail closed.
    if (messages.slice(index + 1).some((item) => item.type === "location-switched")) throw unavailable()
    // 2.1.4 fs operations are host-backed even for workspace placements (#44568).
    if (!location || location.workspaceID) throw unavailable()
    return { sessionID, messageID, href, directory: location.directory, path: projectRelativePath(href, location.directory) }
  }
  function filePath(record: RecordEntry) {
    return `/api/fs/read/${record.path.split("/").map(encodeURIComponent).join("/")}?${new URLSearchParams({ "location[directory]": record.directory })}`
  }
  async function open(record: RecordEntry, request: Request, range?: string) {
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal])
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await upstream(filePath(record), signal, range ? { range } : undefined)
      if (![200, 206, 416].includes(response.status)) { await response.body?.cancel(); throw unavailable() }
      return { response, controller }
    } finally { clearTimeout(timer) }
  }
  async function metadata(record: RecordEntry, request: Request) {
    const { response, controller } = await open(record, request, "bytes=0-0")
    try {
      const total = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1] ?? (response.status === 200 ? response.headers.get("content-length") : null)
      const size = total === null ? NaN : Number(total)
      if (!Number.isSafeInteger(size) || size < 0 || (response.status === 416 && size !== 0)) throw unavailable()
    } finally { controller.abort(); await response.body?.cancel().catch(() => {}) }
  }
  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (url.pathname === "/api/ui/project-artifacts/resolve") {
        if (request.method !== "POST") return json(405, { error: { code: "method" } })
        const text = await request.text()
        if (Buffer.byteLength(text) > 8192) return json(413, { error: { code: "body" } })
        let input: { sessionID?: unknown; messageID?: unknown; href?: unknown }
        try { input = JSON.parse(text) } catch { return json(400, { error: { code: "input" } }) }
        if (!input || typeof input.sessionID !== "string" || typeof input.messageID !== "string" || typeof input.href !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(input.sessionID) || !/^[A-Za-z0-9_-]{1,160}$/.test(input.messageID)) return json(400, { error: { code: "input" } })
        const record = await verify(input.sessionID, input.messageID, input.href, request.signal)
        const info = await metadata(record, request)
        const canonicalId = createHash("sha256").update(`${record.directory}\0${record.path}`).digest("hex")
        const key = `${record.sessionID}\0${record.messageID}\0${record.href}\0${canonicalId}`
        const id = ids.get(key) ?? randomBytes(24).toString("base64url")
        ids.set(key, id); records.set(id, record)
        return json(200, { data: { id, url: `/api/ui/project-artifacts/${id}`, name: posix.basename(record.path), ...info, toolName: "assistant-link", canonicalId } satisfies ArtifactSummary })
      }
      const match = /^\/api\/ui\/project-artifacts\/([A-Za-z0-9_-]{32})$/.exec(url.pathname)
      if (!match) throw unavailable()
      if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: { code: "method" } })
      const record = records.get(match[1]!)
      if (!record) throw unavailable()
      // Recheck authoritative provenance and location on every read. Bytes are current, not a snapshot.
      const verified = await verify(record.sessionID, record.messageID, record.href, request.signal)
      if (verified.directory !== record.directory || verified.path !== record.path) throw unavailable()
      const { response, controller } = await open(record, request, request.method === "GET" ? request.headers.get("range") ?? undefined : undefined)
      const headers = new Headers({ ...safeHeaders, "content-type": info.mime, "content-disposition": disposition(posix.basename(record.path), info.kind === "image" && url.searchParams.get("download") !== "1") })
      for (const name of ["content-length", "content-range", "accept-ranges"]) {
        const value = response.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      if (request.method === "HEAD" || response.status === 416 || !response.body) {
        controller.abort(); await response.body?.cancel().catch(() => {})
        return new Response(null, { status: response.status, headers })
      }
      const reader = response.body.getReader()
      const stream = new ReadableStream<Uint8Array>({
        async pull(output) {
          try { const next = await reader.read(); if (next.done) output.close(); else output.enqueue(next.value) }
          catch (error) { controller.abort(); output.error(error) }
        },
        async cancel(reason) { controller.abort(); await reader.cancel(reason).catch(() => {}) },
      })
      return new Response(stream, { status: response.status, headers })
    } catch (error) {
      const failure = error instanceof Failure ? error : unavailable()
      return json(failure.status, { error: { code: failure.code, message: failure.message } })
    }
  }
  return { handleRequest }
}
