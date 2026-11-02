export type ComposerSendGate = {
  hasSession: boolean
  connected: boolean
  streamReady: boolean
  modelReady: boolean
  admissionPending: boolean
  hasText: boolean
  hasFiles?: boolean
}

/**
 * Send/steer is enabled only for a real session on a connected, ready stream
 * with the allowed model and text or files, and no admission already in flight.
 */
export function canSendPrompt({
  hasSession,
  connected,
  streamReady,
  modelReady,
  admissionPending,
  hasText,
  hasFiles = false,
}: ComposerSendGate): boolean {
  return (
    hasSession &&
    connected &&
    streamReady &&
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
