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

/** Latest real user message, matching the TUI's /undo boundary selection. */
export function findUndoBoundary(
  messages: readonly SessionMessageInfo[]
): SessionMessageUser | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === "user" && message.text.trim()) {
      return message
    }
  }
  return null
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

export function sessionExportFilename(session: SessionInfo): string {
  const id = session.id.replace(/[^A-Za-z0-9_-]/g, "_")
  return `session-${id || "transcript"}.json`
}

export function timelineTime(created: number): string {
  return new Date(created).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
