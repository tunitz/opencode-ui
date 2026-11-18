import { readdir, readFile, stat, unlink } from "node:fs/promises"
import { open } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  atomicWriteFile,
  ensureDir,
  invalidID,
  readJsonFile,
  resolveDataDir,
  safeSegment,
} from "./fs-utils.js"
import {
  MAX_HISTORY_SNAPSHOTS,
  NotesError,
  isNoteStatus,
  isRecord,
  type Note,
  type NoteAttachment,
  type NoteSnapshot,
  type Space,
} from "./types.js"

export function defaultCreateID(prefix: string): string {
  const value = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16)
  return `${prefix}_${value}`
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function parseRevision(value: unknown): number | undefined {
  const revision = value === undefined ? 0 : value
  if (!Number.isSafeInteger(revision) || (revision as number) < 0)
    return undefined
  return revision as number
}

/**
 * Parse a v2 space. v1 records used `{ kind, project }`; those are converted on
 * read: global or unlinked becomes `projectDir: null`, and a linked planning
 * space uses `project.canonical ?? project.directory ?? null`.
 */
export function parseSpace(value: unknown): Space | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || !value.id) return undefined
  if (typeof value.name !== "string" || !value.name) return undefined
  if (typeof value.pinned !== "boolean") return undefined
  if (!finiteNumber(value.createdAt) || !finiteNumber(value.updatedAt))
    return undefined
  const revision = parseRevision(value.revision)
  if (revision === undefined) return undefined

  let projectDir: string | null
  if (Object.prototype.hasOwnProperty.call(value, "projectDir")) {
    if (value.projectDir === null) projectDir = null
    else if (typeof value.projectDir === "string" && value.projectDir.trim())
      projectDir = value.projectDir
    else return undefined
  } else if (value.kind === "global") {
    projectDir = null
  } else if (isRecord(value.project)) {
    projectDir =
      typeof value.project.canonical === "string" && value.project.canonical
        ? value.project.canonical
        : typeof value.project.directory === "string" && value.project.directory
          ? value.project.directory
          : null
  } else {
    projectDir = null
  }

  return {
    id: value.id,
    name: value.name,
    projectDir,
    pinned: value.pinned,
    revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function parseAttachment(value: unknown): NoteAttachment | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || !value.id) return undefined
  if (typeof value.name !== "string" || !value.name) return undefined
  if (typeof value.mime !== "string") return undefined
  if (!finiteNumber(value.size) || value.size < 0) return undefined
  if (!finiteNumber(value.createdAt)) return undefined
  return {
    id: value.id,
    name: value.name,
    mime: value.mime,
    size: value.size,
    createdAt: value.createdAt,
  }
}

function parseAttachments(value: unknown): NoteAttachment[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseAttachment)
    .filter((attachment): attachment is NoteAttachment => attachment !== undefined)
}

export function parseNote(value: unknown): Note | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || !value.id) return undefined
  if (
    value.spaceID !== null &&
    (typeof value.spaceID !== "string" || !value.spaceID)
  )
    return undefined
  if (typeof value.title !== "string" || !value.title) return undefined
  if (typeof value.body !== "string") return undefined
  if (!isNoteStatus(value.status)) return undefined
  if (typeof value.pinned !== "boolean") return undefined
  if (!finiteNumber(value.createdAt) || !finiteNumber(value.updatedAt))
    return undefined
  const revision = parseRevision(value.revision)
  if (revision === undefined) return undefined
  const statusUpdatedAt = finiteNumber(value.statusUpdatedAt)
    ? value.statusUpdatedAt
    : undefined
  return {
    id: value.id,
    spaceID: value.spaceID,
    title: value.title,
    body: value.body,
    status: value.status,
    pinned: value.pinned,
    attachments: parseAttachments(value.attachments),
    revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(statusUpdatedAt === undefined ? {} : { statusUpdatedAt }),
  }
}

export function parseSnapshot(value: unknown): NoteSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (isRecord(value.note)) {
    const note = parseNote(value.note)
    if (!note || !finiteNumber(value.savedAt)) return undefined
    return { note, savedAt: value.savedAt }
  }
  // Tolerate a flattened snapshot written by hand or by an older build.
  const note = parseNote(value)
  if (!note) return undefined
  return { note, savedAt: finiteNumber(value.savedAt) ? value.savedAt : note.updatedAt }
}

