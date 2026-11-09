import { useMemo, useState, useSyncExternalStore } from "react"

import {
  parseSessionShortcuts,
  shortcutStorageKey,
  updateSessionShortcut,
  type SessionShortcut,
} from "@/lib/session-shortcuts"

const shortcutsChanged = "opencode-ui:session-shortcuts-changed"

function subscribeShortcuts(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(shortcutsChanged, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(shortcutsChanged, callback)
  }
}

/**
 * Browser-local session labels and pins. These never change native session
 * data, so they are explicitly a local view preference.
 */
export function useSessionShortcuts(version: string | null) {
  const key = version ? shortcutStorageKey(window.location.origin, version) : null
  const raw = useSyncExternalStore(
    subscribeShortcuts,
    () => {
      try {
        return key ? localStorage.getItem(key) ?? "" : ""
      } catch {
        return ""
      }
    },
    () => ""
  )
  const shortcuts = useMemo(() => parseSessionShortcuts(raw), [raw])
  const [error, setError] = useState<string | null>(null)

  function update(id: string, change: Partial<SessionShortcut>) {
    if (!key) {
      setError("Session labels and pins are unavailable until the server version is known.")
      return false
    }
    try {
      const current = parseSessionShortcuts(localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify(updateSessionShortcut(current, id, change))
      )
      window.dispatchEvent(new Event(shortcutsChanged))
      setError(null)
      return true
    } catch {
      setError("Could not save session labels and pins in this browser.")
      return false
    }
  }

  return { shortcuts, update, error }
}
