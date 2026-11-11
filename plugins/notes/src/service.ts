import { migrateEngineData } from "./core/migrate.js"
import { resolveDataDir } from "./fs-utils.js"
import {
  FileNotesStore,
  compareNotes,
  type NotesStore,
} from "./store.js"
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  LIMITS,
  MAX_HISTORY_SNAPSHOTS,
  NotesError,
  isNoteStatus,
  type ChangeEvent,
  type ChangeEntity,
  type CreateAttachmentInput,
  type CreateNoteInput,
  type CreateSpaceInput,
  type DeleteAttachmentInput,
  type DeleteAttachmentOutput,
  type DeleteNoteInput,
  type DeleteNoteOutput,
  type DeleteSpaceInput,
  type DeleteSpaceOutput,
  type GetNoteInput,
  type HistoryInput,
  type HistoryOutput,
  type ListInput,
  type ListOutput,
  type Note,
  type NoteAttachment,
  type NoteSnapshot,
  type NoteStatus,
  type ReadAttachmentInput,
  type ReadAttachmentOutput,
  type RestoreInput,
  type RestoreOutput,
  type SearchInput,
  type SearchOutput,
  type SearchResult,
  type Space,
  type SpacesInput,
  type SpacesOutput,
  type UpdateNoteInput,
  type UpdateSpaceInput,
} from "./types.js"

function invalid(field: string, message: string): never {
  throw new NotesError("invalid", message, { field, message })
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field, `${field} must be a string`)
  const text = value.trim()
  if (!text) invalid(field, `${field} must not be empty`)
  if (text.length > max)
    invalid(field, `${field} must be at most ${max} characters`)
  return text
}

function optionalText(
  value: unknown,
  field: string,
  max: number
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") invalid(field, `${field} must be a string`)
  if (value.length > max)
    invalid(field, `${field} must be at most ${max} characters`)
  return value
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") invalid(field, `${field} must be a boolean`)
  return value
}

function optionalStatus(value: unknown): NoteStatus | undefined {
  if (value === undefined) return undefined
  if (!isNoteStatus(value))
    invalid("status", "status must be one of the seven note statuses")
  return value
}

function optionalStatuses(value: unknown): NoteStatus[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) invalid("statuses", "statuses must be an array")
  const statuses: NoteStatus[] = []
  for (const item of value) {
    if (!isNoteStatus(item))
      invalid("statuses", "statuses must contain only note statuses")
    statuses.push(item)
  }
  return statuses
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(
      "expectedRevision",
      "expectedRevision must be a non-negative integer"
    )
  }
  return value as number
}

function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid("revision", "revision must be a non-negative integer")
  }
  return value as number
}

function optionalDirectory(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") invalid("directory", "directory must be a string")
  const text = value.trim()
  if (!text) return undefined
  if (text.length > LIMITS.path)
    invalid("directory", "directory is too long")
  return text
}

function projectDirectory(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== "string")
    invalid("projectDir", "projectDir must be a string or null")
  const text = value.trim()
  if (!text) return null
  if (text.length > LIMITS.path)
    invalid("projectDir", "projectDir is too long")
  return text
}

const MIME_SHAPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i

const BASE64_SHAPE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Inline-active types are refused; attachments are downloadable data, not a document surface. */
const ACTIVE_MIME_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
])

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function attachmentName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "name must be a string")
  const name = value.trim()
  if (!name) invalid("name", "name must not be empty")
  if (name.length > LIMITS.attachmentName)
    invalid(
      "name",
      `name must be at most ${LIMITS.attachmentName} characters`
    )
  if (hasControlCharacters(name))
    invalid("name", "name must not contain control characters")
  return name
}