export function compareNotes(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
}

function compareSnapshotsNewestFirst(a: NoteSnapshot, b: NoteSnapshot): number {
  return (
    b.savedAt - a.savedAt ||
    b.note.revision - a.note.revision ||
    a.note.id.localeCompare(b.note.id)
  )
}

/**
 * Store abstraction used by the service. `transaction(scope, operation)`
 * serializes read-modify-write work for one record. The file implementation
 * holds a cross-process lock; the memory implementation holds an in-process
 * promise lock.
 */
export interface NotesStore {
  readonly dataDir?: string
  now(): number
  createID(prefix: string): string
  transaction<T>(scope: string, operation: () => Promise<T>): Promise<T>
  getNote(noteID: string): Promise<Note | undefined>
  listNotes(): Promise<Note[]>
  putNote(note: Note): Promise<void>
  removeNote(noteID: string): Promise<void>
  getSpace(spaceID: string): Promise<Space | undefined>
  listSpaces(): Promise<Space[]>
  putSpace(space: Space): Promise<void>
  removeSpace(spaceID: string): Promise<void>
  getAttachment(attachmentID: string): Promise<Uint8Array | undefined>
  putAttachment(attachmentID: string, data: Uint8Array): Promise<void>
  removeAttachment(attachmentID: string): Promise<void>
  listSnapshots(noteID: string): Promise<NoteSnapshot[]>
  putSnapshot(snapshot: NoteSnapshot): Promise<void>
}

const LOCK_ATTEMPTS = 40
const LOCK_RETRY_MS = 50
const LOCK_STALE_MS = 5_000

interface ErrorCode {
  readonly code?: string
}

function isExistsError(error: unknown): boolean {
  return (error as ErrorCode | undefined)?.code === "EEXIST"
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as ErrorCode | undefined)?.code !== "ENOENT") throw error
  }
}

async function readRecordDir<T>(
  dir: string,
  parse: (value: unknown) => T | undefined
): Promise<T[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const records: T[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const parsed = parse(await readJsonFile(join(dir, name)))
    if (parsed !== undefined) records.push(parsed)
  }
  return records
}

export interface FileNotesStoreOptions {
  readonly dataDir?: string
  readonly now?: () => number
  readonly createID?: (prefix: string) => string
}

/** File-backed store under the data directory. */
export class FileNotesStore implements NotesStore {
  readonly dataDir: string
  readonly notesDir: string
  readonly spacesDir: string
  readonly attachmentsDir: string
  readonly historyDir: string
  readonly now: () => number
  readonly createID: (prefix: string) => string

  constructor(options: FileNotesStoreOptions = {}) {
    this.dataDir = options.dataDir ?? resolveDataDir()
    this.notesDir = join(this.dataDir, "notes")
    this.spacesDir = join(this.dataDir, "spaces")
    this.attachmentsDir = join(this.dataDir, "attachments")
    this.historyDir = join(this.dataDir, "history")
    this.now = options.now ?? Date.now
    this.createID = options.createID ?? defaultCreateID
  }

  private notePath(noteID: string): string | undefined {
    const segment = safeSegment(noteID)
    return segment === undefined ? undefined : join(this.notesDir, `${segment}.json`)
  }

  private spacePath(spaceID: string): string | undefined {
    const segment = safeSegment(spaceID)
    return segment === undefined
      ? undefined
      : join(this.spacesDir, `${segment}.json`)
  }

  private attachmentPath(attachmentID: string): string | undefined {
    const segment = safeSegment(attachmentID)
    return segment === undefined
      ? undefined
      : join(this.attachmentsDir, segment)
  }

  private historyPath(noteID: string): string | undefined {
    const segment = safeSegment(noteID)
    return segment === undefined ? undefined : join(this.historyDir, segment)
  }

