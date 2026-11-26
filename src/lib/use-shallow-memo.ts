import { useMemo } from "react"

/**
 * Returns a stable object identity while all of its own values are referentially
 * equal. The controller objects are rebuilt every render from state and stable
 * callbacks; this lets memoized consumers skip unrelated updates.
 *
 * The caller must keep the same key set on every render (these are fixed
 * object literals), so the dependency array length never changes.
 */
export function useShallowMemo<T extends object>(value: T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  return useMemo(() => value, [...Object.values(value)])
}
