import type { ToolFileContent } from "@/lib/opencode"
import {
  basename,
  extensionOf,
  formatFileSize,
  isSafeImageMime,
} from "@/lib/files"

export const MAX_TOOL_ARTIFACT_BYTES = 8 * 1024 * 1024
export const MAX_TOOL_ARTIFACT_THUMBNAIL_BYTES = 2 * 1024 * 1024
export const MAX_TOOL_ARTIFACT_TEXT_BYTES = 256 * 1024

export type ToolArtifactKind =
  | "image"
  | "pdf"
  | "text"
  | "binary"
  | "remote"
  | "local"
  | "unsupported"

export type ToolArtifact = {
  key: string
  dedupeKey: string
  toolID: string
  toolName: string | null
  name: string
  mime: string
  kind: ToolArtifactKind
  uri: string
  dataUrl: string | null
  remoteUrl: string | null
  sourceUrl?: string | null
  downloadUrl?: string | null
  canonicalId?: string | null
  width?: number | null
  height?: number | null
  size: number | null
  reason: string | null
  downloadable: boolean
}

type DataUrl = {
  mime: string
  base64: boolean
  payload: string
  size: number
}

const ACTIVE_MIME = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
])

const TEXTUAL_MIME = /^(?:text\/|application\/(?:json|xml|javascript|x-javascript|typescript|x-typescript|yaml|x-yaml)$)/i
const TEXTUAL_EXTENSION = /^(?:c|cc|cfg|conf|cpp|css|csv|go|h|hpp|html|ini|java|js|json|jsonc|jsx|log|md|mdx|mjs|php|properties|py|rb|rs|scss|sh|sql|svelte|svg|tex|toml|ts|tsx|txt|vue|xml|yaml|yml|zsh)$/i

