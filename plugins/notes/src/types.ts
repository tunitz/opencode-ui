export const PLUGIN_ID = "opencode-notes"
export const RPC_ID = "opencode-notes"
export const TUI_PLUGIN_ID = "opencode-notes.tui"
export const STORAGE_PREFIX = "opencode-notes/v1/"
export const NOTE_PREFIX = `${STORAGE_PREFIX}note/`
export const SPACE_PREFIX = `${STORAGE_PREFIX}space/`
export const ATTACHMENT_PREFIX = `${STORAGE_PREFIX}attachment/`

export const NOTE_STATUSES = ["todo", "in-progress", "finished"] as const
export const SPACE_KINDS = ["global", "planning"] as const

export const LIMITS = {
  name: 200,
  title: 500,
  body: 100_000,
  query: 500,
  projectID: 200,
  path: 4_096,
  list: 1_000,
  attachmentName: 255,
  attachmentMime: 200,
  attachmentFileSize: 4 * 1024 * 1024,
  attachmentCount: 4,
  attachmentTotalSize: 8 * 1024 * 1024,
} as const

export const DEFAULT_LIST_LIMIT = 500

export type NoteStatus = (typeof NOTE_STATUSES)[number]
export type SpaceKind = (typeof SPACE_KINDS)[number]

/** A stable project reference. Paths are display snapshots, not an authorization boundary. */
export interface ProjectLink {
  readonly id: string
  readonly directory: string | null
  readonly canonical: string | null
}

export interface ProjectInput {
  readonly id: string
  readonly directory?: string | null
  readonly canonical?: string | null
}

