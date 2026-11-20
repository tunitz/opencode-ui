/**
 * Small TTL + in-flight-dedupe cache for engine catalog reads. Navigation and
 * selectors open the same directories repeatedly; caching keeps those surfaces
 * instant without changing native state.
 *
 * Reads use stale-while-revalidate: a cached value is served immediately even
 * after its TTL, while a background refresh keeps future reads current. A
 * single in-flight refresh is shared by every caller for the same key.
 */
type Entry<T> = { at: number; value?: T; promise?: Promise<T> }

export type AsyncCache<T> = {
  get(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T>
  peek(key: string): T | undefined
  invalidate(key?: string): void
}

const MAX_CACHE_ENTRIES = 100

export function createAsyncCache<T>(defaultTtlMs = 60_000): AsyncCache<T> {
  const entries = new Map<string, Entry<T>>()

  const setBounded = (key: string, entry: Entry<T>) => {
    if (entries.has(key)) entries.delete(key)
    entries.set(key, entry)
    while (entries.size > MAX_CACHE_ENTRIES) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  // Start one refresh and share it with every concurrent caller. A stale value
  // (when present) stays in the entry so `peek` and later reads can still use
  // it; a failed refresh evicts the entry instead of caching the error.
  const revalidate = (key: string, load: () => Promise<T>): Promise<T> => {
    const promise = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          // Guard against writing stale results if invalidated while in flight.
          if (entries.get(key)?.promise === promise) {
            setBounded(key, { at: Date.now(), value })
          }
          return value
        },
        (error) => {
          if (entries.get(key)?.promise === promise) entries.delete(key)
          throw error
        }
      )
    const previous = entries.get(key)
    setBounded(key, {
      at: previous?.at ?? Date.now(),
      value: previous?.value,
      promise,
    })
    return promise
  }

  return {
    get(key, load, ttlMs = defaultTtlMs) {
      const current = entries.get(key)
      if (current?.promise) return current.promise

      if (current && current.value !== undefined) {
        if (Date.now() - current.at < ttlMs) {
          return Promise.resolve(current.value)
        }
        // Stale: hand back the old value without waiting and refresh in the
        // background. Later callers join the in-flight promise (dedupe) and
        // see the fresh value. Swallow the background rejection so a
        // fire-and-forget caller never produces an unhandled rejection.
        const refresh = revalidate(key, load)
        void refresh.catch(() => {})
        return Promise.resolve(current.value)
      }

      return revalidate(key, load)
    },
    peek(key) {
      return entries.get(key)?.value
    },
    invalidate(key) {
      if (key === undefined) entries.clear()
      else entries.delete(key)
    },
  }
}
