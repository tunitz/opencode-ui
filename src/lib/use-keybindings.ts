import { useCallback, useMemo, useState, useSyncExternalStore } from "react"

import {
  defaultKeybindings,
  keybindingStorageKey,
  parseKeybindings,
  readKeybindings,
  resetKeybindings,
  writeKeybindings,
  type Keybinding,
} from "@/lib/keybindings"

const keybindingsChanged = "opencode-ui:keybindings-changed"

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(keybindingsChanged, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(keybindingsChanged, callback)
  }
}

/** Custom keybindings are browser-local; hardware keyboards work on mobile. */
export function useKeybindings() {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(keybindingStorageKey(origin)) ?? ""
      } catch {
        return ""
      }
    },
    () => ""
  )
  const bindings = useMemo(() => parseKeybindings(raw), [raw])
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(
    (next: readonly Keybinding[]) => {
      try {
        if (!writeKeybindings(localStorage, origin, next)) {
          setError("Keybindings could not be saved in this browser.")
          return false
        }
        window.dispatchEvent(new Event(keybindingsChanged))
        setError(null)
        return true
      } catch {
        setError("Keybindings could not be saved in this browser.")
        return false
      }
    },
    [origin]
  )

  const reset = useCallback(() => {
    try {
      resetKeybindings(localStorage, origin)
    } catch {
      // Reset still returns defaults below.
    }
    window.dispatchEvent(new Event(keybindingsChanged))
    return defaultKeybindings()
  }, [origin])

  return { bindings, save, reset, error, storageAvailable: typeof window !== "undefined" }
}

/** Read bindings outside React (event handlers, tests). */
export function readCurrentKeybindings(): Keybinding[] {
  if (typeof window === "undefined") return defaultKeybindings()
  return readKeybindings(window.localStorage, window.location.origin)
}
