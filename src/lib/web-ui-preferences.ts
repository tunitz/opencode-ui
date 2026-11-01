import type { ModelRef } from "@/lib/opencode"

export const PREFERENCES_SCHEMA_VERSION = 1
const PREFERENCES_PREFIX = "opencode-ui:preferences:v1"
const LAST_OPENED_PREFIX = "opencode-ui:last-opened:v1"
const MAX_ID_LENGTH = 256

export type ModelPreference = {
  providerID: string
  modelID: string
}

export type StartupPreference =
  | { mode: "last" }
  | { mode: "pinned"; projectID: string }

export type GlobalDefaults = {
  agentID: string | null
  model: ModelPreference | null
  thinkingLevel: string | null
}

export type PreferenceOverride<T> =
  | { mode: "inherit" }
  | { mode: "set"; value: T }

export type ProjectOverride = {
  directory: string
  agent: PreferenceOverride<string>
  model: PreferenceOverride<ModelPreference>
  thinkingLevel: PreferenceOverride<string>
}

export type WebUiPreferences = {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION
  origin: string
  backendVersion: string
  startup: StartupPreference
  global: GlobalDefaults
  /**
   * Legacy project-level defaults. The app no longer reads or writes these;
   * stored values are discarded on load and every write keeps this empty so
   * stale overrides cannot silently mask global defaults.
   */
  projectOverrides: Record<string, ProjectOverride>
}

export type LastOpenedScope =
  | { kind: "project"; projectID: string; directory: string }
  | { kind: "all" }

type StorageLike = Pick<Storage, "getItem" | "setItem">
type ReadResult = {
  preferences: WebUiPreferences
  warning: string | null
  projectOverridesCleared: boolean
}

export function createDefaultPreferences(
  origin: string,
  backendVersion: string
): WebUiPreferences {
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    origin,
    backendVersion,
    startup: { mode: "last" },
    global: { agentID: null, model: null, thinkingLevel: null },
    projectOverrides: {},
  }
}

export function preferencesStorageKey(origin: string, backendVersion: string) {
  return `${PREFERENCES_PREFIX}:${encodeURIComponent(origin)}:${encodeURIComponent(backendVersion)}`
}

