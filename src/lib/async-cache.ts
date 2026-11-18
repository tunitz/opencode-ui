/**
 * Small TTL + in-flight-dedupe cache for engine catalog reads. Navigation and
 * selectors open the same directories repeatedly; caching keeps those surfaces
 * instant without changing native state.
 */
type Entry<T> = { at: number; value?: T; promise?: Promise<T> }

export type AsyncCache<T> = {
  get(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T>
  peek(key: string): T | undefined
  invalidate(key?: string): void
}

export function createAsyncCache<T>(defaultTtlMs = 60_000): AsyncCache<T> {
  const entries = new Map<string, Entry<T>>()

  return {
    async get(key, load, ttlMs = defaultTtlMs) {
      const now = Date.now()
      const current = entries.get(key)
      if (current?.promise) return current.promise
      if (current && current.value !== undefined && now - current.at < ttlMs) {
        return current.value
      }

      const promise = load().then(
        (value) => {
          entries.set(key, { at: Date.now(), value })
          return value
        },
        (error) => {
          if (entries.get(key)?.promise === promise) entries.delete(key)
          throw error
        }
      )
      entries.set(key, {
        at: now,
        value: current?.value,
        promise,
      })
      return promise
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
