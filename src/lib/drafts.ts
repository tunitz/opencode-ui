/**
 * Per-session unsent composer drafts persisted in `localStorage`, scoped to the
 * origin plus each session id. Only draft text is stored — never credentials,
 * transcripts, or history. Drafts are stored in full (no silent truncation);
 * the browser's own quota is the only limit, and a failed write is reported
 * honestly so the composer can keep the text in memory without claiming it was
 * saved.
 */

const STORAGE_KEY = "opencode-ui:drafts"
const STORAGE_VERSION = 1

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): StorageLike | null {
  try {
    const value = globalThis.localStorage

    // Accessing localStorage can throw in some privacy modes.
    return value ?? null
  } catch {
    return null
  }
}

/** True when the environment has no usable storage (privacy mode / denied). */
export function storageUnavailable(): boolean {
  return storage() === null
}

function sanitizeStrings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value
    }
  }

  return out
}

/** Hydrate all drafts, or an empty map when storage is missing/corrupt/old. */
export function readDrafts(): Record<string, string> {
  const s = storage()

  if (!s) {
    return {}
  }

  try {
    const raw = s.getItem(STORAGE_KEY)

    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }

    const envelope = parsed as { version?: unknown; drafts?: unknown }

    if (envelope.version !== STORAGE_VERSION) {
      return {}
    }

    return sanitizeStrings(envelope.drafts)
  } catch {
    return {}
  }
}

/** Read one session's draft (for re-hydration after a session switch). */
export function readDraft(sessionID: string): string {
  return readDrafts()[sessionID] ?? ""
}

/** Update only one session, refusing to overwrite a different tab's edit. */
export function updateDraft(sessionID: string, value: string, expected: string): "saved" | "conflict" | "unavailable" {
  const s = storage()
  if (!s) return "unavailable"
  try {
    const drafts = readDrafts()
    if ((drafts[sessionID] ?? "") === value) return "saved"
    if ((drafts[sessionID] ?? "") !== expected) return "conflict"
    if (value) drafts[sessionID] = value
    else delete drafts[sessionID]
    s.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, drafts }))
    return "saved"
  } catch {
    return "unavailable"
  }
}

/**
 * Persist the full draft map in full (no truncation). Returns false when
 * storage is unavailable or the write failed (quota/denied), so the caller can
 * keep the text in memory and surface an honest "not saved" warning.
 */
export function writeDrafts(drafts: Record<string, string>): boolean {
  const s = storage()

  if (!s) {
    return false
  }

  const clean: Record<string, string> = {}

  for (const [key, value] of Object.entries(drafts)) {
    if (value !== "") {
      clean[key] = value
    }
  }

  try {
    s.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, drafts: clean })
    )
    return true
  } catch {
    return false
  }
}

/** Remove one session's draft (read-modify-write; used on confirmed deletion). */
export function removeDraft(sessionID: string): boolean {
  const s = storage()

  if (!s) {
    return false
  }

  const drafts = readDrafts()
  delete drafts[sessionID]

  try {
    s.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, drafts })
    )
    return true
  } catch {
    return false
  }
}
