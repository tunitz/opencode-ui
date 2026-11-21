import { useCallback, useEffect, useRef, useState } from "react"

import {
  parseSessionShortcuts,
  updateSessionShortcut,
  type SessionShortcut,
  type SessionShortcuts,
} from "@/lib/session-shortcuts"
import {
  assignLegacyShortcuts,
  readSessionShortcuts,
  updateSessionShortcutOnServer,
} from "@/lib/session-shortcuts-api"

/**
 * Session pins and labels are app-server state scoped to the active saved
 * connection. They are shared by every browser and device signed into this UI,
 * and they never change native sessions. Responses from a previous connection
 * are discarded so switching connections never mixes their pins or labels.
 */
export function useSessionShortcuts(connectionId: string | null) {
  const [shortcuts, setShortcuts] = useState<SessionShortcuts>(() =>
    parseSessionShortcuts(null)
  )
  const [legacyCount, setLegacyCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const requestToken = useRef(0)

  const apply = useCallback(
    (state: { shortcuts: SessionShortcuts; legacyCount: number }, token: number) => {
      if (token !== requestToken.current) return
      setShortcuts(state.shortcuts)
      setLegacyCount(state.legacyCount)
      setError(null)
    },
    []
  )

  const refresh = useCallback(async () => {
    const token = ++requestToken.current
    try {
      apply(await readSessionShortcuts(connectionId), token)
    } catch {
      if (token === requestToken.current) setError("Could not load session pins and labels.")
    }
  }, [apply, connectionId])

  /* eslint-disable react-hooks/set-state-in-effect -- state is cleared and reloaded
     when the active connection changes; in-flight responses are tagged with a token. */
  useEffect(() => {
    const token = ++requestToken.current
    setShortcuts(parseSessionShortcuts(null))
    setLegacyCount(0)
    setError(null)
    void readSessionShortcuts(connectionId).then(
      (state) => apply(state, token),
      () => {
        if (token === requestToken.current) setError("Could not load session pins and labels.")
      }
    )
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [connectionId, apply, refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  const update = useCallback(
    (id: string, change: Partial<SessionShortcut>) => {
      const token = requestToken.current
      setShortcuts((current) => updateSessionShortcut(current, id, change))
      void updateSessionShortcutOnServer(connectionId, id, change).then(
        (state) => apply(state, token),
        () => {
          if (token !== requestToken.current) return
          setError("Could not save session pins and labels.")
          void refresh()
        }
      )
      return true
    },
    [apply, refresh, connectionId]
  )

  const assignLegacy = useCallback(async (): Promise<boolean> => {
    const token = requestToken.current
    try {
      const state = await assignLegacyShortcuts(connectionId ?? "")
      apply(state, token)
      return true
    } catch {
      if (token === requestToken.current) setError("Could not save session pins and labels.")
      return false
    }
  }, [apply, connectionId])

  return { shortcuts, legacyCount, update, assignLegacy, error, refresh }
}
