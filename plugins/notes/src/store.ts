import {
  ATTACHMENT_PREFIX,
  NOTE_PREFIX,
  NotesError,
  SPACE_PREFIX,
  isNoteStatus,
  isRecord,
  isSpaceKind,
  type Note,
  type NoteAttachment,
  type NotesStorage,
  type ProjectLink,
  type Space,
} from "./types.js"

const SCAN_PAGE = 200

export function defaultCreateID(prefix: string): string {
  const value = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16)
  return `${prefix}_${value}`
}

function parseProject(value: unknown): ProjectLink | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null
  return {
    id: value.id,
    directory: typeof value.directory === "string" ? value.directory : null,
    canonical: typeof value.canonical === "string" ? value.canonical : null,
  }
}

export function parseSpace(value: unknown): Space | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || !value.id) return undefined
  if (typeof value.name !== "string" || !value.name) return undefined
  if (!isSpaceKind(value.kind)) return undefined
  if (typeof value.pinned !== "boolean") return undefined
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt))
    return undefined
  const revision = value.revision === undefined ? 0 : value.revision
  if (!Number.isSafeInteger(revision) || (revision as number) < 0)
    return undefined
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    project: parseProject(value.project),
    pinned: value.pinned,
    revision: revision as number,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
  }
}

export function parseAttachment(value: unknown): NoteAttachment | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || !value.id) return undefined
  if (typeof value.name !== "string" || !value.name) return undefined
  if (typeof value.mime !== "string") return undefined
  if (!Number.isFinite(value.size) || (value.size as number) < 0)
    return undefined
  if (!Number.isFinite(value.createdAt)) return undefined
  return {
    id: value.id,
    name: value.name,
    mime: value.mime,
    size: value.size as number,
    createdAt: value.createdAt as number,
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
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt))
    return undefined
  const revision = value.revision === undefined ? 0 : value.revision
  if (!Number.isSafeInteger(revision) || (revision as number) < 0)
    return undefined
  return {
    id: value.id,
    spaceID: value.spaceID,
    title: value.title,
    body: value.body,
    status: value.status,
    pinned: value.pinned,
    attachments: parseAttachments(value.attachments),
    revision: revision as number,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
  }
}

async function scanAll(
  storage: NotesStorage,
  prefix: string
): Promise<unknown[]> {
  const values: unknown[] = []
  let after: string | undefined
  for (;;) {
    const page = await storage.scan({ prefix, after, limit: SCAN_PAGE })
    for (const entry of page.entries) values.push(entry.value)
    if (!page.next || page.next === after || page.entries.length === 0) break
    after = page.next
  }
  return values
}

export class NotesStore {
  readonly storage: NotesStorage
  readonly createID: (prefix: string) => string
  readonly now: () => number

  constructor(
    storage: NotesStorage,
    options: { createID?: (prefix: string) => string; now?: () => number } = {}
  ) {
    this.storage = storage
    this.createID = options.createID ?? defaultCreateID
    this.now = options.now ?? Date.now
  }

  async getSpace(spaceID: string): Promise<Space | undefined> {
    return parseSpace(await this.storage.get(`${SPACE_PREFIX}${spaceID}`))
  }

  async putSpace(space: Space): Promise<void> {
    await this.storage.set(`${SPACE_PREFIX}${space.id}`, space)
  }

  async removeSpace(spaceID: string): Promise<void> {
    await this.storage.remove(`${SPACE_PREFIX}${spaceID}`)
  }

  async listSpaces(): Promise<Space[]> {
    const values = await scanAll(this.storage, SPACE_PREFIX)
    return values
      .map(parseSpace)
      .filter((space): space is Space => space !== undefined)
  }

  async getNote(noteID: string): Promise<Note | undefined> {
    return parseNote(await this.storage.get(`${NOTE_PREFIX}${noteID}`))
  }

  async putNote(note: Note): Promise<void> {
    await this.storage.set(`${NOTE_PREFIX}${note.id}`, note)
  }

  async removeNote(noteID: string): Promise<void> {
    await this.storage.remove(`${NOTE_PREFIX}${noteID}`)
  }

  async listNotes(): Promise<Note[]> {
    const values = await scanAll(this.storage, NOTE_PREFIX)
    return values
      .map(parseNote)
      .filter((note): note is Note => note !== undefined)
  }

  async getAttachment(attachmentID: string): Promise<string | undefined> {
    const value = await this.storage.get(`${ATTACHMENT_PREFIX}${attachmentID}`)
    if (!isRecord(value) || typeof value.data !== "string") return undefined
    return value.data
  }

  async putAttachment(attachmentID: string, data: string): Promise<void> {
    if (typeof data !== "string") {
      throw new NotesError("invalid", "Attachment data must be a string", {
        field: "data",
      })
    }
    await this.storage.set(`${ATTACHMENT_PREFIX}${attachmentID}`, { data })
  }

  async removeAttachment(attachmentID: string): Promise<void> {
    await this.storage.remove(`${ATTACHMENT_PREFIX}${attachmentID}`)
  }
}