function attachmentMime(value: unknown): string {
  if (typeof value !== "string") invalid("mime", "mime must be a string")
  const mime = (value.split(";")[0] ?? "").trim().toLowerCase()
  if (!mime) invalid("mime", "mime must not be empty")
  if (mime.length > LIMITS.attachmentMime)
    invalid(
      "mime",
      `mime must be at most ${LIMITS.attachmentMime} characters`
    )
  if (!MIME_SHAPE.test(mime))
    invalid("mime", "mime must be a type/subtype such as image/png")
  if (ACTIVE_MIME_TYPES.has(mime) || mime.endsWith("/javascript")) {
    throw new NotesError(
      "mime_rejected",
      "Active content types are not allowed",
      { field: "mime", mime }
    )
  }
  return mime
}

function attachmentData(
  value: unknown,
  noteID: string,
  attachmentCount: number
): { data: string; size: number } {
  if (typeof value !== "string" || !value)
    invalid("data", "data must be a non-empty base64 string")
  if (value.length % 4 !== 0 || !BASE64_SHAPE.test(value))
    invalid("data", "data must be valid base64")
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const size = (value.length / 4) * 3 - padding
  if (size <= 0) invalid("data", "data must not be empty")
  if (size > LIMITS.attachmentFileSize) {
    throw new NotesError(
      "limit_exceeded",
      `Attachments must be at most ${LIMITS.attachmentFileSize} bytes`,
      { noteID, attachmentCount, size, limit: LIMITS.attachmentFileSize }
    )
  }
  return { data: value, size }
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function checkRevision(
  entity: ChangeEntity,
  id: string,
  expectedRevision: number | undefined,
  revision: number
): void {
  if (expectedRevision === undefined || expectedRevision === revision) return
  throw new NotesError("revision_conflict", "Revision conflict", {
    entity,
    id,
    expectedRevision,
    revision,
  })
}

function matchesDirectory(
  projectDir: string | null,
  directory: string | undefined,
  includeGlobal: boolean | undefined
): boolean {
  if (!directory) return true
  if (projectDir === null) return includeGlobal !== false
  return projectDir === directory
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index)
    if (found === -1) break
    count++
    index = found + needle.length
  }
  return count
}

function buildSnippet(
  collapsedBody: string,
  collapsedLowerBody: string,
  lowerQuery: string
): string {
  const index = collapsedLowerBody.indexOf(lowerQuery)
  if (index === -1) return ""
  const start = Math.max(0, index - 80)
  const end = Math.min(
    collapsedBody.length,
    index + lowerQuery.length + 80
  )
  return `${start > 0 ? "…" : ""}${collapsedBody.slice(start, end)}${
    end < collapsedBody.length ? "…" : ""
  }`
}

function compareSpaces(a: Space, b: Space): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.projectDir !== b.projectDir) {
    if (a.projectDir === null) return -1
    if (b.projectDir === null) return 1
    const byDirectory = a.projectDir.localeCompare(b.projectDir)
    if (byDirectory !== 0) return byDirectory
  }
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

export interface NotesServiceOptions {
  /** Inject a store (tests). When omitted a file store is created. */
  readonly store?: NotesStore
  /** File-store root; ignored when `store` is supplied. */
  readonly dataDir?: string
  readonly now?: () => number
  readonly createID?: (prefix: string) => string
  readonly onChange?: (event: ChangeEvent) => void
  /** Defaults to true for the built-in file store, false for an injected store. */
  readonly migrate?: boolean
  readonly engineDbPath?: string
}

export class NotesService {
  readonly store: NotesStore
  private readonly options: NotesServiceOptions
  private readonly migrationEnabled: boolean
  private migration?: Promise<void>

  constructor(options: NotesServiceOptions = {}) {
    const store =
      options.store ??
      new FileNotesStore({
        dataDir: options.dataDir ?? resolveDataDir(),
        now: options.now,
        createID: options.createID,
      })
    this.store = store
    this.options = options
    this.migrationEnabled = options.migrate ?? this.store.dataDir !== undefined
  }

  /**
   * Lazily imports engine-kv data before the first operation. Safe to call
   * repeatedly; the marker file makes the migration idempotent.
   */
  ready(): Promise<void> {
    this.migration ??= this.runMigration()
    return this.migration
  }

