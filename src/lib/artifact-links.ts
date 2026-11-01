import { sanitizeToolArtifactName, type ToolArtifact, type ToolArtifactKind } from "@/lib/tool-artifacts"

export const MAX_LINK_ARTIFACTS_PER_TEXT = 8
const RESOLVE_SUCCESS_TTL_MS = 5 * 60 * 1000
const RESOLVE_FAILURE_TTL_MS = 30 * 1000
const ARTIFACT_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|pdf|txt|md|markdown|json|jsonc|csv|tsv|log|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|css|scss|sass|less|py|rb|rs|go|java|c|cc|cpp|h|hpp|sh|zsh|bash|sql|xml|zip)$/i

type ResolveResponse = {
  id: string
  url: string
  name: string
  mime: string
  size: number
  kind: ToolArtifactKind
  toolName: string
  canonicalId: string
  width?: number
  height?: number
}

type CacheEntry = {
  at: number
  promise: Promise<ToolArtifact | null>
  success: boolean
}

const cache = new Map<string, CacheEntry>()

export function isPotentialArtifactHref(value: string): boolean {
  const href = value.trim()
  if (!href || href.length > 4096 || href.includes("\0")) return false
  if (/^(?:data|javascript|mailto|tel):/i.test(href)) return false
  if (href.startsWith("//") || href.startsWith("\\")) return false
  if (!/^(?:https?:\/\/|file:\/\/\/|\/)/i.test(href)) return false
  let path = href
  try {
    if (/^https?:\/\//i.test(href)) path = new URL(href).pathname
    else if (/^file:\/\//i.test(href)) path = decodeURIComponent(new URL(href).pathname)
  } catch {
    return false
  }
  return ARTIFACT_EXTENSION.test(path) || /(?:^|\/)tmp\/opencode\/shots\//.test(path)
}

export function stripMarkdownCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "")
}

export function artifactLinkCandidates(markdown: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
    /<((?:https?|file):\/\/[^>\s]+)>/g,
  ]
  const source = stripMarkdownCode(markdown)
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const href = (match[1] ?? "").replace(/&amp;/g, "&").trim()
      if (isPotentialArtifactHref(href)) found.add(href)
      if (found.size >= MAX_LINK_ARTIFACTS_PER_TEXT) return [...found]
    }
  }
  return [...found]
}

function resolveUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl || "http://localhost").href
}

function mapResolvedArtifact(data: ResolveResponse, href: string, baseUrl: string): ToolArtifact {
  const kind: ToolArtifactKind =
    data.kind === "image" || data.kind === "pdf" || data.kind === "text" || data.kind === "binary"
      ? data.kind
      : "binary"
  const sourceUrl = resolveUrl(data.url, baseUrl)
  const downloadUrl = resolveUrl(`${data.url}${data.url.includes("?") ? "&" : "?"}download=1`, baseUrl)
  return {
    key: `link:${data.canonicalId}`,
    dedupeKey: `link:${data.canonicalId}`,
    canonicalId: data.canonicalId,
    ...(data.width && data.height ? { width: data.width, height: data.height } : {}),
    toolID: "assistant-link",
    toolName: data.toolName,
    name: sanitizeToolArtifactName(data.name, data.mime),
    mime: data.mime,
    kind,
    uri: href,
    dataUrl: null,
    remoteUrl: null,
    sourceUrl,
    downloadUrl,
    size: Number.isFinite(data.size) && data.size > 0 ? data.size : null,
    reason: null,
    downloadable: true,
  }
}

export async function resolveArtifactLink({
  sessionID,
  href,
  baseUrl,
}: {
  sessionID: string
  href: string
  baseUrl?: string
}): Promise<ToolArtifact | null> {
  if (!isPotentialArtifactHref(href)) return null
  const resolvedBase = baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "")
  const key = `${sessionID}|${href}`
  const cached = cache.get(key)
  const now = Date.now()
  if (cached && now - cached.at < (cached.success ? RESOLVE_SUCCESS_TTL_MS : RESOLVE_FAILURE_TTL_MS)) {
    return cached.promise
  }

  const promise = (async () => {
    try {
      const response = await fetch(resolveUrl("/api/ui/artifacts/resolve", resolvedBase), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sessionID, href }),
      })
      if (!response.ok) return null
      const body = await response.json() as { data?: ResolveResponse }
      if (!body.data || typeof body.data.url !== "string" || typeof body.data.canonicalId !== "string") {
        return null
      }
      return mapResolvedArtifact(body.data, href, resolvedBase)
    } catch {
      return null
    }
  })()

  const entry: CacheEntry = { at: now, promise, success: false }
  cache.set(key, entry)
  const result = await promise
  if (result) {
    entry.success = true
    entry.at = Date.now()
  } else {
    entry.success = false
    entry.at = Date.now()
  }
  return result
}

export function resetArtifactLinkCache(): void {
  cache.clear()
}
