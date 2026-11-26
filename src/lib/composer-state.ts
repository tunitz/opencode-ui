import { fileReference } from "@/lib/file-references"

export type ComposerSendGate = {
  hasSession: boolean
  connected: boolean
  modelReady: boolean
  admissionPending: boolean
  hasText: boolean
  hasFiles?: boolean
}

/**
 * Send/steer is enabled for a real session on a connected engine with the
 * allowed model and text or files, and no admission already in flight. The
 * SSE stream does not gate admission: prompts are reconciled on reconnect.
 */
export function canSendPrompt({
  hasSession,
  connected,
  modelReady,
  admissionPending,
  hasText,
  hasFiles = false,
}: ComposerSendGate): boolean {
  return (
    hasSession &&
    connected &&
    modelReady &&
    !admissionPending &&
    (hasText || hasFiles)
  )
}

/** Synchronous guard against duplicate submissions, scoped to each session. */
export function createSessionSubmissionLock() {
  const pending = new Set<string>()
  return {
    acquire(sessionID: string) {
      if (pending.has(sessionID)) return false
      pending.add(sessionID)
      return true
    },
    release(sessionID: string) {
      pending.delete(sessionID)
    },
  }
}

/**
 * Plain-text editing helpers for the composer textarea. All operations slice
 * the original string directly, so CRLF, indentation and `@"path"` reference
 * bytes survive untouched — the same guarantees the old rich-text editor had.
 */

function clampOffset(value: string, offset: number): number {
  if (!Number.isFinite(offset)) return value.length
  return Math.max(0, Math.min(Math.trunc(offset), value.length))
}

export type TextInsertion = { value: string; caret: number }

/** Insert raw text at a selection without normalising any characters. */
export function insertTextAtSelection(
  value: string,
  text: string,
  start: number,
  end: number
): TextInsertion {
  const from = clampOffset(value, start)
  const to = Math.max(from, clampOffset(value, end))
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + text.length,
  }
}

/**
 * Insert a file reference as a plain `@"path"` token at a selection, adding
 * separating whitespace only when the surrounding characters need it.
 */
export function insertReferenceToken(
  value: string,
  path: string,
  start: number,
  end: number
): TextInsertion {
  const from = clampOffset(value, start)
  const to = Math.max(from, clampOffset(value, end))
  const reference = fileReference(path)
  const prefix = from > 0 && !/\s/.test(value[from - 1]) ? " " : ""
  const suffix = to < value.length && /\s/.test(value[to]) ? "" : " "
  const inserted = prefix + reference + suffix
  return {
    value: value.slice(0, from) + inserted + value.slice(to),
    caret: from + inserted.length,
  }
}

/**
 * Merge a returned queued prompt into the current draft without losing either
 * string. An empty/whitespace-only draft is replaced exactly; otherwise the
 * restored text is appended with the smallest separator that keeps the lines
 * distinct. No trimming or rewriting of either original string.
 */
export function mergeRestoredDraft(existing: string, restored: string): string {
  if (!existing.trim()) return restored
  if (!restored.trim()) return existing
  const separator =
    existing.endsWith("\n") || restored.startsWith("\n") ? "" : "\n\n"
  return `${existing}${separator}${restored}`
}

/** Composition belongs to the mounted editor, never the next session. */
export function createSessionCompositionState() {
  let active: string | null = null
  let composing = false
  return {
    switchTo(sessionID: string) { active = sessionID; composing = false },
    start(sessionID: string) { if (active === sessionID) composing = true },
    end(sessionID: string) { if (active === sessionID) composing = false },
    isComposing(sessionID: string) { return active === sessionID && composing },
  }
}
