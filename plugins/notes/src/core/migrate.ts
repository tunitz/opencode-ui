import { existsSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { atomicWriteFile, ensureDir, readJsonFile, resolveEngineDbPath } from "../fs-utils.js"
import { parseNote, parseSpace, type NotesStore } from "../store.js"
import { isRecord, type Note, type Space } from "../types.js"

export const MIGRATION_FILE = "migrated.json"
const LEGACY_KEY =
  /^plugin:[^:]+:opencode-notes\/v1\/(note|space|attachment)\/(.+)$/
const LEGACY_SCAN = "plugin:%:opencode-notes/v1/%"

export interface MigrationMarker {
  readonly at: number
  readonly notes: number
  readonly spaces: number
  readonly attachments: number
}

export interface MigrationOptions {
  readonly store: NotesStore
  readonly dataDir?: string
  readonly engineDbPath?: string
  readonly now?: () => number
}

export function migrationMarkerPath(dataDir: string): string {
  return join(dataDir, MIGRATION_FILE)
}

export async function readMigrationMarker(
  dataDir: string
): Promise<MigrationMarker | undefined> {
  const value = await readJsonFile(migrationMarkerPath(dataDir))
  if (!isRecord(value)) return undefined
  const at = value.at
  if (typeof at !== "number" || !Number.isFinite(at)) return undefined
  return {
    at,
    notes: typeof value.notes === "number" ? value.notes : 0,
    spaces: typeof value.spaces === "number" ? value.spaces : 0,
    attachments:
      typeof value.attachments === "number" ? value.attachments : 0,
  }
}

async function writeMarker(
  dataDir: string,
  marker: MigrationMarker
): Promise<void> {
  await ensureDir(dataDir)
  await atomicWriteFile(
    migrationMarkerPath(dataDir),
    JSON.stringify(marker, null, 2)
  )
}

interface KvRow {
  readonly key: string
  readonly value: unknown
}

function decodeValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (value instanceof Uint8Array) {
    try {
      return JSON.parse(new TextDecoder().decode(value))
    } catch {
      return undefined
    }
  }
  return undefined
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return undefined
  }
}

/**
 * One-time import from the engine SQLite `kv` table. The database is opened
 * read-only and is never written. Imported IDs that already exist in the new
 * store are skipped, so the operation is idempotent and safe to retry.
 */
export async function migrateEngineData(
  options: MigrationOptions
): Promise<MigrationMarker | undefined> {
  const dataDir = options.dataDir ?? options.store.dataDir
  if (!dataDir) return undefined
  if (await readMigrationMarker(dataDir)) return undefined

  const engineDbPath = options.engineDbPath ?? resolveEngineDbPath()
  const now = options.now ?? (() => Date.now())
  let notes = 0
  let spaces = 0
  let attachments = 0

  if (existsSync(engineDbPath)) {
    let database: Database | undefined
    try {
      database = new Database(engineDbPath, { readonly: true })
      const rows = database
        .query(`SELECT key, value FROM kv WHERE key LIKE ?`)
        .all(LEGACY_SCAN) as KvRow[]
      for (const row of rows) {
        const match = LEGACY_KEY.exec(row.key)
        if (!match) continue
        const kind = match[1]
        const id = match[2]
        if (!id) continue
        const value = decodeValue(row.value)
        if (value === undefined) continue
        if (kind === "space") {
          const space: Space | undefined = parseSpace(value)
          if (!space || space.id !== id) continue
          if (await options.store.getSpace(id)) continue
          await options.store.putSpace(space)
          spaces++
          continue
        }
        if (kind === "note") {
          const note: Note | undefined = parseNote(value)
          if (!note || note.id !== id) continue
          if (await options.store.getNote(id)) continue
          await options.store.putNote(note)
          notes++
          continue
        }
        if (!isRecord(value) || typeof value.data !== "string") continue
        const bytes = decodeBase64(value.data)
        if (!bytes) continue
        if (await options.store.getAttachment(id)) continue
        await options.store.putAttachment(id, bytes)
        attachments++
      }
    } catch {
      // A corrupt or locked engine database must never block local notes.
    } finally {
      try {
        database?.close()
      } catch {
        // Ignore close failures.
      }
    }
  }

  const marker: MigrationMarker = { at: now(), notes, spaces, attachments }
  await writeMarker(dataDir, marker)
  return marker
}