export interface Space {
  readonly id: string
  readonly name: string
  readonly kind: SpaceKind
  readonly project: ProjectLink | null
  readonly pinned: boolean
  /** Per-item optimistic revision. Starts at 1 for new records; legacy records decode at 0. */
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface Note {
  readonly id: string
  /** null means the note is not assigned to a space. */
  readonly spaceID: string | null
  readonly title: string
  readonly body: string
  readonly status: NoteStatus
  readonly pinned: boolean
  /** Attachment metadata only. Bytes are stored separately and never listed. */
  readonly attachments: readonly NoteAttachment[]
  /** Per-item optimistic revision. Starts at 1 for new records; legacy records decode at 0. */
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NoteAttachment {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly createdAt: number
}

export interface ListInput {
  /** null filters unassigned notes. */
  readonly spaceID?: string | null
  readonly projectID?: string
  readonly status?: NoteStatus
  readonly pinned?: boolean
  readonly query?: string
  /** With projectID, also include notes in global spaces. Defaults to true. */
  readonly includeGlobal?: boolean
  /** false returns empty bodies for cheap browsing; filtering still uses real bodies. */
  readonly includeBodies?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface ListOutput {
  readonly notes: readonly Note[]
  readonly total: number
}

export interface GetNoteInput {
  readonly noteID: string
}

export interface CreateNoteInput {
  /** Omit or pass null to create an unassigned note. */
  readonly spaceID?: string | null
  readonly title: string
  readonly body?: string
  readonly status?: NoteStatus
  readonly pinned?: boolean
}

export interface UpdateNoteInput {
  readonly noteID: string
  /** Reject the update if the stored revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
  /** null unassigns the note. */
  readonly spaceID?: string | null
  readonly title?: string
  readonly body?: string
  readonly status?: NoteStatus
  readonly pinned?: boolean
}

export interface DeleteNoteInput {
  readonly noteID: string
  /** Reject the delete if the stored revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
}

export interface DeleteNoteOutput {
  readonly deleted: boolean
}

export interface CreateAttachmentInput {
  readonly noteID: string
  readonly name: string
  readonly mime: string
  /** Base64-encoded bytes. The service enforces decoded size limits. */
  readonly data: string
  /** Reject the write if the stored note revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
}

export interface ReadAttachmentInput {
  readonly noteID: string
  readonly attachmentID: string
}

export interface ReadAttachmentOutput {
  readonly attachment: NoteAttachment
  /** Base64-encoded bytes. Only returned by the explicit read method. */
  readonly data: string
}

export interface DeleteAttachmentInput {
  readonly noteID: string
  readonly attachmentID: string
  /** Reject the delete if the stored note revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
}

export interface DeleteAttachmentOutput {
  readonly note: Note
}

export interface SpacesInput {
  readonly projectID?: string
  readonly kind?: SpaceKind
  /** With projectID, also include global spaces. Defaults to true. */
  readonly includeGlobal?: boolean
}

export interface SpacesOutput {
  readonly spaces: readonly Space[]
  readonly total: number
}

export interface CreateSpaceInput {
  readonly name: string
  readonly kind?: SpaceKind
  readonly project?: ProjectInput | null
  /** Link the server plugin instance's current project. Cannot be combined with project. */
  readonly linkCurrentProject?: boolean
  readonly pinned?: boolean
}

export interface UpdateSpaceInput {
  readonly spaceID: string
  /** Reject the update if the stored revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
  readonly name?: string
  readonly kind?: SpaceKind
  readonly project?: ProjectInput | null
  readonly linkCurrentProject?: boolean
  readonly pinned?: boolean
}

export interface DeleteSpaceInput {
  readonly spaceID: string
  /** Reject the delete if the stored revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
  /**
   * Accepted for wire compatibility. Non-empty spaces are refused even when
   * true; delete notes individually, then delete the space.
   */
  readonly cascade?: boolean
}

export interface DeleteSpaceOutput {
  readonly deleted: boolean
  readonly deletedNotes: number
}

export type ChangeEntity = "note" | "space"
export type ChangeAction = "created" | "updated" | "deleted"

export interface ChangeEvent {
  readonly entity: ChangeEntity
  readonly action: ChangeAction
  readonly id: string
}

export type NotesErrorType =
  | "invalid"
  | "conflict"
  | "note_not_found"
  | "space_not_found"
  | "space_not_empty"
  | "attachment_not_found"
  | "attachment_limit"

export interface NotesErrorData {
  readonly field?: string
  readonly message?: string
  readonly noteID?: string
  readonly spaceID?: string
  readonly noteCount?: number
  readonly entity?: ChangeEntity
  readonly id?: string
  readonly expectedRevision?: number
  readonly revision?: number
  readonly attachmentID?: string
  readonly attachmentCount?: number
  readonly size?: number
  readonly limit?: number
}

export class NotesError extends Error {
  readonly type: NotesErrorType
  readonly data: NotesErrorData

  constructor(
    type: NotesErrorType,
    message: string,
    data: NotesErrorData = {}
  ) {
    super(message)
    this.name = "NotesError"
    this.type = type
    this.data = data
  }
}

export interface StorageEntry {
  readonly key: string
  readonly value: unknown
}

export interface StoragePage {
  readonly entries: readonly StorageEntry[]
  readonly next?: string
}

/** Structural subset of OpenCode's plugin storage domain. */
export interface NotesStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  scan(options: {
    prefix: string
    after?: string
    limit?: number
  }): Promise<StoragePage>
}

export interface ProjectLocation {
  readonly id: string
  readonly directory: string
  readonly canonical: string
}

export interface ServiceOptions {
  readonly storage: NotesStorage
  readonly defaultProject?: ProjectLocation
  readonly now?: () => number
  readonly createID?: (prefix: string) => string
  readonly onChange?: (event: ChangeEvent) => void
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNoteStatus(value: unknown): value is NoteStatus {
  return (
    typeof value === "string" &&
    (NOTE_STATUSES as readonly string[]).includes(value)
  )
}

export function isSpaceKind(value: unknown): value is SpaceKind {
  return (
    typeof value === "string" &&
    (SPACE_KINDS as readonly string[]).includes(value)
  )
}
