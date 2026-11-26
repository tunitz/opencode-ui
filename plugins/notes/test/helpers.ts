import { MemoryNotesStore } from "../src/store.js"
import { createNotesService, type NotesServiceOptions } from "../src/index.js"

export function seededClock(start = 1_000): () => number {
  let current = start
  return () => current++
}

export function seededIDs(): (prefix: string) => string {
  let current = 0
  return (prefix) => `${prefix}_${++current}`
}

export interface TestServiceOptions
  extends Pick<NotesServiceOptions, "onChange"> {
  readonly now?: () => number
  readonly createID?: (prefix: string) => string
}

export function makeService(options: TestServiceOptions = {}) {
  const now = options.now ?? seededClock()
  const createID = options.createID ?? seededIDs()
  const store = new MemoryNotesStore({ now, createID })
  const events: Array<{ entity: string; action: string; id: string }> = []
  const service = createNotesService({
    store,
    now,
    createID,
    onChange: (event) => {
      events.push(event)
      options.onChange?.(event)
    },
  })
  return { service, store, events }
}

/** Build a valid base64 string whose decoded length is exactly `size` bytes. */
export function base64OfSize(size: number): string {
  if (size <= 0) return ""
  const padding = (3 - (size % 3)) % 3
  const length = Math.ceil(size / 3) * 4
  return "A".repeat(length - padding) + "=".repeat(padding)
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