  private async runMigration(): Promise<void> {
    if (!this.migrationEnabled) return
    try {
      await migrateEngineData({
        store: this.store,
        dataDir: this.store.dataDir,
        engineDbPath: this.options.engineDbPath,
      })
    } catch {
      // A failed import must not take the whole notes store offline.
    }
  }

  private emit(event: ChangeEvent): void {
    try {
      this.options.onChange?.(event)
    } catch {
      // Observers must not break a committed write.
    }
  }

  private async requireSpace(spaceID: string): Promise<Space> {
    const space = await this.store.getSpace(spaceID)
    if (!space)
      throw new NotesError("space_not_found", "Space not found", { spaceID })
    return space
  }

  private async snapshot(existing: Note, savedAt: number): Promise<void> {
    await this.store.putSnapshot({ note: existing, savedAt })
  }

  async list(input: ListInput = {}): Promise<ListOutput> {
    await this.ready()
    const status = optionalStatus(input.status)
    const statuses = optionalStatuses(input.statuses)
    const pinned = optionalBoolean(input.pinned, "pinned")
    const directory = optionalDirectory(input.directory)
    const includeGlobal = optionalBoolean(
      input.includeGlobal,
      "includeGlobal"
    )
    const query =
      typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
    if (query.length > LIMITS.query)
      invalid("query", `query must be at most ${LIMITS.query} characters`)
    const limit = input.limit === undefined ? DEFAULT_LIST_LIMIT : input.limit
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.list) {
      invalid("limit", `limit must be an integer between 1 and ${LIMITS.list}`)
    }
    const offset = input.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0)
      invalid("offset", "offset must be a non-negative integer")

    const [notes, spaces] = await Promise.all([
      this.store.listNotes(),
      this.store.listSpaces(),
    ])
    const spaceByID = new Map(spaces.map((space) => [space.id, space]))
    const filtered = notes.filter((note) => {
      if (input.spaceID !== undefined && note.spaceID !== input.spaceID)
        return false
      if (status && note.status !== status) return false
      if (statuses && !statuses.includes(note.status)) return false
      if (pinned !== undefined && note.pinned !== pinned) return false
      if (query && !`${note.title}\n${note.body}`.toLowerCase().includes(query))
        return false
      if (directory) {
        if (note.spaceID !== null) {
          const space = spaceByID.get(note.spaceID)
          if (!space) return false
          if (!matchesDirectory(space.projectDir, directory, includeGlobal))
            return false
        }
      }
      return true
    })
    filtered.sort(compareNotes)
    const page = filtered.slice(offset, offset + limit)
    return {
      notes:
        input.includeBodies === false
          ? page.map((note) => ({ ...note, body: "" }))
          : page,
      total: filtered.length,
    }
  }

  async get(input: GetNoteInput): Promise<Note> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const note = await this.store.getNote(noteID)
    if (!note)
      throw new NotesError("note_not_found", "Note not found", { noteID })
    return note
  }

  async create(input: CreateNoteInput): Promise<Note> {
    await this.ready()
    const spaceID =
      input.spaceID === undefined || input.spaceID === null
        ? null
        : requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const title = requiredText(input.title, "title", LIMITS.title)
    const body = optionalText(input.body, "body", LIMITS.body) ?? ""
    const status = optionalStatus(input.status) ?? "todo"
    const pinned = optionalBoolean(input.pinned, "pinned") ?? false
    const noteID = this.store.createID("note")
    const note = await this.store.transaction(`note:${noteID}`, async () => {
      if (spaceID !== null) await this.requireSpace(spaceID)
      const now = this.store.now()
      const created: Note = {
        id: noteID,
        spaceID,
        title,
        body,
        status,
        pinned,
        attachments: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
        statusUpdatedAt: now,
      }
      await this.store.putNote(created)
      return created
    })
    this.emit({ entity: "note", action: "created", id: note.id })
    return note
  }

  async update(input: UpdateNoteInput): Promise<Note> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const spaceID =
      input.spaceID === undefined
        ? undefined
        : input.spaceID === null
          ? null
          : requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const title =
      input.title === undefined
        ? undefined
        : requiredText(input.title, "title", LIMITS.title)
    const body = optionalText(input.body, "body", LIMITS.body)
    const status = optionalStatus(input.status)
    const pinned = optionalBoolean(input.pinned, "pinned")

    const result = await this.store.transaction(`note:${noteID}`, async () => {
      const existing = await this.store.getNote(noteID)
      if (!existing)
        throw new NotesError("note_not_found", "Note not found", { noteID })
      checkRevision("note", noteID, expectedRevision, existing.revision)
      if (spaceID !== undefined && spaceID !== null)
        await this.requireSpace(spaceID)
      const changed =
        (spaceID !== undefined && spaceID !== existing.spaceID) ||
        (title !== undefined && title !== existing.title) ||
        (body !== undefined && body !== existing.body) ||
        (status !== undefined && status !== existing.status) ||
        (pinned !== undefined && pinned !== existing.pinned)
      if (!changed) return { note: existing, changed: false }
      const now = this.store.now()
      const statusChanged = status !== undefined && status !== existing.status
      const next: Note = {
        ...existing,
        spaceID: spaceID === undefined ? existing.spaceID : spaceID,
        title: title ?? existing.title,
        body: body ?? existing.body,
        status: status ?? existing.status,
        pinned: pinned ?? existing.pinned,
        // Attachments change only through createAttachment/deleteAttachment.
        attachments: existing.attachments,
        revision: existing.revision + 1,
        updatedAt: now,
        ...(statusChanged
          ? { statusUpdatedAt: now }
          : existing.statusUpdatedAt === undefined
            ? {}
            : { statusUpdatedAt: existing.statusUpdatedAt }),
      }
      await this.snapshot(existing, now)
      await this.store.putNote(next)
      return { note: next, changed: true }
    })
    if (result.changed) {
      this.emit({ entity: "note", action: "updated", id: result.note.id })
    }
    return result.note
  }

  async delete(input: DeleteNoteInput): Promise<DeleteNoteOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const deleted = await this.store.transaction(
      `note:${noteID}`,
      async () => {
        const existing = await this.store.getNote(noteID)
        if (!existing) return false
        checkRevision("note", noteID, expectedRevision, existing.revision)
        await this.snapshot(existing, this.store.now())
        await this.store.removeNote(noteID)
        // Best-effort: a failed cleanup can leave orphaned attachment files,
        // but it must never resurrect or block the note deletion.
        for (const attachment of existing.attachments) {
          try {
            await this.store.removeAttachment(attachment.id)
          } catch {
            // Ignored: orphan cleanup is not part of the delete contract.
          }
        }
        return true
      }
    )
    if (deleted) this.emit({ entity: "note", action: "deleted", id: noteID })
    return { deleted }
  }

  async createAttachment(
    input: CreateAttachmentInput
  ): Promise<{ note: Note; attachment: NoteAttachment }> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const name = attachmentName(input.name)
    const mime = attachmentMime(input.mime)

    const result = await this.store.transaction(
      `note:${noteID}`,
      async () => {
        const existing = await this.store.getNote(noteID)
        if (!existing)
          throw new NotesError("note_not_found", "Note not found", { noteID })
        checkRevision("note", noteID, expectedRevision, existing.revision)
        const { data, size } = attachmentData(
          input.data,
          noteID,
          existing.attachments.length + 1
        )
        if (existing.attachments.length >= LIMITS.attachmentCount) {
          throw new NotesError(
            "limit_exceeded",
            `A note can have at most ${LIMITS.attachmentCount} attachments`,
            {
              noteID,
              attachmentCount: existing.attachments.length,
              size,
              limit: LIMITS.attachmentCount,
            }
          )
        }
        const total =
          existing.attachments.reduce(
            (sum, attachment) => sum + attachment.size,
            0
          ) + size
        if (total > LIMITS.attachmentTotalSize) {
          throw new NotesError(
            "limit_exceeded",
            `A note's attachments must total at most ${LIMITS.attachmentTotalSize} bytes`,
            {
              noteID,
              attachmentCount: existing.attachments.length + 1,
              size: total,
              limit: LIMITS.attachmentTotalSize,
            }
          )
        }

        const now = this.store.now()
        const attachment: NoteAttachment = {
          id: this.store.createID("attachment"),
          name,
          mime,
          size,
          createdAt: now,
        }
        await this.store.putAttachment(attachment.id, base64ToBytes(data))
        const note: Note = {
          ...existing,
          attachments: [...existing.attachments, attachment],
          revision: existing.revision + 1,
          updatedAt: now,
        }
        try {
          await this.snapshot(existing, now)
          await this.store.putNote(note)
        } catch (error) {
          try {
            await this.store.removeAttachment(attachment.id)
          } catch {
            // Ignored: the original write error is the useful one.
          }
          throw error
        }
        return { note, attachment }
      }
    )
    this.emit({ entity: "note", action: "updated", id: noteID })
    return result
  }

  async readAttachment(
    input: ReadAttachmentInput
  ): Promise<ReadAttachmentOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const attachmentID = requiredText(
      input.attachmentID,
      "attachmentID",
      LIMITS.projectID
    )
    const note = await this.store.getNote(noteID)
    if (!note)
      throw new NotesError("note_not_found", "Note not found", { noteID })
    const attachment = note.attachments.find(
      (candidate) => candidate.id === attachmentID
    )
    if (!attachment) {
      throw new NotesError("attachment_not_found", "Attachment not found", {
        noteID,
        attachmentID,
      })
    }
    const data = await this.store.getAttachment(attachmentID)
    if (data === undefined) {
      throw new NotesError("attachment_not_found", "Attachment data not found", {
        noteID,
        attachmentID,
      })
    }
    return { attachment, data: bytesToBase64(data) }
  }

  async deleteAttachment(
    input: DeleteAttachmentInput
  ): Promise<DeleteAttachmentOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const attachmentID = requiredText(
      input.attachmentID,
      "attachmentID",
      LIMITS.projectID
    )
    const expectedRevision = optionalRevision(input.expectedRevision)
    const note = await this.store.transaction(`note:${noteID}`, async () => {
      const existing = await this.store.getNote(noteID)
      if (!existing)
        throw new NotesError("note_not_found", "Note not found", { noteID })
      checkRevision("note", noteID, expectedRevision, existing.revision)
      const attachment = existing.attachments.find(
        (candidate) => candidate.id === attachmentID
      )
      if (!attachment) {
        throw new NotesError("attachment_not_found", "Attachment not found", {
          noteID,
          attachmentID,
        })
      }
      const now = this.store.now()
      const next: Note = {
        ...existing,
        attachments: existing.attachments.filter(
          (candidate) => candidate.id !== attachmentID
        ),
        revision: existing.revision + 1,
        updatedAt: now,
      }
      await this.snapshot(existing, now)
      await this.store.putNote(next)
      try {
        await this.store.removeAttachment(attachmentID)
      } catch {
        // Ignored: the note no longer references the bytes; an orphan may remain.
      }
      return next
    })
    this.emit({ entity: "note", action: "updated", id: note.id })
    return { note }
  }

  async spaces(input: SpacesInput = {}): Promise<SpacesOutput> {
    await this.ready()
    const directory = optionalDirectory(input.directory)
    const includeGlobal = optionalBoolean(
      input.includeGlobal,
      "includeGlobal"
    )
    const spaces = await this.store.listSpaces()
    const filtered = spaces.filter((space) =>
      matchesDirectory(space.projectDir, directory, includeGlobal)
    )
    filtered.sort(compareSpaces)
    return { spaces: filtered, total: filtered.length }
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    await this.ready()
    const name = requiredText(input.name, "name", LIMITS.name)
    const projectDir = projectDirectory(input.projectDir) ?? null
    const pinned = optionalBoolean(input.pinned, "pinned") ?? false
    const spaceID = this.store.createID("space")
    const space = await this.store.transaction(`space:${spaceID}`, async () => {
      const now = this.store.now()
      const created: Space = {
        id: spaceID,
        name,
        projectDir,
        pinned,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await this.store.putSpace(created)
      return created
    })
    this.emit({ entity: "space", action: "created", id: space.id })
    return space
  }

  async updateSpace(input: UpdateSpaceInput): Promise<Space> {
    await this.ready()
    const spaceID = requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const name =
      input.name === undefined
        ? undefined
        : requiredText(input.name, "name", LIMITS.name)
    const projectDir = projectDirectory(input.projectDir)
    const pinned = optionalBoolean(input.pinned, "pinned")
    const result = await this.store.transaction(`space:${spaceID}`, async () => {
      const existing = await this.store.getSpace(spaceID)
      if (!existing)
        throw new NotesError("space_not_found", "Space not found", { spaceID })
      checkRevision("space", spaceID, expectedRevision, existing.revision)
      const changed =
        (name !== undefined && name !== existing.name) ||
        (projectDir !== undefined && projectDir !== existing.projectDir) ||
        (pinned !== undefined && pinned !== existing.pinned)
      if (!changed) return { space: existing, changed: false }
      const next: Space = {
        ...existing,
        name: name ?? existing.name,
        projectDir: projectDir === undefined ? existing.projectDir : projectDir,
        pinned: pinned ?? existing.pinned,
        revision: existing.revision + 1,
        updatedAt: this.store.now(),
      }
      await this.store.putSpace(next)
      return { space: next, changed: true }
    })
    if (result.changed) {
      this.emit({ entity: "space", action: "updated", id: result.space.id })
    }
    return result.space
  }

  async deleteSpace(input: DeleteSpaceInput): Promise<DeleteSpaceOutput> {
    await this.ready()
    const spaceID = requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    // Accepted for wire compatibility, but never honored: there is no
    // cross-record transaction that could make a partial cascade safe.
    optionalBoolean(input.cascade, "cascade")
    const deleted = await this.store.transaction(
      `space:${spaceID}`,
      async () => {
        const existing = await this.store.getSpace(spaceID)
        if (!existing) return false
        // Check the version before inspecting or touching notes. A stale client
        // must not remove a space that changed since it listed it.
        checkRevision("space", spaceID, expectedRevision, existing.revision)
        const notes = (await this.store.listNotes()).filter(
          (note) => note.spaceID === spaceID
        )
        if (notes.length > 0) {
          throw new NotesError("space_not_empty", "Space still has notes", {
            spaceID,
            noteCount: notes.length,
          })
        }
        await this.store.removeSpace(spaceID)
        return true
      }
    )
    if (deleted) this.emit({ entity: "space", action: "deleted", id: spaceID })
    return { deleted, deletedNotes: 0 }
  }

  async search(input: SearchInput): Promise<SearchOutput> {
    await this.ready()
    const query = collapseWhitespace(
      requiredText(input.query, "query", LIMITS.query)
    )
    const lowerQuery = query.toLowerCase()
    const statuses = optionalStatuses(input.statuses)
    const pinned = optionalBoolean(input.pinned, "pinned")
    const directory = optionalDirectory(input.directory)
    const includeGlobal = optionalBoolean(
      input.includeGlobal,
      "includeGlobal"
    )
    const limit =
      input.limit === undefined ? DEFAULT_SEARCH_LIMIT : input.limit
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.list) {
      invalid("limit", `limit must be an integer between 1 and ${LIMITS.list}`)
    }
    const offset = input.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0)
      invalid("offset", "offset must be a non-negative integer")

    const [notes, spaces] = await Promise.all([
      this.store.listNotes(),
      this.store.listSpaces(),
    ])
    const spaceByID = new Map(spaces.map((space) => [space.id, space]))
    const results: SearchResult[] = []
    for (const note of notes) {
      if (input.spaceID !== undefined && note.spaceID !== input.spaceID)
        continue
      if (statuses && !statuses.includes(note.status)) continue
      if (pinned !== undefined && note.pinned !== pinned) continue
      if (directory && note.spaceID !== null) {
        const space = spaceByID.get(note.spaceID)
        if (!space) continue
        if (!matchesDirectory(space.projectDir, directory, includeGlobal))
          continue
      }
      const titleMatch = note.title.toLowerCase().includes(lowerQuery)
      const collapsedBody = collapseWhitespace(note.body)
      const lowerBody = collapsedBody.toLowerCase()
      const occurrences = countOccurrences(lowerBody, lowerQuery)
      if (!titleMatch && occurrences === 0) continue
      const score = (titleMatch ? 100 : 0) + Math.min(occurrences, 5) * 10
      results.push({
        note: { ...note, body: "" },
        score,
        snippet: buildSnippet(collapsedBody, lowerBody, lowerQuery),
      })
    }
    results.sort(
      (a, b) => b.score - a.score || compareNotes(a.note, b.note)
    )
    return {
      results: results.slice(offset, offset + limit),
      total: results.length,
    }
  }

  async history(input: HistoryInput): Promise<HistoryOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const limit =
      input.limit === undefined ? DEFAULT_HISTORY_LIMIT : input.limit
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_HISTORY_SNAPSHOTS
    ) {
      invalid(
        "limit",
        `limit must be an integer between 1 and ${MAX_HISTORY_SNAPSHOTS}`
      )
    }
    const offset = input.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0)
      invalid("offset", "offset must be a non-negative integer")
    const snapshots = await this.store.listSnapshots(noteID)
    return {
      snapshots: snapshots.slice(offset, offset + limit).map((snapshot) => ({
        revision: snapshot.note.revision,
        title: snapshot.note.title,
        status: snapshot.note.status,
        spaceID: snapshot.note.spaceID,
        savedAt: snapshot.savedAt,
        updatedAt: snapshot.note.updatedAt,
      })),
      total: snapshots.length,
    }
  }

  async restore(input: RestoreInput): Promise<RestoreOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const revision = requiredRevision(input.revision)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const note = await this.store.transaction(`note:${noteID}`, async () => {
      const existing = await this.store.getNote(noteID)
      if (!existing)
        throw new NotesError("note_not_found", "Note not found", { noteID })
      checkRevision("note", noteID, expectedRevision, existing.revision)
      const snapshots = await this.store.listSnapshots(noteID)
      const snapshot: NoteSnapshot | undefined = snapshots.find(
        (candidate) => candidate.note.revision === revision
      )
      if (!snapshot) {
        throw new NotesError("snapshot_not_found", "Snapshot not found", {
          noteID,
          revision,
        })
      }
      const now = this.store.now()
      const statusChanged = snapshot.note.status !== existing.status
      const next: Note = {
        ...existing,
        title: snapshot.note.title,
        body: snapshot.note.body,
        status: snapshot.note.status,
        spaceID: snapshot.note.spaceID,
        pinned: snapshot.note.pinned,
        revision: existing.revision + 1,
        updatedAt: now,
        ...(statusChanged
          ? { statusUpdatedAt: now }
          : existing.statusUpdatedAt === undefined
            ? {}
            : { statusUpdatedAt: existing.statusUpdatedAt }),
      }
      await this.snapshot(existing, now)
      await this.store.putNote(next)
      return next
    })
    this.emit({ entity: "note", action: "updated", id: note.id })
    return { note }
  }
}

export function createNotesService(
  options: NotesServiceOptions = {}
): NotesService {
  return new NotesService(options)
}
