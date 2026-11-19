import type {
  SessionInfo,
  SessionMessageInfo,
  SessionMessageUser,
} from "@/lib/opencode"

export type RevertPreview = {
  messageID: string
  userMessages: number
  messages: number
  files: string[]
}

export function isAbsoluteDirectory(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.includes("\0") &&
    !/[\r\n]/.test(trimmed)
  )
}

/**
 * Durable history visible before a staged revert. Upstream 2.1.4 calls this
 * `messagesBeforeRevert`; a staged boundary hides the boundary message itself
 * and everything after it from /undo, /copy, and the session view.
 */
export function messagesBeforeRevert(
  messages: readonly SessionMessageInfo[],
  revertMessageID?: string | null
): readonly SessionMessageInfo[] {
  if (!revertMessageID) return messages
  const index = messages.findIndex((message) => message.id === revertMessageID)
  return index === -1 ? messages : messages.slice(0, index)
}

/** Latest real user message, matching the TUI's /undo boundary selection. */
export function findUndoBoundary(
  messages: readonly SessionMessageInfo[],
  revertMessageID?: string | null
): SessionMessageUser | null {
  const visible = messagesBeforeRevert(messages, revertMessageID)
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message.type === "user" && message.text.trim()) {
      return message
    }
  }
  return null
}

/**
 * Text for the native /copy command: the latest assistant text OR the latest
 * completed compaction summary, never a message at/after a staged revert.
 * Mirrors upstream 2.1.4 `messages.copy`.
 */
export function copyableAssistantText(
  messages: readonly SessionMessageInfo[],
  revertMessageID?: string | null
): string | null {
  const visible = messagesBeforeRevert(messages, revertMessageID)
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message.type === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim()
      if (text) return text
    }
    if (
      message.type === "compaction" &&
      message.status === "completed" &&
      message.summary.trim()
    ) {
      return message.summary.trim()
    }
  }
  return null
}

/** Node `path.posix.resolve`-style normalization, without importing Node into the browser. */
function normalizePosixPath(value: string): string {
  const absolute = value.startsWith("/")
  const parts: string[] = []
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop()
      else if (!absolute) parts.push("..")
      continue
    }
    parts.push(segment)
  }
  const joined = parts.join("/")
  if (absolute) return `/${joined}`
  return joined || "."
}

/**
 * Resolve a /cd argument against the session directory (relative paths) or the
 * home directory (`~`, `~/…`). When home is unknown the `~` form is preserved
 * so the engine's location lookup can expand it. No role/safety gating here:
 * the native location lookup and move are the authority on what is reachable.
 */
export function resolveSessionDirectory(
  input: string,
  baseDirectory: string,
  homeDirectory?: string | null
): string | null {
  const value = input.trim()
  if (!value || value.includes("\0") || /[\r\n]/.test(value)) return null
  const home = homeDirectory?.trim() || ""
  let candidate: string
  if (value === "~") {
    candidate = home || "~"
  } else if (value.startsWith("~/")) {
    candidate = home ? `${home}/${value.slice(2)}` : value
  } else if (value.startsWith("/")) {
    candidate = value
  } else {
    candidate = `${baseDirectory.trim() || "/"}/${value}`
  }
  return normalizePosixPath(candidate)
}

/**
 * Predict the TUI/native revert effect from the currently loaded durable
 * history. Native stage uses each later assistant snapshot's changed files.
 */
export function previewRevert(
  messages: readonly SessionMessageInfo[],
  messageID: string
): RevertPreview | null {
  const boundary = messages.findIndex((message) => message.id === messageID)
  if (boundary === -1) return null

  const later = messages.slice(boundary)
  const files = new Set<string>()
  for (const message of later) {
    if (message.type !== "assistant") continue
    for (const file of message.snapshot?.files ?? []) files.add(file)
  }

  return {
    messageID,
    userMessages: later.filter((message) => message.type === "user").length,
    messages: later.length,
    files: [...files].sort((left, right) => left.localeCompare(right)),
  }
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function sessionExportFilename(
  session: SessionInfo,
  format: "json" | "markdown" = "json"
): string {
  const id = session.id.replace(/[^A-Za-z0-9_-]/g, "_")
  return `session-${id || "transcript"}.${format === "markdown" ? "md" : "json"}`
}

export function timelineTime(created: number): string {
  return new Date(created).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
