const LAST_OPENED_PREFIX = "opencode-ui:last-opened:v1"

export type LastOpenedScope =
  | { kind: "project"; projectID: string; directory: string }
  | { kind: "all" }

type StorageLike = Pick<Storage, "getItem" | "setItem">

export function lastOpenedStorageKey(origin: string, backendVersion: string) {
  return `${LAST_OPENED_PREFIX}:${encodeURIComponent(origin)}:${encodeURIComponent(backendVersion)}`
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
      JSON.stringify(scope)
    )
    return true
  } catch {
    return false
  }
}
