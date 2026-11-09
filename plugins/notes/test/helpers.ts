import type { NotesStorage, StoragePage } from "../src/types.js"

export class MemoryStorage implements NotesStorage {
  readonly values = new Map<string, unknown>()

  async get(key: string): Promise<unknown> {
    const value = this.values.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }

  async scan(options: {
    prefix: string
    after?: string
    limit?: number
  }): Promise<StoragePage> {
    const limit = options.limit ?? 100
    const keys = [...this.values.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .sort((a, b) => a.localeCompare(b))
    const start = options.after
      ? keys.findIndex((key) => key > options.after!)
      : 0
    const from = start < 0 ? keys.length : start
    const selected = keys.slice(from, from + limit)
    const entries = selected.map((key) => ({
      key,
      value: structuredClone(this.values.get(key)),
    }))
    const next =
      from + limit < keys.length ? selected[selected.length - 1] : undefined
    return next ? { entries, next } : { entries }
  }
}

export function seededClock(start = 1_000): () => number {
  let current = start
  return () => current++
}

export function seededIDs(): (prefix: string) => string {
  let current = 0
  return (prefix) => `${prefix}_${++current}`
}
