import type { FileDiffInfo, ModelInfo } from "@/lib/opencode"

export const MAX_FILE_PREVIEW_BYTES = 256 * 1024
export const MAX_DIFF_PATCH_CHARS = 200_000

export type ProjectEntry = {
  path: string
  type: "file" | "directory"
}

export type AttachmentKind = "text" | "image" | "pdf" | "binary"

const TEXT_EXTENSIONS = new Set([
  "c", "cc", "cfg", "conf", "cpp", "cs", "css", "csv", "go", "h", "hpp", "html",
  "cjs", "dart", "graphql", "ini", "java", "js", "json", "jsonc", "jsx", "kt", "log", "lua", "md", "mdx", "mjs", "php",
  "properties", "proto", "py", "rb", "rs", "scss", "sh", "sql", "svelte", "svg", "swift",
  "tex", "tf", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml", "zsh",
])

const IMAGE_EXTENSIONS: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
}

export function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path
}

export function extensionOf(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

export function inferMime(path: string): string {
  const extension = extensionOf(path)
  if (MIME_BY_EXTENSION[extension]) return MIME_BY_EXTENSION[extension]
  if (["dockerfile", "makefile", "gemfile"].includes(basename(path).toLowerCase())) return "text/plain"
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain"
  return "application/octet-stream"
}

export function isSafeImageMime(mime: string): boolean {
  return Object.values(IMAGE_EXTENSIONS).includes(mime.toLowerCase())
}

export function attachmentKind(mime: string): AttachmentKind {
  const normalized = mime.toLowerCase()
  if (normalized === "application/pdf") return "pdf"
  if (isSafeImageMime(normalized)) return "image"
  if (normalized.startsWith("text/")) return "text"
  return "binary"
}

export function modelSupportsAttachment(
  model: ModelInfo | null | undefined,
  mime: string
): boolean {
  const kind = attachmentKind(mime)
  const inputs = model?.capabilities?.input ?? ["text"]

  if (kind === "image") return inputs.includes("image")
  if (kind === "pdf") return inputs.includes("pdf")
  if (kind === "text") return inputs.includes("text")
  return false
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "size unknown"
  }
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeSegments(path: string): string[] | null {
  if (path.includes("\0")) return null
  const segments = path.replace(/\\/g, "/").split("/")
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      return null
    }
    normalized.push(segment)
  }
  return normalized
}

/** A relative, slash-separated project path, or null for traversal/absolute input. */
export function normalizeRelativePath(path: string): string | null {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return null
  const segments = normalizeSegments(path)
  return segments && segments.length > 0 ? segments.join("/") : null
}

export function parentPath(path: string): string {
  const segments = normalizeSegments(path) ?? []
  segments.pop()
  return segments.join("/")
}

export function pathSegments(path: string): string[] {
  return normalizeSegments(path) ?? []
}

/** POSIX absolute project path. The target host is Linux; traversal stays rejected. */
export function joinProjectPath(directory: string, relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized || !directory.startsWith("/") || directory.includes("\0")) return null
  return `${directory.replace(/\/+$/, "")}/${normalized}`
}

/**
 * http(s) URLs are deliberately not accepted: the native prompt only accepts a
 * data: or file: URI, and we never fetch user-supplied remote URLs.
 */
export function fileUri(directory: string, relativePath: string): string | null {
  const absolute = joinProjectPath(directory, relativePath)
  if (!absolute) return null
  return `file://${absolute
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`
}

export function encodeFsPath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

export function fsListUrl(directory: string, path = ""): string {
  const search = new URLSearchParams({ "location[directory]": directory })
  if (path) search.set("path", path)
  return `/api/fs/list?${search.toString()}`
}

export function fsFindUrl(directory: string, query: string, limit = 50): string {
  const search = new URLSearchParams({
    "location[directory]": directory,
    query,
    type: "file",
    limit: String(limit),
  })
  return `/api/fs/find?${search.toString()}`
}

export function fsReadUrl(directory: string, path: string): string {
  const search = new URLSearchParams({ "location[directory]": directory })
  return `/api/fs/read/${encodeFsPath(path)}?${search.toString()}`
}

