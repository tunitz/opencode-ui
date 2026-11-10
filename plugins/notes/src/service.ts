import { NotesStore } from "./store.js"
import {
  DEFAULT_LIST_LIMIT,
  LIMITS,
  NotesError,
  isNoteStatus,
  isRecord,
  isSpaceKind,
  type ChangeEntity,
  type ChangeEvent,
  type CreateAttachmentInput,
  type CreateNoteInput,
  type CreateSpaceInput,
  type DeleteAttachmentInput,
  type DeleteAttachmentOutput,
  type DeleteNoteInput,
  type DeleteNoteOutput,
  type DeleteSpaceInput,
  type DeleteSpaceOutput,
  type ListInput,
  type ListOutput,
  type Note,
  type NoteAttachment,
  type ProjectInput,
  type ProjectLink,
  type ProjectLocation,
  type ReadAttachmentInput,
  type ReadAttachmentOutput,
  type Space,
  type SpaceKind,
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

function optionalStatus(value: unknown): Note["status"] | undefined {
  if (value === undefined) return undefined
  if (!isNoteStatus(value))
    invalid("status", "status must be todo, in-progress, or finished")
  return value
}

function optionalKind(value: unknown): SpaceKind | undefined {
  if (value === undefined) return undefined
  if (!isSpaceKind(value)) invalid("kind", "kind must be global or planning")
  return value
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
  if (typeof value !== "string")
    invalid("name", "name must be a string")
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
  if (ACTIVE_MIME_TYPES.has(mime) || mime.endsWith("/javascript"))
    invalid("mime", "active content types are not allowed")
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
      "attachment_limit",
      `Attachments must be at most ${LIMITS.attachmentFileSize} bytes`,
      { noteID, attachmentCount, size, limit: LIMITS.attachmentFileSize }
    )
  }
  return { data: value, size }
}

/** Best-effort check; it runs inside the in-process mutation queue, not a CAS. */
function checkRevision(
  entity: ChangeEntity,
  id: string,
  expectedRevision: number | undefined,
  revision: number
): void {
  if (expectedRevision === undefined || expectedRevision === revision) return
  throw new NotesError("conflict", "Revision conflict", {
    entity,
    id,
    expectedRevision,
    revision,
  })
}

function parseProject(
  value: ProjectInput | null | undefined,
  fallback: ProjectLocation | undefined,
  field: string
): ProjectLink | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!isRecord(value)) invalid(field, `${field} must be an object or null`)
  const id = requiredText(value.id, `${field}.id`, LIMITS.projectID)
  const directory =
    value.directory === undefined
      ? fallback?.id === id
        ? fallback.directory
        : null
      : typeof value.directory === "string" || value.directory === null
        ? value.directory
        : invalid(
            `${field}.directory`,
            `${field}.directory must be a string or null`
          )
  const canonical =
    value.canonical === undefined
      ? fallback?.id === id
        ? fallback.canonical
        : null
      : typeof value.canonical === "string" || value.canonical === null
        ? value.canonical
        : invalid(
            `${field}.canonical`,
            `${field}.canonical must be a string or null`
          )
  if (directory !== null && directory.length > LIMITS.path) {
    invalid(`${field}.directory`, `${field}.directory is too long`)
  }
  if (canonical !== null && canonical.length > LIMITS.path) {
    invalid(`${field}.canonical`, `${field}.canonical is too long`)
  }
  return { id, directory, canonical }
}

function resolveProject(
  input: {
    readonly project?: ProjectInput | null
    readonly linkCurrentProject?: boolean
  },
  fallback: ProjectLocation | undefined
): ProjectLink | null | undefined {
  const hasProject = Object.prototype.hasOwnProperty.call(input, "project")
  const link = optionalBoolean(input.linkCurrentProject, "linkCurrentProject")
  if (link === true && hasProject) {
    invalid(
      "linkCurrentProject",
      "project and linkCurrentProject cannot be combined"
    )
  }
  if (hasProject) return parseProject(input.project, fallback, "project")
  if (link === true) {
    if (!fallback)
      invalid("linkCurrentProject", "no current project is available")
    return {
      id: fallback.id,
      directory: fallback.directory,
      canonical: fallback.canonical,
    }
  }
  return undefined
}

function compareSpaces(a: Space, b: Space): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.kind !== b.kind) return a.kind === "global" ? -1 : 1
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

function compareNotes(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
}

