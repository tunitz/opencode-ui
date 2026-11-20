import type { SessionInfo } from "@/lib/opencode"

export const SESSION_GROUPS = ["Today", "Previous"] as const

export type SessionGroup = (typeof SESSION_GROUPS)[number]

export const SESSION_ACTIVITY_SCHEMA_VERSION = 1
const SESSION_ACTIVITY_STORAGE_PREFIX = "opencode-ui:session-activity:v1"
const MAX_SESSION_ID_LENGTH = 256
/**
 * Caps persisted bookkeeping so a long-lived browser profile cannot grow a
 * private, ever-expanding activity index. Recent and unread sessions win.
 */
export const MAX_SESSION_ACTIVITY_ENTRIES = 200

type StorageLike = Pick<Storage, "getItem" | "setItem">

type ActivitySession = Pick<SessionInfo, "id" | "time">

/** The date bucket a session belongs to, using local midnight boundaries. */
export function sessionGroupForUpdated(
  updated: number,
  now: number
): SessionGroup {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (updated >= today.getTime()) return "Today"
  return "Previous"
}

/**
 * Group sessions newest-first into the sidebar buckets. Sessions with equal
 * update times keep their list order.
 */
export function groupSessionsByUpdated<T extends ActivitySession>(
  sessions: readonly T[],
  now: number
): Record<SessionGroup, T[]> {
  const groups: Record<SessionGroup, T[]> = {
    Today: [],
    Previous: [],
  }

  for (const session of [...sessions].sort(
    (a, b) => b.time.updated - a.time.updated
  )) {
    groups[sessionGroupForUpdated(session.time.updated, now)].push(session)
  }

  return groups
}

/** Group containing a session, or null when it is not in the loaded list. */
export function sessionGroupForID(
  sessions: readonly ActivitySession[],
  sessionID: string | null,
  now: number
): SessionGroup | null {
  if (!sessionID) return null

  const session = sessions.find((candidate) => candidate.id === sessionID)
  return session ? sessionGroupForUpdated(session.time.updated, now) : null
}

export type SessionActivityState = {
  /** Last authoritative `time.updated` observed for each session. */
  seenUpdated: Record<string, number>
  /** Sessions with activity the user has not selected since it happened. */
  unread: Record<string, true>
}

export const EMPTY_SESSION_ACTIVITY: SessionActivityState = {
  seenUpdated: {},
  unread: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeSessionID(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_SESSION_ID_LENGTH) {
    return null
  }
  // These keys would mutate the prototype of the record we build.
  if (
    trimmed === "__proto__" ||
    trimmed === "constructor" ||
    trimmed === "prototype"
  ) {
    return null
  }
  return trimmed
}

function parseSeenUpdated(value: unknown): Record<string, number> {
  const seenUpdated: Record<string, number> = {}
  if (!isRecord(value)) return seenUpdated

  for (const [rawID, updated] of Object.entries(value)) {
    const sessionID = safeSessionID(rawID)
    if (
      sessionID &&
      typeof updated === "number" &&
      Number.isFinite(updated) &&
      updated >= 0
    ) {
      seenUpdated[sessionID] = updated
    }
  }

  return seenUpdated
}

function parseUnread(value: unknown): Record<string, true> {
  const unread: Record<string, true> = {}
  if (!isRecord(value)) return unread

  for (const [rawID, isUnread] of Object.entries(value)) {
    const sessionID = safeSessionID(rawID)
    if (sessionID && isUnread === true) {
      unread[sessionID] = true
    }
  }

  return unread
}

/**
 * Keep the persisted index bounded. Unread entries are kept first because
 * losing an unread marker is user-visible, then the most recently seen IDs.
 */
function boundSessionActivity(
  state: SessionActivityState
): SessionActivityState {
  const ids = [
    ...new Set([
      ...Object.keys(state.seenUpdated),
      ...Object.keys(state.unread),
    ]),
  ]
  if (ids.length <= MAX_SESSION_ACTIVITY_ENTRIES) return state

  const ordered = ids.sort((a, b) => {
    const unreadDiff =
      Number(state.unread[b] === true) - Number(state.unread[a] === true)
    if (unreadDiff !== 0) return unreadDiff

    const updatedDiff =
      (state.seenUpdated[b] ?? 0) - (state.seenUpdated[a] ?? 0)
    if (updatedDiff !== 0) return updatedDiff

    return a.localeCompare(b)
  })
  const keep = new Set(ordered.slice(0, MAX_SESSION_ACTIVITY_ENTRIES))
  const seenUpdated: Record<string, number> = {}
  const unread: Record<string, true> = {}

  for (const sessionID of keep) {
    const updated = state.seenUpdated[sessionID]
    if (updated !== undefined) seenUpdated[sessionID] = updated
    if (state.unread[sessionID]) unread[sessionID] = true
  }

  return { seenUpdated, unread }
}

export function sessionActivityStorageKey(
  origin: string,
  backendVersion: string
): string {
  return `${SESSION_ACTIVITY_STORAGE_PREFIX}:${encodeURIComponent(origin)}:${encodeURIComponent(backendVersion)}`
}

