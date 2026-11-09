import type { SessionMessageInfo } from "@/lib/opencode"

export type CommandGroup =
  | "Actions"
  | "Projects"
  | "Sessions"
  | "Messages"
  | "Files"

export type CommandItem = {
  id: string
  group: CommandGroup
  label: string
  detail: string
  archived?: boolean
}

export const COMMAND_MESSAGE_CAP = 500

const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "Actions",
  "Projects",
  "Sessions",
  "Messages",
  "Files",
]

const SNIPPET_MAX_LENGTH = 120

/**
 * Case-insensitive, all-words matching. Every whitespace-separated word in the
 * query must appear in the item's label or detail. An empty query matches all.
 */
export function matchCommandItem(
  item: Pick<CommandItem, "label" | "detail">,
  query: string
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true

  const haystack = `${item.label} ${item.detail}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/**
 * Bucket items by group in the fixed display order, omitting empty groups and
 * preserving the incoming order within each group.
 */
export function groupCommandItems(
  items: readonly CommandItem[]
): Array<{ group: CommandGroup; items: CommandItem[] }> {
  const groups = new Map<CommandGroup, CommandItem[]>()

  for (const item of items) {
    const bucket = groups.get(item.group)
    if (bucket) {
      bucket.push(item)
    } else {
      groups.set(item.group, [item])
    }
  }

  const result: Array<{ group: CommandGroup; items: CommandItem[] }> = []
  for (const group of COMMAND_GROUP_ORDER) {
    const bucket = groups.get(group)
    if (bucket && bucket.length > 0) result.push({ group, items: bucket })
  }
  return result
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  if (typeof block !== "object" || block === null) return false
  const candidate = block as { type?: unknown; text?: unknown }
  return candidate.type === "text" && typeof candidate.text === "string"
}

type MessageShape = {
  id?: unknown
  type?: unknown
  text?: unknown
  content?: unknown
}

function asMessageShape(message: SessionMessageInfo): MessageShape {
  if (typeof message !== "object" || message === null) return {}
  return message as MessageShape
}

/**
 * Plain, searchable text for a message. User messages expose `text`; assistant
 * messages contribute only their text content blocks. Everything else is "".
 */
export function messageText(message: SessionMessageInfo): string {
  const candidate = asMessageShape(message)

  if (candidate.type === "user") {
    return typeof candidate.text === "string" ? candidate.text : ""
  }

  if (candidate.type !== "assistant") return ""
  if (!Array.isArray(candidate.content)) return ""

  const parts: string[] = []
  for (const block of candidate.content) {
    if (isTextBlock(block) && block.text.length > 0) parts.push(block.text)
  }
  return parts.join("\n")
}

export type MessageSearchHit = {
  messageID: string
  snippet: string
  role: "user" | "assistant"
}

function messageRole(message: SessionMessageInfo): "user" | "assistant" | null {
  const type = asMessageShape(message).type
  return type === "user" || type === "assistant" ? type : null
}

function buildSnippet(text: string, matchIndex: number, matchLength: number): string {
  if (text.length <= SNIPPET_MAX_LENGTH) return text

  // Reserve room for both ellipses so the result never exceeds the limit.
  const contentLength = SNIPPET_MAX_LENGTH - 2
  const center = matchIndex + matchLength / 2
  const unclamped = Math.round(center - contentLength / 2)
  const start = Math.max(0, Math.min(unclamped, text.length - contentLength))
  const end = Math.min(text.length, start + contentLength)

  let snippet = text.slice(start, end)
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`
  return snippet
}

/**
 * Search user/assistant message text for the first case-insensitive occurrence
 * of the trimmed query. At most `cap` messages are inspected.
 */
export function searchMessages(
  messages: readonly SessionMessageInfo[],
  query: string,
  cap?: number
): { hits: MessageSearchHit[]; searched: number; capped: boolean } {
  const hits: MessageSearchHit[] = []
  const trimmed = query.trim()
  const limit = Math.max(0, cap ?? COMMAND_MESSAGE_CAP)

  if (trimmed.length === 0) return { hits, searched: 0, capped: false }

  const needle = trimmed.toLowerCase()
  let searched = 0
  let capped = false

  for (const message of messages) {
    const role = messageRole(message)
    if (role === null) continue

    if (searched >= limit) {
      capped = true
      break
    }
    searched += 1

    const text = messageText(message)
    const matchIndex = text.toLowerCase().indexOf(needle)
    if (matchIndex < 0) continue

    const messageID = asMessageShape(message).id
    if (typeof messageID !== "string") continue

    hits.push({
      messageID,
      role,
      snippet: buildSnippet(text, matchIndex, needle.length),
    })
  }

  return { hits, searched, capped }
}

/** Trimmed session search query, or null when empty or over 100 characters. */
export function sessionSearchQuery(query: string): string | null {
  const trimmed = query.trim()
  if (trimmed.length === 0 || trimmed.length > 100) return null
  return trimmed
}
