import { useCallback, useMemo, useSyncExternalStore } from "react"

const PREFIX = "opencode-ui:model-favorites:v1"
const CHANGED = "opencode-ui:model-favorites-changed"

export function modelFavoritesKey(origin: string): string {
  return `${PREFIX}:${encodeURIComponent(origin)}`
}

export function parseModelFavorites(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((item): item is string => typeof item === "string"))]
  } catch {
    return []
  }
}

export function readModelFavorites(storage: Pick<Storage, "getItem">, origin: string): string[] {
  try {
    return parseModelFavorites(storage.getItem(modelFavoritesKey(origin)))
  } catch {
    return []
  }
}

export function writeModelFavorites(
  storage: Pick<Storage, "setItem">,
  origin: string,
  values: readonly string[]
): boolean {
  try {
    storage.setItem(modelFavoritesKey(origin), JSON.stringify([...new Set(values)]))
    return true
  } catch {
    return false
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(CHANGED, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(CHANGED, callback)
  }
}

/** Browser-local starred models, shared by every picker on this origin. */
export function useModelFavorites() {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(modelFavoritesKey(origin)) ?? ""
      } catch {
        return ""
      }
    },
    () => ""
  )
  const favorites = useMemo(() => new Set(parseModelFavorites(raw)), [raw])
  const toggle = useCallback(
    (value: string) => {
      const current = new Set(readModelFavorites(window.localStorage, origin))
      if (current.has(value)) current.delete(value)
      else current.add(value)
      writeModelFavorites(window.localStorage, origin, [...current])
      window.dispatchEvent(new Event(CHANGED))
    },
    [origin]
  )
  return { favorites, toggle }
}