export class NotesService {
  readonly store: NotesStore
  private readonly defaultProject: ProjectLocation | undefined
  private readonly options: {
    readonly onChange?: (event: ChangeEvent) => void
  }
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: {
    readonly storage: NotesStore["storage"]
    readonly defaultProject?: ProjectLocation
    readonly now?: () => number
    readonly createID?: (prefix: string) => string
    readonly onChange?: (event: ChangeEvent) => void
  }) {
    this.store = new NotesStore(options.storage, {
      createID: options.createID,
      now: options.now,
    })
    this.defaultProject = options.defaultProject
    this.options = { onChange: options.onChange }
  }

  private emit(event: ChangeEvent): void {
    try {
      this.options.onChange?.(event)
    } catch {
      // Observers must not break a committed write.
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async requireSpace(spaceID: string): Promise<Space> {
    const space = await this.store.getSpace(spaceID)
    if (!space)
      throw new NotesError("space_not_found", "Space not found", { spaceID })
    return space
  }

  async list(input: ListInput = {}): Promise<ListOutput> {
    const status = optionalStatus(input.status)
    const pinned = optionalBoolean(input.pinned, "pinned")
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
      if (pinned !== undefined && note.pinned !== pinned) return false
      if (query && !`${note.title}\n${note.body}`.toLowerCase().includes(query))
        return false
      if (input.projectID) {
        const space = note.spaceID ? spaceByID.get(note.spaceID) : undefined
        if (!space) return false
        const linked = space.project?.id === input.projectID
        const global = input.includeGlobal !== false && space.kind === "global"
        if (!linked && !global) return false
      }
      return true
    })
    filtered.sort(compareNotes)
    return {
      notes: filtered.slice(offset, offset + limit),
      total: filtered.length,
    }
  }

  async create(input: CreateNoteInput): Promise<Note> {
    const spaceID =
      input.spaceID === undefined || input.spaceID === null
        ? null
        : requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const title = requiredText(input.title, "title", LIMITS.title)
    const body = optionalText(input.body, "body", LIMITS.body) ?? ""
    const status = optionalStatus(input.status) ?? "todo"
    const pinned = optionalBoolean(input.pinned, "pinned") ?? false
    return this.mutate(async () => {
      if (spaceID !== null) await this.requireSpace(spaceID)
      const now = this.store.now()
      const note: Note = {
        id: this.store.createID("note"),
        spaceID,
        title,
        body,
        status,
        pinned,
        attachments: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await this.store.putNote(note)
      this.emit({ entity: "note", action: "created", id: note.id })
      return note
    })
  }

  async update(input: UpdateNoteInput): Promise<Note> {
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
    return this.mutate(async () => {
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
      if (!changed) return existing
      const note: Note = {
        ...existing,
        spaceID: spaceID === undefined ? existing.spaceID : spaceID,
        title: title ?? existing.title,
        body: body ?? existing.body,
        status: status ?? existing.status,
        pinned: pinned ?? existing.pinned,
        // Attachments change only through createAttachment/deleteAttachment.
        attachments: existing.attachments,
        revision: existing.revision + 1,
        updatedAt: this.store.now(),
      }
      await this.store.putNote(note)
      this.emit({ entity: "note", action: "updated", id: note.id })
      return note
    })
  }

  async delete(input: DeleteNoteInput): Promise<DeleteNoteOutput> {
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    return this.mutate(async () => {
      const existing = await this.store.getNote(noteID)
      if (!existing) return { deleted: false }
      checkRevision("note", noteID, expectedRevision, existing.revision)
      await this.store.removeNote(noteID)
      // Best-effort: a failed cleanup can leave orphaned attachment keys, but
      // it must never resurrect or block the note deletion.
      for (const attachment of existing.attachments) {
        try {
          await this.store.removeAttachment(attachment.id)
        } catch {
          // Ignored: orphan cleanup is not part of the delete contract.
        }
      }
      this.emit({ entity: "note", action: "deleted", id: noteID })
      return { deleted: true }
    })
  }

  async createAttachment(
    input: CreateAttachmentInput
  ): Promise<{ note: Note; attachment: NoteAttachment }> {
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    return this.mutate(async () => {
      const existing = await this.store.getNote(noteID)
      if (!existing)
        throw new NotesError("note_not_found", "Note not found", { noteID })
      checkRevision("note", noteID, expectedRevision, existing.revision)

      const name = attachmentName(input.name)
      const mime = attachmentMime(input.mime)
      const { data, size } = attachmentData(
        input.data,
        noteID,
        existing.attachments.length + 1
      )

      if (existing.attachments.length >= LIMITS.attachmentCount) {
        throw new NotesError(
          "attachment_limit",
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
          "attachment_limit",
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
      await this.store.putAttachment(attachment.id, data)
      const note: Note = {
        ...existing,
        attachments: [...existing.attachments, attachment],
        revision: existing.revision + 1,
        updatedAt: now,
      }
      try {
        await this.store.putNote(note)
      } catch (error) {
        try {
          await this.store.removeAttachment(attachment.id)
        } catch {
          // Ignored: the original write error is the useful one.
        }
        throw error
      }
      this.emit({ entity: "note", action: "updated", id: note.id })
      return { note, attachment }
    })
  }

  async readAttachment(
    input: ReadAttachmentInput
  ): Promise<ReadAttachmentOutput> {
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
    return { attachment, data }
  }

  async deleteAttachment(
    input: DeleteAttachmentInput
  ): Promise<DeleteAttachmentOutput> {
    const noteID = requiredText(input.noteID, "noteID", LIMITS.projectID)
    const attachmentID = requiredText(
      input.attachmentID,
      "attachmentID",
      LIMITS.projectID
    )
    const expectedRevision = optionalRevision(input.expectedRevision)
    return this.mutate(async () => {
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
      const note: Note = {
        ...existing,
        attachments: existing.attachments.filter(
          (candidate) => candidate.id !== attachmentID
        ),
        revision: existing.revision + 1,
        updatedAt: this.store.now(),
      }
      await this.store.putNote(note)
      this.emit({ entity: "note", action: "updated", id: note.id })
      try {
        await this.store.removeAttachment(attachmentID)
      } catch {
        // Ignored: the note no longer references the bytes; an orphan may remain.
      }
      return { note }
    })
  }

  async spaces(input: SpacesInput = {}): Promise<SpacesOutput> {
    const kind = optionalKind(input.kind)
    const spaces = await this.store.listSpaces()
    const filtered = spaces.filter((space) => {
      if (kind && space.kind !== kind) return false
      if (input.projectID) {
        const linked = space.project?.id === input.projectID
        const global = input.includeGlobal !== false && space.kind === "global"
        if (!linked && !global) return false
      }
      return true
    })
    filtered.sort(compareSpaces)
    return { spaces: filtered, total: filtered.length }
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const name = requiredText(input.name, "name", LIMITS.name)
    const kind = optionalKind(input.kind) ?? "global"
    const project = resolveProject(input, this.defaultProject) ?? null
    const pinned = optionalBoolean(input.pinned, "pinned") ?? false
    return this.mutate(async () => {
      const now = this.store.now()
      const space: Space = {
        id: this.store.createID("space"),
        name,
        kind,
        project,
        pinned,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await this.store.putSpace(space)
      this.emit({ entity: "space", action: "created", id: space.id })
      return space
    })
  }

  async updateSpace(input: UpdateSpaceInput): Promise<Space> {
    const spaceID = requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    const name =
      input.name === undefined
        ? undefined
        : requiredText(input.name, "name", LIMITS.name)
    const kind = optionalKind(input.kind)
    const project = resolveProject(input, this.defaultProject)
    const pinned = optionalBoolean(input.pinned, "pinned")
    return this.mutate(async () => {
      const existing = await this.store.getSpace(spaceID)
      if (!existing)
        throw new NotesError("space_not_found", "Space not found", { spaceID })
      checkRevision("space", spaceID, expectedRevision, existing.revision)
      const changed =
        (name !== undefined && name !== existing.name) ||
        (kind !== undefined && kind !== existing.kind) ||
        (project !== undefined && !sameProject(project, existing.project)) ||
        (pinned !== undefined && pinned !== existing.pinned)
      if (!changed) return existing
      const space: Space = {
        ...existing,
        name: name ?? existing.name,
        kind: kind ?? existing.kind,
        project: project === undefined ? existing.project : project,
        pinned: pinned ?? existing.pinned,
        revision: existing.revision + 1,
        updatedAt: this.store.now(),
      }
      await this.store.putSpace(space)
      this.emit({ entity: "space", action: "updated", id: space.id })
      return space
    })
  }

  async deleteSpace(input: DeleteSpaceInput): Promise<DeleteSpaceOutput> {
    const spaceID = requiredText(input.spaceID, "spaceID", LIMITS.projectID)
    const expectedRevision = optionalRevision(input.expectedRevision)
    // Accepted for wire compatibility, but never honored: plugin storage has no
    // cross-instance transaction, so a cascade could partially delete on failure.
    optionalBoolean(input.cascade, "cascade")
    return this.mutate(async () => {
      const existing = await this.store.getSpace(spaceID)
      if (!existing) return { deleted: false, deletedNotes: 0 }
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
      this.emit({ entity: "space", action: "deleted", id: spaceID })
      return { deleted: true, deletedNotes: 0 }
    })
  }
}

function sameProject(a: ProjectLink | null, b: ProjectLink | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.id === b.id && a.directory === b.directory && a.canonical === b.canonical
  )
}

export type { ProjectLocation }
