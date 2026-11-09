import { useCallback, useMemo, useState, useSyncExternalStore } from "react"

import {
  normalizeToolVisibility,
  toolVisibilityStorageKey,
  writeToolVisibility,
  type ToolVisibilityMode,
} from "@/lib/tool-visibility"

const visibilityChanged = "opencode-ui:tool-visibility-changed"

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(visibilityChanged, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(visibilityChanged, callback)
  }
}

export function useToolVisibility(backendVersion: string | null) {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const key =
    backendVersion && typeof window !== "undefined"
      ? toolVisibilityStorageKey(origin, backendVersion)
      : null
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return key ? localStorage.getItem(key) ?? "" : ""
      } catch {
        return ""
      }
    },
    () => ""
  )
  const mode = useMemo(() => normalizeToolVisibility(raw), [raw])
  const [error, setError] = useState<string | null>(null)

  const setMode = useCallback(
    (next: ToolVisibilityMode) => {
      if (!key) {
        setError("Tool visibility is unavailable until the server version is known.")
        return false
      }
      try {
        const saved = writeToolVisibility(
          { setItem: (storageKey, value) => localStorage.setItem(storageKey, value) },
          origin,
          backendVersion!,
          next
        )
        if (!saved) {
          setError("Tool visibility could not be saved in this browser.")
          return false
        }
        window.dispatchEvent(new Event(visibilityChanged))
        setError(null)
        return true
      } catch {
        setError("Tool visibility could not be saved in this browser.")
        return false
      }
    },
    [backendVersion, key, origin]
  )

  return { mode, setMode, error }
}