function normalizeMime(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function parseDataUrl(uri: string): DataUrl | null {
  if (!uri.startsWith("data:")) return null
  const comma = uri.indexOf(",")
  if (comma < 0) return null
  const header = uri.slice(5, comma).split(";")
  const mime = normalizeMime(header[0] ?? "") || "application/octet-stream"
  const base64 = header.some((part) => part.toLowerCase() === "base64")
  const payload = uri.slice(comma + 1)
  if (base64) {
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
    return {
      mime,
      base64,
      payload,
      size: Math.max(0, Math.floor((payload.length * 3) / 4) - padding),
    }
  }
  return { mime, base64, payload, size: payload.length }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function extensionForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf"
  if (mime === "image/png") return "png"
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/gif") return "gif"
  if (mime === "image/webp") return "webp"
  if (mime === "image/avif") return "avif"
  if (TEXTUAL_MIME.test(mime)) return "txt"
  return "bin"
}

export function sanitizeToolArtifactName(
  value: string | null | undefined,
  mime: string,
  index = 0
): string {
  const stripped = Array.from(String(value ?? ""))
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join("")
  const raw = basename(stripped.trim())
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const fallback = `artifact-${index + 1}.${extensionForMime(mime)}`
  if (!raw || raw === "." || raw === "..") return fallback
  const withExtension = extensionOf(raw)
    ? raw
    : `${raw}.${extensionForMime(mime)}`
  return withExtension.slice(0, 120) || fallback
}

function safeRemoteUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function artifactBase(
  file: ToolFileContent,
  toolID: string,
  toolName: string | null,
  index: number
): Pick<
  ToolArtifact,
  "key" | "dedupeKey" | "toolID" | "toolName" | "name" | "uri"
> {
  const uri = String(file.uri ?? "").trim()
  const mime = normalizeMime(file.mime) || "application/octet-stream"
  const name = sanitizeToolArtifactName(file.name, mime, index)
  return {
    key: `${toolID}:${index}`,
    dedupeKey: `${mime}|${fnv1a(uri)}`,
    toolID,
    toolName,
    uri,
    name,
  }
}

function unsupportedArtifact(
  base: ReturnType<typeof artifactBase>,
  mime: string,
  reason: string,
  size: number | null = null
): ToolArtifact {
  return {
    ...base,
    mime,
    kind: "unsupported",
    dataUrl: null,
    remoteUrl: null,
    size,
    reason,
    downloadable: false,
  }
}

export function artifactFromToolFile(
  file: ToolFileContent,
  toolID: string,
  toolName: string | null,
  index: number
): ToolArtifact {
  const base = artifactBase(file, toolID, toolName, index)
  const declaredMime = normalizeMime(file.mime) || "application/octet-stream"

  if (!base.uri) {
    return unsupportedArtifact(base, declaredMime, "Artifact has no URI.")
  }

  if (base.uri.startsWith("data:")) {
    const data = parseDataUrl(base.uri)
    if (!data) {
      return unsupportedArtifact(base, declaredMime, "Malformed data artifact.")
    }
    if (data.mime !== declaredMime) {
      return unsupportedArtifact(
        base,
        declaredMime,
        "Artifact MIME does not match its data URL."
      )
    }
    if (data.size > MAX_TOOL_ARTIFACT_BYTES) {
      return unsupportedArtifact(
        base,
        declaredMime,
        `Artifact is larger than ${formatFileSize(MAX_TOOL_ARTIFACT_BYTES)}; it was not decoded.`,
        data.size
      )
    }
    if (ACTIVE_MIME.has(declaredMime)) {
      return unsupportedArtifact(
        base,
        declaredMime,
        "Active HTML/SVG artifacts are not previewed or downloaded in this client.",
        data.size
      )
    }
    if (declaredMime.startsWith("image/")) {
      if (!isSafeImageMime(declaredMime)) {
        return unsupportedArtifact(
          base,
          declaredMime,
          "This image type is not safe to render inline.",
          data.size
        )
      }
      return {
        ...base,
        mime: declaredMime,
        kind: "image",
        dataUrl: base.uri,
        remoteUrl: null,
        size: data.size,
        reason: null,
        downloadable: true,
      }
    }
    if (declaredMime === "application/pdf") {
      return {
        ...base,
        mime: declaredMime,
        kind: "pdf",
        dataUrl: base.uri,
        remoteUrl: null,
        size: data.size,
        reason: null,
        downloadable: true,
      }
    }
    const textual =
      TEXTUAL_MIME.test(declaredMime) ||
      TEXTUAL_EXTENSION.test(extensionOf(base.name))
    return {
      ...base,
      mime: declaredMime,
      kind: textual ? "text" : "binary",
      dataUrl: base.uri,
      remoteUrl: null,
      size: data.size,
      reason: null,
      downloadable: true,
    }
  }

  if (/^https:\/\//i.test(base.uri)) {
    const remoteUrl = safeRemoteUrl(base.uri)
    if (!remoteUrl) {
      return unsupportedArtifact(
        base,
        declaredMime,
        "Remote artifact URL is not a safe HTTPS URL."
      )
    }
    return {
      ...base,
      mime: declaredMime,
      kind: "remote",
      dataUrl: null,
      remoteUrl,
      size: null,
      reason: "Remote artifact. Open it explicitly; the client does not prefetch it.",
      downloadable: false,
    }
  }

  if (/^file:\/\//i.test(base.uri) || /^[A-Za-z]:[\\/]/.test(base.uri)) {
    return {
      ...base,
      mime: declaredMime,
      kind: "local",
      dataUrl: null,
      remoteUrl: null,
      size: null,
      reason:
        "Local path artifact is not accessible from the browser client; download it through an authorized file tool.",
      downloadable: false,
    }
  }

  return unsupportedArtifact(
    base,
    declaredMime,
    "Unsupported artifact URI; only inline data or safe HTTPS links are displayable."
  )
}

export function toolFilesFromContent(
  content: readonly unknown[] | undefined | null
): ToolFileContent[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (part): part is ToolFileContent =>
      Boolean(part) &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "file" &&
      typeof (part as { uri?: unknown }).uri === "string" &&
      typeof (part as { mime?: unknown }).mime === "string"
  )
}

export function toolArtifactsFromContent({
  content,
  toolID,
  toolName,
}: {
  content: readonly unknown[] | undefined | null
  toolID: string
  toolName: string | null
}): ToolArtifact[] {
  const seen = new Set<string>()
  const artifacts: ToolArtifact[] = []
  const files = toolFilesFromContent(content)
  for (const [index, file] of files.entries()) {
    const artifact = artifactFromToolFile(file, toolID, toolName, index)
    if (seen.has(artifact.dedupeKey)) continue
    seen.add(artifact.dedupeKey)
    artifacts.push(artifact)
  }
  return artifacts
}

export function artifactSignature(artifact: Pick<ToolArtifact, "name" | "mime" | "size">): string {
  return `${artifact.name}|${artifact.mime}|${artifact.size ?? ""}`
}

export function artifactSubtitle(artifact: ToolArtifact): string {
  return [
    artifact.mime,
    artifact.size === null ? null : formatFileSize(artifact.size),
  ]
    .filter(Boolean)
    .join(" · ")
}