export function sessionDiffUrl(
  sessionID: string,
  from?: string | null,
  context = 3
): string {
  const search = new URLSearchParams({ context: String(context) })
  if (from) search.set("from", from)
  return `/api/session/${encodeURIComponent(sessionID)}/diff?${search.toString()}`
}

export function vcsDiffUrl(directory: string, context = 3): string {
  const search = new URLSearchParams({
    "location[directory]": directory,
    mode: "working",
    context: String(context),
  })
  return `/api/vcs/diff?${search.toString()}`
}

export function parseContentRange(value: string | null): {
  start?: number
  end?: number
  total?: number
} {
  if (!value) return {}
  const satisfied = value.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i)
  if (satisfied) {
    return {
      start: Number(satisfied[1]),
      end: Number(satisfied[2]),
      total: satisfied[3] === "*" ? undefined : Number(satisfied[3]),
    }
  }
  // The native fs reader emits `bytes */<size>` for unsatisfiable ranges,
  // including a zero-byte file requested with `bytes=0-...`.
  const unsatisfied = value.match(/^bytes\s+\*\/(\d+|\*)$/i)
  if (unsatisfied) {
    return {
      total: unsatisfied[1] === "*" ? undefined : Number(unsatisfied[1]),
    }
  }
  return {}
}

export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 4096))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  let control = 0
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1
  }
  return control / sample.length > 0.1
}

export type DecodedPreview = {
  text: string
  binary: boolean
  truncated: boolean
}

export function decodeFilePreview(
  bytes: Uint8Array,
  totalBytes: number | null,
  maxBytes = MAX_FILE_PREVIEW_BYTES
): DecodedPreview {
  const slice = bytes.subarray(0, maxBytes)
  const binary = looksBinary(slice)
  if (binary) {
    return { text: "", binary: true, truncated: bytes.byteLength > maxBytes }
  }
  const text = new TextDecoder().decode(slice)
  return {
    text,
    binary: false,
    truncated:
      bytes.byteLength > maxBytes ||
      (totalBytes !== null && totalBytes > bytes.byteLength),
  }
}

export type RenderedPatch = {
  lines: Array<{
    key: number
    text: string
    kind: "addition" | "deletion" | "hunk" | "context" | "meta"
  }>
  truncated: boolean
}

export function renderPatch(
  patch: string,
  maxChars = MAX_DIFF_PATCH_CHARS
): RenderedPatch {
  const clipped = patch.length > maxChars ? patch.slice(0, maxChars) : patch
  const lines = clipped.split("\n").map((text, key) => ({
    key,
    text,
    kind:
      text.startsWith("+++") || text.startsWith("---") || text.startsWith("diff ")
        ? ("meta" as const)
        : text.startsWith("@@")
          ? ("hunk" as const)
          : text.startsWith("+")
            ? ("addition" as const)
            : text.startsWith("-")
              ? ("deletion" as const)
              : ("context" as const),
  }))
  return { lines, truncated: patch.length > maxChars }
}

export function diffTotals(files: FileDiffInfo[]): {
  additions: number
  deletions: number
} {
  return files.reduce(
    (total, file) => ({
      additions: total.additions + (file.additions ?? 0),
      deletions: total.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 }
  )
}

/** User-initiated metadata probe for a project file. No body content is read. */
export async function probeProjectFileSize(
  directory: string,
  relativePath: string
): Promise<number | null> {
  const response = await fetch(fsReadUrl(directory, relativePath), {
    headers: { Range: "bytes=0-0" },
  })

  if (response.status === 404) {
    await response.body?.cancel()
    throw new Error("File not found.")
  }

  if (response.status === 416) {
    const range = parseContentRange(response.headers.get("content-range"))
    await response.body?.cancel()
    return range.total ?? 0
  }

  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`File request failed (${response.status}).`)
  }

  const range = parseContentRange(response.headers.get("content-range"))
  const length = Number(response.headers.get("content-length"))
  await response.body?.cancel()
  if (range.total !== undefined) return range.total
  if (Number.isFinite(length) && length >= 0) return length
  return null
}
