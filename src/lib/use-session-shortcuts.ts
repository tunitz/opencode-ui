import { useCallback, useEffect, useState } from "react"

import {
  parseSessionShortcuts,
  updateSessionShortcut,
  type SessionShortcut,
  type SessionShortcuts,
} from "@/lib/session-shortcuts"
import {
  readSessionShortcuts,
  updateSessionShortcutOnServer,
} from "@/lib/session-shortcuts-api"

/**
 * Session pins and labels are app-server state, so they are shared by every
 * browser and device signed into this UI. They never change native sessions.
 */
export function useSessionShortcuts() {
  const [shortcuts, setShortcuts] = useState<SessionShortcuts>(() =>
    parseSessionShortcuts(null)
  )
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setShortcuts(await readSessionShortcuts())
      setError(null)
    } catch {
      setError("Could not load session pins and labels.")
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => void refresh())
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [refresh])

  const update = useCallback((id: string, change: Partial<SessionShortcut>) => {
    setShortcuts((current) => updateSessionShortcut(current, id, change))
    void updateSessionShortcutOnServer(id, change)
      .then((next) => {
        setShortcuts(next)
        setError(null)
      })
      .catch(() => {
        setError("Could not save session pins and labels.")
        void refresh()
      })
    return true
  }, [refresh])

  return { shortcuts, update, error, refresh }
}
