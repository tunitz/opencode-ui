import { uiSyncSnapshotSchema, type UiSyncSnapshot } from "./ui-sync-contract"
import { parseSessionShortcuts, shortcutStorageKey } from "./session-shortcuts"
import { preferencesStorageKey, readStoredPreferences } from "./web-ui-preferences"

const PRESETS_KEY = "opencode-ui:model-presets:v1"

/** Explicitly select supported fields; never enumerate browser storage. */
export function collectUiSyncSnapshot(storage: Pick<Storage, "getItem" | "setItem">, origin: string, backendVersion: string): UiSyncSnapshot {
  const stored = readStoredPreferences(storage, origin, backendVersion)
  if (stored.warning) throw new Error(stored.warning)
  const rawPresets = storage.getItem(PRESETS_KEY)
  const shortcuts = parseSessionShortcuts(storage.getItem(shortcutStorageKey(origin, backendVersion)))
  const entries = Object.entries(shortcuts)
  const theme = storage.getItem("theme") ?? "system"
  return uiSyncSnapshotSchema.parse({
    version: 1, backendVersion,
    preferences: { theme, global: stored.preferences.global, startup: stored.preferences.startup },
    presets: rawPresets ? JSON.parse(rawPresets) : [],
    pins: entries.filter(([, value]) => value.pinned).map(([id]) => id),
    labels: entries.filter(([, value]) => value.label).map(([id, value]) => ({ id, label: value.label })),
  })
}

/** Return explicit storage updates for a confirmed download; does not mutate UI state. */
export function uiSyncStorageUpdates(input: UiSyncSnapshot, origin: string, backendVersion: string): Record<string, string> {
  const snapshot = uiSyncSnapshotSchema.parse(input)
  if (snapshot.backendVersion !== backendVersion) throw new Error("Sync backend version mismatch")
  const shortcuts: Record<string, { pinned: boolean; label: string }> = Object.create(null)
  for (const id of snapshot.pins) shortcuts[id] = { pinned: true, label: "" }
  for (const { id, label } of snapshot.labels) shortcuts[id] = { pinned: shortcuts[id]?.pinned ?? false, label }
  if (Object.keys(shortcuts).length > 500) throw new Error("Too many session shortcuts")
  return {
    theme: snapshot.preferences.theme,
    [PRESETS_KEY]: JSON.stringify(snapshot.presets),
    [shortcutStorageKey(origin, backendVersion)]: JSON.stringify(shortcuts),
    [preferencesStorageKey(origin, backendVersion)]: JSON.stringify({ schemaVersion: 1, origin, backendVersion, global: snapshot.preferences.global, startup: snapshot.preferences.startup, projectOverrides: {} }),
  }
}
