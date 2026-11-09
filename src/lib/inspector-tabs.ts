/**
 * Inspector tab identity and per-session browser-local persistence.
 *
 * Only the selected view is stored here. It is a non-authoritative preference;
 * every panel reads its own data from the engine.
 */

export const INSPECTOR_TAB_IDS = [
  "command",
  "files",
  "changes",
  "activity",
  "session",
] as const

export type InspectorTab = (typeof INSPECTOR_TAB_IDS)[number]

export const CHANGES_SCOPES = ["working", "turn"] as const
export type ChangesScope = (typeof CHANGES_SCOPES)[number]

export const INSPECTOR_TAB_LABELS: Record<InspectorTab, string> = {
  command: "Command",
  files: "Files",
  changes: "Changes",
  activity: "Activity",
  session: "Session",
}

export const INSPECTOR_STORAGE_PREFIX = "opencode-ui:inspector-tabs:v1"
const MAX_SESSION_ID_LENGTH = 256

function isInspectorTab(value: unknown): value is InspectorTab {
  return (
    typeof value === "string" &&
    (INSPECTOR_TAB_IDS as readonly string[]).includes(value)
  )
}

export function normalizeInspectorTab(value: unknown): InspectorTab {
  return isInspectorTab(value) ? value : "command"
}

export function normalizeChangesScope(value: unknown): ChangesScope {
  return value === "turn" ? "turn" : "working"
}

function safeSessionID(sessionID: string): boolean {
  return (
    sessionID.length > 0 &&
    sessionID.length <= MAX_SESSION_ID_LENGTH &&
    !["__proto__", "constructor", "prototype"].includes(sessionID)
  )
}

export function inspectorStorageKey(origin: string): string {
  return `${INSPECTOR_STORAGE_PREFIX}:${encodeURIComponent(origin)}`
}

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storageOrNull(): StorageLike | null {
  try {
    const value = globalThis.localStorage
    return value ?? null
  } catch {
    return null
  }
}

export function parseInspectorTabs(
  raw: string | null
): Record<string, InspectorTab> {
  const tabs: Record<string, InspectorTab> = {}
  if (!raw) return tabs
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return tabs
    }
    const envelope = parsed as { version?: unknown; tabs?: unknown }
    if (envelope.version !== 1) return tabs
    if (!envelope.tabs || typeof envelope.tabs !== "object" || Array.isArray(envelope.tabs)) {
      return tabs
    }
    for (const [sessionID, tab] of Object.entries(
      envelope.tabs as Record<string, unknown>
    )) {
      if (safeSessionID(sessionID) && isInspectorTab(tab)) {
        tabs[sessionID] = tab
      }
    }
  } catch {
    // Corrupt storage is treated as empty; the default tab still works.
  }
  return tabs
}

export function readInspectorTabs(
  storage: StorageLike | null = storageOrNull(),
  origin = typeof window === "undefined" ? "" : window.location.origin
): Record<string, InspectorTab> {
  if (!storage) return {}
  try {
    return parseInspectorTabs(storage.getItem(inspectorStorageKey(origin)))
  } catch {
    return {}
  }
}

export function readInspectorTab(
  sessionID: string | null,
  storage: StorageLike | null = storageOrNull(),
  origin = typeof window === "undefined" ? "" : window.location.origin
): InspectorTab {
  if (!sessionID || !safeSessionID(sessionID)) return "command"
  return readInspectorTabs(storage, origin)[sessionID] ?? "command"
}

export function writeInspectorTab(
  sessionID: string,
  tab: InspectorTab,
  storage: StorageLike | null = storageOrNull(),
  origin = typeof window === "undefined" ? "" : window.location.origin
): boolean {
  if (!safeSessionID(sessionID) || !storage) return false
  try {
    const tabs = readInspectorTabs(storage, origin)
    if (tabs[sessionID] === tab) return true
    tabs[sessionID] = tab
    storage.setItem(
      inspectorStorageKey(origin),
      JSON.stringify({ version: 1, tabs })
    )
    return true
  } catch {
    return false
  }
}
