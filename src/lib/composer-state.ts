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
