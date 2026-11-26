type FocusHandoff = () => void

let pending: FocusHandoff | null = null

/**
 * One-shot focus handoff from the composer to the mobile Inspector sheet.
 * The sheet owns its close lifecycle, so focus is applied from its
 * `onOpenChangeComplete` instead of polling the DOM for the closing popup.
 */
export function setComposerFocusHandoff(handoff: FocusHandoff | null): void {
  pending = handoff
}

/** Consume the pending handoff; a close without a requested handoff is a no-op. */
export function takeComposerFocusHandoff(): FocusHandoff | null {
  const handoff = pending
  pending = null
  return handoff
}
