import { migrateEngineData } from "./core/migrate.js"
import { resolveDataDir } from "./fs-utils.js"
import {
  filterNoteTexts,
  searchNoteTexts,
  validatedBase64ByteLength,
} from "./note-ops.js"
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
  type Scope,
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

/** Inline-active types are refused; attachments are downloadable data, not a document surface. */
const ACTIVE_MIME_TYPES = new Set([
  "image/svg+xml",
  "image/svg",
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-javascript",
  "text/javascript",
  "text/x-javascript",
  "application/ecmascript",
  "application/x-ecmascript",
  "text/ecmascript",
  "text/x-ecmascript",
  "application/xslt+xml",
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
  const size = validatedBase64ByteLength(value)
  if (size < 0) invalid("data", "data must be valid base64")
  if (size === 0) invalid("data", "data must not be empty")
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
  const buf = Buffer.from(data, "base64")
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
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

/**
 * Whether a space is visible to a caller. Unscoped library callers see
 * everything; Global spaces are always shared; a linked space is visible only
 * when its owner matches the caller's active connection. Legacy linked spaces
 * (no connectionId) are hidden unless an explicit migration surface includes
 * them.
 */
function matchesScope(space: Space, scope: Scope | undefined): boolean {
  if (scope === undefined) return true
  if (space.projectDir === null) return true
  return (
    typeof scope.connectionId === "string" &&
    space.connectionId === scope.connectionId
  )
}

function optionalConnectionId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== "string" || !value.trim())
    invalid("connectionId", "connectionId must be a non-empty string or null")
  return value
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
  /** Default scope applied when a public method is called without one. */
  readonly scope?: Scope
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

  private scopeOf(scope?: Scope): Scope | undefined {
    return scope ?? this.options.scope
  }

  private async requireSpace(spaceID: string): Promise<Space> {
    const space = await this.store.getSpace(spaceID)
    if (!space)
      throw new NotesError("space_not_found", "Space not found", { spaceID })
    return space
  }

  private async assertSpaceInScope(
    spaceID: string,
    scope: Scope | undefined
  ): Promise<Space> {
    const space = await this.requireSpace(spaceID)
    if (!matchesScope(space, scope))
      throw new NotesError("space_not_found", "Space not found", { spaceID })
    return space
  }

  /**
   * Direct note access must not reveal the existence of another connection's
   * note. Unassigned notes are shared; a note in a space is visible only when
   * that space is Global or owned by the active connection.
   */
  private async assertNoteInScope(
    noteID: string,
    scope: Scope | undefined
  ): Promise<void> {
    if (scope === undefined) return
    const note = await this.store.getNote(noteID)
    if (!note)
      throw new NotesError("note_not_found", "Note not found", { noteID })
    if (note.spaceID === null) return
    const space = await this.store.getSpace(note.spaceID)
    if (!space || !matchesScope(space, scope))
      throw new NotesError("note_not_found", "Note not found", { noteID })
  }

  private async snapshot(existing: Note, savedAt: number): Promise<void> {
    await this.store.putSnapshot({ note: existing, savedAt })
  }

  async list(input: ListInput = {}, scope?: Scope): Promise<ListOutput> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
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
    const candidates = notes.filter((note) => {
      if (input.spaceID !== undefined && note.spaceID !== input.spaceID)
        return false
      if (status && note.status !== status) return false
      if (statuses && !statuses.includes(note.status)) return false
      if (pinned !== undefined && note.pinned !== pinned) return false
      if (note.spaceID !== null) {
        const space = spaceByID.get(note.spaceID)
        if (effectiveScope !== undefined) {
          if (!space || !matchesScope(space, effectiveScope)) return false
        }
        if (directory) {
          if (!space) return false
          if (!matchesDirectory(space.projectDir, directory, includeGlobal))
            return false
        }
      }
      return true
    })
    const filtered = query
      ? filterNoteTexts(
          candidates.map((note) => note.title),
          candidates.map((note) => note.body),
          query
        ).map((index) => candidates[index]!)
      : candidates
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

  async get(input: GetNoteInput, scope?: Scope): Promise<Note> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
    const note = await this.store.getNote(noteID)
    if (!note)
      throw new NotesError("note_not_found", "Note not found", { noteID })
    return note
  }

  async create(input: CreateNoteInput, scope?: Scope): Promise<Note> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
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
      if (spaceID !== null)
        await this.assertSpaceInScope(spaceID, effectiveScope)
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

  async update(input: UpdateNoteInput, scope?: Scope): Promise<Note> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const effectiveScope = this.scopeOf(scope)
    await this.assertNoteInScope(noteID, effectiveScope)
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
        await this.assertSpaceInScope(spaceID, effectiveScope)
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

  async delete(input: DeleteNoteInput, scope?: Scope): Promise<DeleteNoteOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
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
    input: CreateAttachmentInput,
    scope?: Scope
  ): Promise<{ note: Note; attachment: NoteAttachment }> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
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
    input: ReadAttachmentInput,
    scope?: Scope
  ): Promise<ReadAttachmentOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
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
    input: DeleteAttachmentInput,
    scope?: Scope
  ): Promise<DeleteAttachmentOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
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

  async spaces(input: SpacesInput = {}, scope?: Scope): Promise<SpacesOutput> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
    const directory = optionalDirectory(input.directory)
    const includeGlobal = optionalBoolean(
      input.includeGlobal,
      "includeGlobal"
    )
    const includeLegacy = input.includeLegacy === true
    const spaces = await this.store.listSpaces()
    const filtered = spaces.filter((space) => {
      if (!matchesDirectory(space.projectDir, directory, includeGlobal))
        return false
      return includeLegacy || matchesScope(space, effectiveScope)
    })
    filtered.sort(compareSpaces)
    return { spaces: filtered, total: filtered.length }
  }

  async createSpace(input: CreateSpaceInput, scope?: Scope): Promise<Space> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
    const name = requiredText(input.name, "name", LIMITS.name)
    const projectDir = projectDirectory(input.projectDir) ?? null
    // Global spaces ignore the owner. A linked space created without an active
    // connection becomes legacy/pending rather than failing; the migration UI
    // can assign it later.
    const connectionId =
      projectDir === null ? null : (effectiveScope?.connectionId ?? null)
    const pinned = optionalBoolean(input.pinned, "pinned") ?? false
    const spaceID = this.store.createID("space")
    const space = await this.store.transaction(`space:${spaceID}`, async () => {
      const now = this.store.now()
      const created: Space = {
        id: spaceID,
        name,
        projectDir,
        pinned,
        connectionId,
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

  async updateSpace(input: UpdateSpaceInput, scope?: Scope): Promise<Space> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
    const spaceID = requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const name =
      input.name === undefined
        ? undefined
        : requiredText(input.name, "name", LIMITS.name)
    const projectDir = projectDirectory(input.projectDir)
    const pinned = optionalBoolean(input.pinned, "pinned")
    // Supplying connectionId is an explicit migration assignment: it bypasses
    // the normal scope guard so a legacy space can be adopted.
    const hasExplicitConnection = input.connectionId !== undefined
    const explicitConnectionId = optionalConnectionId(input.connectionId)
    const result = await this.store.transaction(`space:${spaceID}`, async () => {
      const existing = hasExplicitConnection
        ? await this.requireSpace(spaceID)
        : await this.assertSpaceInScope(spaceID, effectiveScope)
      checkRevision("space", spaceID, expectedRevision, existing.revision)
      const nextConnectionId = hasExplicitConnection
        ? (explicitConnectionId ?? null)
        : projectDir === null
          ? null
          : existing.connectionId
      const changed =
        (name !== undefined && name !== existing.name) ||
        (projectDir !== undefined && projectDir !== existing.projectDir) ||
        (pinned !== undefined && pinned !== existing.pinned) ||
        nextConnectionId !== existing.connectionId
      if (!changed) return { space: existing, changed: false }
      const next: Space = {
        ...existing,
        name: name ?? existing.name,
        projectDir: projectDir === undefined ? existing.projectDir : projectDir,
        pinned: pinned ?? existing.pinned,
        connectionId: nextConnectionId,
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

  async deleteSpace(
    input: DeleteSpaceInput,
    scope?: Scope
  ): Promise<DeleteSpaceOutput> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
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
        if (!matchesScope(existing, effectiveScope))
          throw new NotesError("space_not_found", "Space not found", { spaceID })
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

  async search(input: SearchInput, scope?: Scope): Promise<SearchOutput> {
    await this.ready()
    const effectiveScope = this.scopeOf(scope)
    const query = requiredText(input.query, "query", LIMITS.query)
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
    const candidates: Note[] = []
    const titles: string[] = []
    const bodies: string[] = []
    for (const note of notes) {
      if (input.spaceID !== undefined && note.spaceID !== input.spaceID)
        continue
      if (statuses && !statuses.includes(note.status)) continue
      if (pinned !== undefined && note.pinned !== pinned) continue
      if (note.spaceID !== null) {
        const space = spaceByID.get(note.spaceID)
        if (effectiveScope !== undefined) {
          if (!space || !matchesScope(space, effectiveScope)) continue
        }
        if (directory) {
          if (!space) continue
          if (!matchesDirectory(space.projectDir, directory, includeGlobal))
            continue
        }
      }
      candidates.push(note)
      titles.push(note.title)
      bodies.push(note.body)
    }
    const hits = searchNoteTexts(titles, bodies, query)
    const results: SearchResult[] = hits.map((hit) => ({
      note: { ...candidates[hit.index]!, body: "" },
      score: hit.score,
      snippet: hit.snippet,
    }))
    results.sort(
      (a, b) => b.score - a.score || compareNotes(a.note, b.note)
    )
    return {
      results: results.slice(offset, offset + limit),
      total: results.length,
    }
  }

  async history(input: HistoryInput, scope?: Scope): Promise<HistoryOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
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

  async restore(input: RestoreInput, scope?: Scope): Promise<RestoreOutput> {
    await this.ready()
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    await this.assertNoteInScope(noteID, this.scopeOf(scope))
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
      const restoredSpaceID =
        snapshot.note.spaceID !== null &&
        (await this.store.getSpace(snapshot.note.spaceID))
          ? snapshot.note.spaceID
          : null
      const now = this.store.now()
      const statusChanged = snapshot.note.status !== existing.status
      const next: Note = {
        ...existing,
        title: snapshot.note.title,
        body: snapshot.note.body,
        status: snapshot.note.status,
        spaceID: restoredSpaceID,
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
