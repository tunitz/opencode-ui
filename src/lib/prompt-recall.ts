/**
 * Browser-local, per-session sent-prompt history (ArrowUp recall) and prompt
 * stash. Scoped to the origin, backend version and session id. Only prompt
 * text, stash ids and timestamps are stored — never credentials, transcripts
 * or engine data. Storage is treated as untrusted: every read parses
 * defensively and every write failure falls back to the in-memory result.
 */

const STORAGE_VERSION = 1
const HISTORY_PREFIX = "opencode-ui:prompt-history:v1"
const STASH_PREFIX = "opencode-ui:prompt-stash:v1"
const RESERVED_SESSION_IDS = new Set(["__proto__", "constructor", "prototype"])
const MAX_SESSION_ID_LENGTH = 256

export type KeyValueStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export const RECALL_LIMIT = 50
export const STASH_LIMIT = 20
export const STASH_PREVIEW_LIMIT = 120

function scopedKey(prefix: string, origin: string, backendVersion: string, sessionID: string): string {
  if (
    typeof sessionID !== "string" ||
    sessionID.length > MAX_SESSION_ID_LENGTH ||
    RESERVED_SESSION_IDS.has(sessionID)
  ) {
    throw new TypeError("Invalid session ID")
  }

  return `${prefix}:${encodeURIComponent(origin)}:${encodeURIComponent(backendVersion)}:${encodeURIComponent(sessionID)}`
}

export function promptHistoryStorageKey(origin: string, backendVersion: string, sessionID: string): string {
  return scopedKey(HISTORY_PREFIX, origin, backendVersion, sessionID)
}

export function promptStashStorageKey(origin: string, backendVersion: string, sessionID: string): string {
  return scopedKey(STASH_PREFIX, origin, backendVersion, sessionID)
}

/** Read and validate the shared storage envelope; null means missing/corrupt/old. */
function readEntries(storage: KeyValueStorage | null, key: string): unknown[] | null {
  if (!storage) {
    return null
  }

  try {
    const raw = storage.getItem(key)

    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    const envelope = parsed as { version?: unknown; entries?: unknown }

    if (envelope.version !== STORAGE_VERSION || !Array.isArray(envelope.entries)) {
      return null
    }

    return envelope.entries
  } catch {
    // Denied, unavailable, or malformed storage reads as empty.
    return null
  }
}

function writeEntries(storage: KeyValueStorage | null, key: string, entries: readonly unknown[]): void {
  if (!storage) {
    return
  }

  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, entries }))
  } catch {
    // Quota/denied writes are not fatal; callers keep the in-memory result.
  }
}

export function readPromptHistory(
  storage: KeyValueStorage | null,
  origin: string,
  backendVersion: string,
  sessionID: string
): string[] {
  const entries = readEntries(storage, promptHistoryStorageKey(origin, backendVersion, sessionID))

  if (!entries) {
    return []
  }

  const history: string[] = []

  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim() === "") {
      continue
    }

    history.push(entry)

    if (history.length >= RECALL_LIMIT) {
      break
    }
  }

  return history
}

export function recordPrompt(
  storage: KeyValueStorage | null,
  origin: string,
  backendVersion: string,
  sessionID: string,
  text: string
): string[] {
  // Validate the session up front so an invalid id throws even without storage.
  const key = promptHistoryStorageKey(origin, backendVersion, sessionID)
  const current = readPromptHistory(storage, origin, backendVersion, sessionID)

  if (typeof text !== "string" || text.trim() === "") {
    return current
  }

  // Newest first; an exact duplicate moves its newest occurrence to the front.
  const next = [text, ...current.filter((entry) => entry !== text)].slice(0, RECALL_LIMIT)

  writeEntries(storage, key, next)

  return next
}

export function cycleRecall(
  history: readonly string[],
  index: number,
  direction: "older" | "newer"
): { index: number; text: string | null } {
  const last = history.length - 1

  if (last < 0) {
    return { index: -1, text: null }
  }

  if (direction === "newer") {
    if (index < 0) {
      return { index: -1, text: null }
    }

    const current = Math.min(Math.floor(index), last)

    if (current <= 0) {
      return { index: -1, text: null }
    }

    return { index: current - 1, text: history[current - 1] ?? null }
  }

  if (index < 0) {
    return { index: 0, text: history[0] ?? null }
  }

  const current = Math.min(Math.floor(index), last)

  if (current >= last) {
    return { index: last, text: history[last] ?? null }
  }

  return { index: current + 1, text: history[current + 1] ?? null }
}

export type StashEntry = { id: string; text: string; createdAt: number }

export function readPromptStash(
  storage: KeyValueStorage | null,
  origin: string,
  backendVersion: string,
  sessionID: string
): StashEntry[] {
  const entries = readEntries(storage, promptStashStorageKey(origin, backendVersion, sessionID))

  if (!entries) {
    return []
  }

  const stash: StashEntry[] = []

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue
    }

    const candidate = entry as Record<string, unknown>
    const id = candidate.id
    const text = candidate.text
    const createdAt = candidate.createdAt

    if (typeof id !== "string" || id === "") {
      continue
    }

    if (typeof text !== "string" || text.trim() === "") {
      continue
    }

    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
      continue
    }

    stash.push({ id, text, createdAt })

    if (stash.length >= STASH_LIMIT) {
      break
    }
  }

  return stash
}

function nextStashID(entries: readonly StashEntry[], now: number): string {
  const used = new Set(entries.map((entry) => entry.id))
  let sequence = 0

  while (used.has(`${now}-${sequence}`)) {
    sequence += 1
  }

  return `${now}-${sequence}`
}

export function stashPrompt(
  storage: KeyValueStorage | null,
  origin: string,
  backendVersion: string,
  sessionID: string,
  text: string,
  now: number = Date.now()
): StashEntry[] {
  // Validate the session up front so an invalid id throws even without storage.
  const key = promptStashStorageKey(origin, backendVersion, sessionID)
  const current = readPromptStash(storage, origin, backendVersion, sessionID)

  if (typeof text !== "string" || text.trim() === "") {
    return current
  }

  const createdAt = Number.isFinite(now) ? now : Date.now()
  const entry: StashEntry = { id: nextStashID(current, createdAt), text, createdAt }

  // Newest first; exact duplicates are allowed as separate stashes.
  const next = [entry, ...current].slice(0, STASH_LIMIT)

  writeEntries(storage, key, next)

  return next
}

export function removeStashedPrompt(
  storage: KeyValueStorage | null,
  origin: string,
  backendVersion: string,
  sessionID: string,
  id: string
): StashEntry[] {
  const key = promptStashStorageKey(origin, backendVersion, sessionID)
  const next = readPromptStash(storage, origin, backendVersion, sessionID).filter((entry) => entry.id !== id)

  writeEntries(storage, key, next)

  return next
}

export function stashPreview(text: string): string {
  const collapsed = (typeof text === "string" ? text : "").replace(/\s+/g, " ").trim()

  return collapsed.length > STASH_PREVIEW_LIMIT
    ? `${collapsed.slice(0, STASH_PREVIEW_LIMIT)}…`
    : collapsed
}
