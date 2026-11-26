import type { SessionGroup } from "@/lib/session-activity"

type SessionTreeRef = {
  id: string
  parentID?: string
}

type SessionTreeTimed = SessionTreeRef & { time: { updated: number } }

export type SessionTreeRow<T extends SessionTreeRef> = {
  session: T
  /** Nesting level below the top-level session. */
  depth: number
  /** Loaded child sessions, in the order they were given. */
  children: SessionTreeRow<T>[]
}

/**
 * Nest loaded sessions under their authoritative `parentID`.
 *
 * A session whose parent is absent from the loaded list (pagination or a
 * project scope) is kept as a top-level row, so scoping never hides a session.
 * Self-references and parent cycles are anchored at the top level, which
 * keeps every input session in the result exactly once. Sibling order follows
 * the input order.
 */
export function sessionTreeRows<T extends SessionTreeRef>(
  sessions: readonly T[]
): SessionTreeRow<T>[] {
  const known = new Set(sessions.map((session) => session.id))
  const childrenByParent = new Map<string, T[]>()

  for (const session of sessions) {
    const parentID = session.parentID

    if (!parentID || parentID === session.id || !known.has(parentID)) {
      continue
    }

    const siblings = childrenByParent.get(parentID)

    if (siblings) {
      siblings.push(session)
    } else {
      childrenByParent.set(parentID, [session])
    }
  }

  const emitted = new Set<string>()

  function build(session: T, depth: number): SessionTreeRow<T> {
    emitted.add(session.id)
    const children: SessionTreeRow<T>[] = []

    for (const child of childrenByParent.get(session.id) ?? []) {
      // A cycle must not duplicate a session or recurse forever.
      if (emitted.has(child.id)) continue
      children.push(build(child, depth + 1))
    }

    return { session, depth, children }
  }

  const rows: SessionTreeRow<T>[] = []

  // Build actual roots first: recently updated children can precede their
  // parents in the input and must not be prematurely promoted to roots.
  for (const session of sessions) {
    if (!session.parentID || session.parentID === session.id || !known.has(session.parentID)) {
      if (!emitted.has(session.id)) rows.push(build(session, 0))
    }
  }

  // Remaining sessions belong to cycles; anchor each disconnected cycle once.
  for (const session of sessions) {
    if (emitted.has(session.id)) continue
    rows.push(build(session, 0))
  }

  return rows
}

/**
 * Loaded parent IDs above a session, nearest first. Cycles and parents that are
 * not loaded stop the walk. Empty for a top-level or unknown session.
 */
export function sessionAncestorIDs(
  sessions: readonly SessionTreeRef[],
  sessionID: string | null
): string[] {
  if (!sessionID) return []

  const parentByID = new Map<string, string | undefined>()
  for (const session of sessions) {
    parentByID.set(session.id, session.parentID)
  }

  const ancestors: string[] = []
  const seen = new Set([sessionID])
  let current = parentByID.get(sessionID)

  while (current && parentByID.has(current) && !seen.has(current)) {
    seen.add(current)
    ancestors.push(current)
    current = parentByID.get(current)
  }

  return ancestors
}

/** Total child sessions below a row, including grandchildren. */
export function countSessionTreeDescendants<T extends SessionTreeRef>(
  row: SessionTreeRow<T>
): number {
  let count = 0

  for (const child of row.children) {
    count += 1 + countSessionTreeDescendants(child)
  }

  return count
}

/**
 * All top-level rows share the single Recent bucket. Child rows stay inside
 * their parent's subtree so a tree is never split across sections.
 */
export function groupSessionTreeRows<T extends SessionTreeTimed>(
  rows: readonly SessionTreeRow<T>[]
): Record<SessionGroup, SessionTreeRow<T>[]> {
  return { Recent: [...rows] }
}