  private lockPath(scope: string): string {
    const separator = scope.indexOf(":")
    const kind = separator === -1 ? scope : scope.slice(0, separator)
    const id = separator === -1 ? "" : scope.slice(separator + 1)
    const segment = safeSegment(id)
    if (segment === undefined) invalidID("id")
    if (kind === "note") return join(this.notesDir, `${segment}.json.lock`)
    if (kind === "space") return join(this.spacesDir, `${segment}.json.lock`)
    invalidID("scope")
  }

  private async withLock<T>(
    lockPath: string,
    operation: () => Promise<T>
  ): Promise<T> {
    await ensureDir(dirname(lockPath))
    // A unique owner tag prevents a timed-out holder from deleting a newer
    // holder's lock in its finally block.
    const owner = `${process.pid}:${globalThis.crypto.randomUUID()}`
    let acquired = false
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      try {
        const handle = await open(lockPath, "wx", 0o600)
        try {
          await handle.writeFile(`${owner}\n`)
        } finally {
          await handle.close()
        }
        acquired = true
        break
      } catch (error) {
        if (!isExistsError(error)) throw error
        try {
          const info = await stat(lockPath)
          if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
            await unlink(lockPath).catch(() => undefined)
            continue
          }
        } catch {
          // The lock disappeared between the open and stat calls; retry.
        }
        await sleep(LOCK_RETRY_MS)
      }
    }
    if (!acquired) {
      throw new NotesError(
        "invalid",
        "Timed out waiting for the notes record lock",
        { field: "lock" }
      )
    }
    try {
      return await operation()
    } finally {
      const current = await readFile(lockPath, "utf8").catch(() => null)
      if (current?.trim() === owner) {
        await unlink(lockPath).catch(() => undefined)
      }
    }
  }

  async transaction<T>(
    scope: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.withLock(this.lockPath(scope), operation)
  }

  async getNote(noteID: string): Promise<Note | undefined> {
    const path = this.notePath(noteID)
    return path === undefined ? undefined : parseNote(await readJsonFile(path))
  }

  async listNotes(): Promise<Note[]> {
    return readRecordDir(this.notesDir, parseNote)
  }

  async putNote(note: Note): Promise<void> {
    const path = this.notePath(note.id)
    if (path === undefined) invalidID("noteID")
    await atomicWriteFile(path, JSON.stringify(note))
  }

  async removeNote(noteID: string): Promise<void> {
    const path = this.notePath(noteID)
    if (path === undefined) return
    await unlinkIfExists(path)
  }

  async getSpace(spaceID: string): Promise<Space | undefined> {
    const path = this.spacePath(spaceID)
    return path === undefined ? undefined : parseSpace(await readJsonFile(path))
  }

  async listSpaces(): Promise<Space[]> {
    return readRecordDir(this.spacesDir, parseSpace)
  }

  async putSpace(space: Space): Promise<void> {
    const path = this.spacePath(space.id)
    if (path === undefined) invalidID("spaceID")
    await atomicWriteFile(path, JSON.stringify(space))
  }

  async removeSpace(spaceID: string): Promise<void> {
    const path = this.spacePath(spaceID)
    if (path === undefined) return
    await unlinkIfExists(path)
  }

  async getAttachment(attachmentID: string): Promise<Uint8Array | undefined> {
    const path = this.attachmentPath(attachmentID)
    if (path === undefined) return undefined
    try {
      return new Uint8Array(await readFile(path))
    } catch {
      return undefined
    }
  }

  async putAttachment(
    attachmentID: string,
    data: Uint8Array
  ): Promise<void> {
    const path = this.attachmentPath(attachmentID)
    if (path === undefined) invalidID("attachmentID")
    await atomicWriteFile(path, data)
  }

  async removeAttachment(attachmentID: string): Promise<void> {
    const path = this.attachmentPath(attachmentID)
    if (path === undefined) return
    await unlinkIfExists(path)
  }

  private async snapshotEntries(
    noteID: string
  ): Promise<Array<{ name: string; snapshot: NoteSnapshot }>> {
    const dir = this.historyPath(noteID)
    if (dir === undefined) return []
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const entries: Array<{ name: string; snapshot: NoteSnapshot }> = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const snapshot = parseSnapshot(await readJsonFile(join(dir, name)))
      if (snapshot !== undefined) entries.push({ name, snapshot })
    }
    return entries.sort((a, b) =>
      compareSnapshotsNewestFirst(a.snapshot, b.snapshot)
    )
  }

  async listSnapshots(noteID: string): Promise<NoteSnapshot[]> {
    return (await this.snapshotEntries(noteID)).map((entry) => entry.snapshot)
  }

  async putSnapshot(snapshot: NoteSnapshot): Promise<void> {
    const dir = this.historyPath(snapshot.note.id)
    if (dir === undefined) invalidID("noteID")
    await ensureDir(dir)
    const base = `${snapshot.note.revision}-${snapshot.savedAt}`
    let path = join(dir, `${base}.json`)
    for (let suffix = 1; ; suffix++) {
      try {
        await stat(path)
        path = join(dir, `${base}-${suffix}.json`)
      } catch {
        break
      }
    }
    await atomicWriteFile(path, JSON.stringify(snapshot))
    const entries = await this.snapshotEntries(snapshot.note.id)
    for (const stale of entries.slice(MAX_HISTORY_SNAPSHOTS)) {
      await unlink(join(dir, stale.name)).catch(() => undefined)
    }
  }
}