export function lastOpenedStorageKey(origin: string, backendVersion: string) {
  return `${LAST_OPENED_PREFIX}:${encodeURIComponent(origin)}:${encodeURIComponent(backendVersion)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeID(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_ID_LENGTH
    ? trimmed
    : null
}

function parseModel(value: unknown): ModelPreference | null {
  if (!isRecord(value)) return null
  const providerID = safeID(value.providerID)
  const modelID = safeID(value.modelID)
  return providerID && modelID ? { providerID, modelID } : null
}

function parseStartup(value: unknown): StartupPreference {
  if (!isRecord(value)) return { mode: "last" }
  if (value.mode === "pinned") {
    const projectID = safeID(value.projectID)
    return projectID ? { mode: "pinned", projectID } : { mode: "last" }
  }
  return { mode: "last" }
}

function parseGlobal(value: unknown): GlobalDefaults {
  if (!isRecord(value)) {
    return { agentID: null, model: null, thinkingLevel: null }
  }
  return {
    agentID: safeID(value.agentID),
    model: parseModel(value.model),
    thinkingLevel: safeID(value.thinkingLevel),
  }
}

/**
 * Versioned migration. Version 0 was never shipped, but the identity is kept
 * explicit so malformed/legacy data can never be interpreted as current data.
 */
function migrateRecord(
  value: unknown,
  origin: string,
  backendVersion: string
): WebUiPreferences | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion === PREFERENCES_SCHEMA_VERSION) {
    return {
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      origin,
      backendVersion,
      startup: parseStartup(value.startup),
      global: parseGlobal(value.global),
      projectOverrides: {},
    }
  }
  if (value.schemaVersion === 0) {
    return {
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      origin,
      backendVersion,
      startup: parseStartup(value.startup),
      global: parseGlobal(value.global),
      projectOverrides: {},
    }
  }
  return null
}

export function readStoredPreferences(
  storage: StorageLike,
  origin: string,
  backendVersion: string
): ReadResult {
  const fallback = createDefaultPreferences(origin, backendVersion)
  let raw: string | null
  try {
    raw = storage.getItem(preferencesStorageKey(origin, backendVersion))
  } catch {
    return {
      preferences: fallback,
      warning: "Browser storage is unavailable. Preferences are not saved.",
      projectOverridesCleared: false,
    }
  }
  if (!raw) {
    return {
      preferences: fallback,
      warning: null,
      projectOverridesCleared: false,
    }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return {
        preferences: fallback,
        warning: "Saved preferences were unreadable; defaults were restored.",
        projectOverridesCleared: false,
      }
    }
    if (
      parsed.origin !== origin ||
      parsed.backendVersion !== backendVersion
    ) {
      return {
        preferences: fallback,
        warning:
          "Saved preferences belong to another backend and were not applied.",
        projectOverridesCleared: false,
      }
    }
    const hadProjectOverrides =
      isRecord(parsed.projectOverrides) &&
      Object.keys(parsed.projectOverrides).length > 0
    const migrated = migrateRecord(parsed, origin, backendVersion)
    return migrated
      ? {
          preferences: migrated,
          warning: hadProjectOverrides
            ? "Saved project overrides are no longer supported and were cleared. Global defaults now apply."
            : null,
          projectOverridesCleared: hadProjectOverrides,
        }
      : {
          preferences: fallback,
          warning: "Saved preferences use an unsupported version; defaults were restored.",
          projectOverridesCleared: false,
        }
  } catch {
    return {
      preferences: fallback,
      warning: "Saved preferences were corrupt; defaults were restored.",
      projectOverridesCleared: false,
    }
  }
}

export function writeStoredPreferences(
  storage: StorageLike,
  preferences: WebUiPreferences
): boolean {
  try {
    storage.setItem(
      preferencesStorageKey(
        preferences.origin,
        preferences.backendVersion
      ),
      JSON.stringify(preferences)
    )
    return true
  } catch {
    return false
  }
}

export function readStoredLastOpened(
  storage: StorageLike,
  origin: string,
  backendVersion: string
): LastOpenedScope | null {
  try {
    const raw = storage.getItem(lastOpenedStorageKey(origin, backendVersion))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.schemaVersion !== PREFERENCES_SCHEMA_VERSION) {
      return null
    }
    if (value.kind === "all") return { kind: "all" }
    if (value.kind === "project") {
      const projectID = safeID(value.projectID)
      const directory =
        typeof value.directory === "string" ? value.directory.trim() : ""
      return projectID && directory
        ? { kind: "project", projectID, directory }
        : null
    }
  } catch {
    return null
  }
  return null
}

export function writeStoredLastOpened(
  storage: StorageLike,
  origin: string,
  backendVersion: string,
  scope: LastOpenedScope
): boolean {
  try {
    storage.setItem(
      lastOpenedStorageKey(origin, backendVersion),
      JSON.stringify({
        schemaVersion: PREFERENCES_SCHEMA_VERSION,
        ...scope,
      })
    )
    return true
  } catch {
    return false
  }
}

export function updateStartup(
  preferences: WebUiPreferences,
  startup: StartupPreference
): WebUiPreferences {
  return { ...preferences, startup }
}

export function updateGlobalDefaults(
  preferences: WebUiPreferences,
  patch: Partial<GlobalDefaults>
): WebUiPreferences {
  return { ...preferences, global: { ...preferences.global, ...patch } }
}

/**
 * Unsupported project defaults are kept in the stored shape only so old
 * records can still be parsed and normalized. This is the explicit clear-all
 * path used by the Settings UI and by preference commits.
 */
export function clearAllProjectOverrides(
  preferences: WebUiPreferences
): WebUiPreferences {
  if (Object.keys(preferences.projectOverrides).length === 0) return preferences
  return { ...preferences, projectOverrides: {} }
}

export function resetGlobalDefaults(
  preferences: WebUiPreferences
): WebUiPreferences {
  return updateGlobalDefaults(preferences, {
    agentID: null,
    model: null,
    thinkingLevel: null,
  })
}

export function modelPreferenceFromRef(model: ModelRef): ModelPreference {
  return { providerID: model.providerID, modelID: model.id }
}

export function modelPreferenceToRef(
  model: ModelPreference,
  thinkingLevel: string | null
): ModelRef {
  return thinkingLevel
    ? {
        providerID: model.providerID,
        id: model.modelID,
        variant: thinkingLevel,
      }
    : { providerID: model.providerID, id: model.modelID }
}

export type StartupResolution = {
  scope: "project" | "all" | null
  projectID: string | null
  directory: string | null
  warning: string | null
}

/**
 * Resolve startup only after the native project list is available. Last-opened
 * restores exactly the last successful scope, including All projects. A pinned
 * project always wins while browsing and is never overwritten by last-opened.
 */
export function resolveStartupScope(
  preferences: WebUiPreferences,
  lastOpened: LastOpenedScope | null,
  projects: readonly { id: string; canonical: string }[]
): StartupResolution {
  const desired =
    preferences.startup.mode === "pinned"
      ? { kind: "project" as const, projectID: preferences.startup.projectID }
      : lastOpened

  if (!desired) {
    return { scope: null, projectID: null, directory: null, warning: null }
  }
  if (desired.kind === "all") {
    return {
      scope: "all",
      projectID: null,
      directory: null,
      warning: null,
    }
  }

  const found = projects.find((project) => project.id === desired.projectID)
  if (found) {
    return {
      scope: "project",
      projectID: found.id,
      directory: found.canonical,
      warning: null,
    }
  }

  const fallback =
    preferences.startup.mode === "pinned" && lastOpened?.kind === "project"
      ? projects.find((project) => project.id === lastOpened.projectID)
      : null

  return {
    scope: fallback ? "project" : null,
    projectID: fallback?.id ?? null,
    directory: fallback?.canonical ?? null,
    warning: fallback
      ? "The pinned startup project is unavailable. Opened the last project instead."
      : "The saved startup project is unavailable. Opened the default project instead.",
  }
}
