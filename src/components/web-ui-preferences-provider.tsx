import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  clearAllProjectOverrides,
  createDefaultPreferences,
  readStoredPreferences,
  resetGlobalDefaults,
  updateGlobalDefaults,
  updateStartup,
  writeStoredPreferences,
  type GlobalDefaults,
  type PreferenceOverride,
  type StartupPreference,
  type WebUiPreferences,
} from "@/lib/web-ui-preferences"

type SaveStatus = "saved" | "unsaved" | null

type PreferencesContextValue = {
  ready: boolean
  preferences: WebUiPreferences
  storageWarning: string | null
  saveStatus: SaveStatus
  setStartup: (startup: StartupPreference) => void
  setGlobal: (patch: Partial<GlobalDefaults>) => void
  resetGlobal: () => void
  clearAllProjects: () => void
  setStorageWarning: (warning: string | null) => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

function storage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function WebUiPreferencesProvider({
  serverVersion,
  children,
}: {
  serverVersion: string | null
  children: ReactNode
}) {
  const origin = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    []
  )
  const [preferences, setPreferences] = useState<WebUiPreferences>(() =>
    createDefaultPreferences(origin, serverVersion ?? "")
  )
  const [ready, setReady] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const preferencesRef = useRef(preferences)

  useEffect(() => {
    if (!serverVersion) return
    const store = storage()
    if (!store) {
      void Promise.resolve().then(() => {
        setReady(true)
        setStorageWarning(
          "Browser storage is unavailable. Preferences cannot be saved."
        )
      })
      return
    }

    const stored = readStoredPreferences(store, origin, serverVersion)
    // Rewrite immediately when a legacy record contained project overrides so
    // the stale values are purged from storage, not merely ignored in memory.
    const migrationFailed = stored.projectOverridesCleared &&
      !writeStoredPreferences(store, stored.preferences)
    void Promise.resolve().then(() => {
      preferencesRef.current = stored.preferences
      setPreferences(stored.preferences)
      setStorageWarning(migrationFailed
        ? "Browser storage is unavailable. Preferences cannot be saved."
        : stored.warning)
      setSaveStatus(null)
      setReady(true)
    })
  }, [origin, serverVersion])

  const commit = useCallback(
    (updater: (current: WebUiPreferences) => WebUiPreferences) => {
      if (!serverVersion) return
      const updated = updater(preferencesRef.current)
      // Project-level defaults are unsupported: never persist or apply one,
      // even if an older in-memory state or future caller supplies one.
      const next = clearAllProjectOverrides(updated)
      preferencesRef.current = next
      setPreferences(next)
      const store = storage()
      const saved = store ? writeStoredPreferences(store, next) : false
      setSaveStatus(saved ? "saved" : "unsaved")
      setStorageWarning(
        saved
          ? null
          : "Preferences could not be saved in this browser. Changes apply for this tab only."
      )
    },
    [serverVersion]
  )

  const value = useMemo<PreferencesContextValue>(() => {
    return {
      ready,
      preferences,
      storageWarning,
      saveStatus,
      setStartup: (startup) =>
        commit((current) => updateStartup(current, startup)),
      setGlobal: (patch) =>
        commit((current) => updateGlobalDefaults(current, patch)),
      resetGlobal: () => commit(resetGlobalDefaults),
      clearAllProjects: () => commit(clearAllProjectOverrides),
      setStorageWarning,
    }
  }, [commit, preferences, ready, saveStatus, storageWarning])

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  )
}

export function useWebUiPreferences() {
  const context = useContext(PreferencesContext)
  if (!context) {
    throw new Error(
      "useWebUiPreferences must be used inside WebUiPreferencesProvider"
    )
  }
  return context
}

export type { PreferenceOverride }
