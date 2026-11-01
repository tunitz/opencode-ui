type SessionRef = {
  id: string
  parentID?: string
}

/** Trimmed session title, or null when the name is blank. */
export function normalizeSessionTitle(raw: string): string | null {
  const title = raw.trim()
  return title.length > 0 ? title : null
}

export function applySessionTitle<T extends { id: string; title?: string }>(
  sessions: readonly T[],
  sessionID: string,
  title: string
): T[] {
  return sessions.map((session) =>
    session.id === sessionID ? { ...session, title } : session
  )
}

/**
 * The deleted session plus every loaded descendant. The live API deletes child
 * sessions with their parent, so the local list must drop them too.
 */
export function descendantSessionIDs(
  sessions: readonly SessionRef[],
  sessionID: string
): Set<string> {
  const removed = new Set([sessionID])
  let grew = true

  while (grew) {
    grew = false

    for (const session of sessions) {
      if (
        session.parentID &&
        removed.has(session.parentID) &&
        !removed.has(session.id)
      ) {
        removed.add(session.id)
        grew = true
      }
    }
  }

  return removed
}

/**
 * Neighbour to select after the active session is deleted, mirroring the list
 * order: the session that took its place, else the one before it. Null means the
 * active session survived (keep the current selection) or no session remains.
 */
export function fallbackSessionAfterRemoval<T extends { id: string }>(
  sessions: readonly T[],
  removed: ReadonlySet<string>,
  activeSessionID: string | null
): T | null {
  if (!activeSessionID || !removed.has(activeSessionID)) {
    return null
  }

  const index = sessions.findIndex((session) => session.id === activeSessionID)
  const remaining = sessions.filter((session) => !removed.has(session.id))

  if (remaining.length === 0) {
    return null
  }

  return remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null
}