/** In-process store for tests and embedding without touching the filesystem. */
export class MemoryNotesStore implements NotesStore {
  readonly dataDir = undefined
  readonly now: () => number
  readonly createID: (prefix: string) => string
  private readonly notes = new Map<string, Note>()
  private readonly spaces = new Map<string, Space>()
  private readonly attachments = new Map<string, Uint8Array>()
  private readonly snapshots = new Map<string, NoteSnapshot[]>()
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    options: { now?: () => number; createID?: (prefix: string) => string } = {}
  ) {
    this.now = options.now ?? Date.now
    this.createID = options.createID ?? defaultCreateID
  }

  async transaction<T>(
    scope: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(scope) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    this.locks.set(scope, settled)
    void settled.then(() => {
      if (this.locks.get(scope) === settled) this.locks.delete(scope)
    })
    return run
  }

  async getNote(noteID: string): Promise<Note | undefined> {
    const note = this.notes.get(noteID)
    return note === undefined ? undefined : structuredClone(note)
  }

  async listNotes(): Promise<Note[]> {
    return [...this.notes.values()].map((note) => structuredClone(note))
  }

  async putNote(note: Note): Promise<void> {
    this.notes.set(note.id, structuredClone(note))
  }

  async removeNote(noteID: string): Promise<void> {
    this.notes.delete(noteID)
  }

  async getSpace(spaceID: string): Promise<Space | undefined> {
    const space = this.spaces.get(spaceID)
    return space === undefined ? undefined : structuredClone(space)
  }

  async listSpaces(): Promise<Space[]> {
    return [...this.spaces.values()].map((space) => structuredClone(space))
  }

  async putSpace(space: Space): Promise<void> {
    this.spaces.set(space.id, structuredClone(space))
  }

  async removeSpace(spaceID: string): Promise<void> {
    this.spaces.delete(spaceID)
  }

  async getAttachment(attachmentID: string): Promise<Uint8Array | undefined> {
    const data = this.attachments.get(attachmentID)
    return data === undefined ? undefined : new Uint8Array(data)
  }

  async putAttachment(
    attachmentID: string,
    data: Uint8Array
  ): Promise<void> {
    this.attachments.set(attachmentID, new Uint8Array(data))
  }

  async removeAttachment(attachmentID: string): Promise<void> {
    this.attachments.delete(attachmentID)
  }

  async listSnapshots(noteID: string): Promise<NoteSnapshot[]> {
    return (this.snapshots.get(noteID) ?? [])
      .map((snapshot) => structuredClone(snapshot))
      .sort(compareSnapshotsNewestFirst)
  }

  async putSnapshot(snapshot: NoteSnapshot): Promise<void> {
    const list = this.snapshots.get(snapshot.note.id) ?? []
    list.push(structuredClone(snapshot))
    list.sort(compareSnapshotsNewestFirst)
    if (list.length > MAX_HISTORY_SNAPSHOTS) {
      list.splice(MAX_HISTORY_SNAPSHOTS)
    }
    this.snapshots.set(snapshot.note.id, list)
  }
}