/**
 * Restore browser-local unread metadata for one origin/backend pair. Missing,
 * corrupt, mismatched, or unavailable storage is treated as empty state; this
 * only stores session IDs and durable timestamps, never message content.
 */
export function readStoredSessionActivity(
  storage: StorageLike | null,
  origin: string,
  backendVersion: string
): SessionActivityState {
  if (!storage) return EMPTY_SESSION_ACTIVITY

  let raw: string | null
  try {
    raw = storage.getItem(
      sessionActivityStorageKey(origin, backendVersion)
    )
  } catch {
    return EMPTY_SESSION_ACTIVITY
  }
  if (!raw) return EMPTY_SESSION_ACTIVITY

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return EMPTY_SESSION_ACTIVITY
    if (parsed.schemaVersion !== SESSION_ACTIVITY_SCHEMA_VERSION) {
      return EMPTY_SESSION_ACTIVITY
    }
    if (
      parsed.origin !== origin ||
      parsed.backendVersion !== backendVersion
    ) {
      return EMPTY_SESSION_ACTIVITY
    }

    return boundSessionActivity({
      seenUpdated: parseSeenUpdated(parsed.seenUpdated),
      unread: parseUnread(parsed.unread),
    })
  } catch {
    return EMPTY_SESSION_ACTIVITY
  }
}

/** Persist only IDs and last-seen timestamps. False means storage was denied. */
export function writeStoredSessionActivity(
  storage: StorageLike | null,
  origin: string,
  backendVersion: string,
  state: SessionActivityState
): boolean {
  if (!storage) return false

  const bounded = boundSessionActivity(state)

  try {
    storage.setItem(
      sessionActivityStorageKey(origin, backendVersion),
      JSON.stringify({
        schemaVersion: SESSION_ACTIVITY_SCHEMA_VERSION,
        origin,
        backendVersion,
        seenUpdated: bounded.seenUpdated,
        unread: bounded.unread,
      })
    )
    return true
  } catch {
    return false
  }
}

function sameNumberRecord(
  a: Record<string, number>,
  b: Record<string, number>
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((key) => a[key] === b[key])
}

function sameTrueRecord(
  a: Record<string, true>,
  b: Record<string, true>
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((key) => b[key] === true)
}

/**
 * Reconcile the sidebar's unread state with an authoritative session list.
 *
 * Only a known session whose durable `time.updated` advanced is marked unread.
 * A session seen for the first time is baselined instead, so an initial load or
 * a scope switch never retroactively marks every row. The active session is
 * always cleared and advanced, because selecting it is what "read" means here.
 *
 * This is also the reconnect path: the volatile event stream never replays, so
 * activity missed while disconnected is recovered from the durable session
 * timestamps instead of being invented from a gap.
 *
 * Entries not present in the current (possibly project-scoped or paginated)
 * list are retained. A scope switch must not forget that another project had
 * unseen activity, and an explicit delete is the only thing that removes an
 * entry early. Persisted storage is bounded separately.
 */
export function reconcileSessionActivity(
  state: SessionActivityState,
  sessions: readonly ActivitySession[],
  activeSessionID: string | null
): SessionActivityState {
  const seenUpdated: Record<string, number> = { ...state.seenUpdated }
  const unread: Record<string, true> = { ...state.unread }

  for (const session of sessions) {
    const previous = state.seenUpdated[session.id]
    const updated = session.time.updated
    const isActive = session.id === activeSessionID
    const wasUnread = state.unread[session.id] === true

    if (previous === undefined) {
      seenUpdated[session.id] = updated
      // An attention event can arrive before the session list has baselined
      // this id; keep that explicit unread rather than discarding it.
      if (isActive) {
        delete unread[session.id]
      } else if (wasUnread) {
        unread[session.id] = true
      }
      continue
    }

    const grew = updated > previous
    seenUpdated[session.id] = grew ? updated : previous

    if (isActive) {
      delete unread[session.id]
      continue
    }

    if (wasUnread || grew) {
      unread[session.id] = true
    }
  }

  return sameNumberRecord(state.seenUpdated, seenUpdated) &&
    sameTrueRecord(state.unread, unread)
    ? state
    : { seenUpdated, unread }
}

/** Mark a non-selected session as having unseen activity. */
export function markSessionUnread(
  state: SessionActivityState,
  sessionID: string | null
): SessionActivityState {
  if (!sessionID || state.unread[sessionID]) {
    return state
  }

  return {
    ...state,
    unread: { ...state.unread, [sessionID]: true },
  }
}

/** Remove activity bookkeeping for sessions that were deleted. */
export function forgetSessionActivity(
  state: SessionActivityState,
  sessionIDs: ReadonlySet<string>
): SessionActivityState {
  let changed = false
  const seenUpdated: Record<string, number> = {}
  const unread: Record<string, true> = {}

  for (const [sessionID, updated] of Object.entries(state.seenUpdated)) {
    if (sessionIDs.has(sessionID)) {
      changed = true
    } else {
      seenUpdated[sessionID] = updated
    }
  }

  for (const sessionID of Object.keys(state.unread)) {
    if (sessionIDs.has(sessionID)) {
      changed = true
    } else {
      unread[sessionID] = true
    }
  }

  return changed ? { seenUpdated, unread } : state
}
