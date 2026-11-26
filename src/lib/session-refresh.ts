import type { SessionInfo } from "./opencode"

/**
 * Reconcile a background tab-wake refresh into the pages already loaded by
 * infinite scroll. Matching rows are replaced in place, new sessions are
 * prepended, and existing pages stay untouched so pagination can continue.
 */
export function mergeRefreshedSessions(
  current: SessionInfo[],
  fresh: SessionInfo[]
): SessionInfo[] {
  if (current.length === 0) return fresh
  const freshByID = new Map(fresh.map((session) => [session.id, session]))
  const existingIDs = new Set(current.map((session) => session.id))
  const added = fresh.filter((session) => !existingIDs.has(session.id))
  const updated = current.map((session) => freshByID.get(session.id) ?? session)
  return added.length ? [...added, ...updated] : updated
}
