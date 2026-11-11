import { createRequire } from "node:module"

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
  name: string
  version: string
}

export const PACKAGE_NAME = packageMetadata.name
export const PACKAGE_VERSION = packageMetadata.version

/**
 * v1 storage prefix kept for migration only. New data lives in the file store
 * under `$XDG_DATA_HOME/opencode-notes/v1`.
 */
export const STORAGE_PREFIX = "opencode-notes/v1/"
export const NOTE_PREFIX = `${STORAGE_PREFIX}note/`
export const SPACE_PREFIX = `${STORAGE_PREFIX}space/`
export const ATTACHMENT_PREFIX = `${STORAGE_PREFIX}attachment/`

/**
 * Seven-status model. Legacy v1 statuses (`todo`, `in-progress`, `finished`)
 * remain valid because they are a subset of these literals.
 */
export const NOTE_STATUSES = [
  "idea",
  "todo",
  "in-progress",
  "blocked",
  "finished",
  "cancelled",
  "archived",
] as const

export const STATUS_CATEGORIES = {
  backlog: ["idea", "todo"],
  active: ["in-progress", "blocked"],
  done: ["finished", "cancelled", "archived"],
} as const

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
export const DEFAULT_SEARCH_LIMIT = 100
export const DEFAULT_HISTORY_LIMIT = 50
export const MAX_HISTORY_SNAPSHOTS = 50

export type NoteStatus = (typeof NOTE_STATUSES)[number]
export type StatusCategory = keyof typeof STATUS_CATEGORIES

export interface Space {
  readonly id: string
  readonly name: string
  /** null is a Global space, visible in every project. */
  readonly projectDir: string | null
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
  /** Set whenever the status changes; optional for legacy records. */
  readonly statusUpdatedAt?: number
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
  /** Canonical project directory used to scope project spaces. */
  readonly directory?: string
  readonly status?: NoteStatus
  readonly statuses?: readonly NoteStatus[]
  readonly pinned?: boolean
  readonly query?: string
  /** With directory, also include Global spaces. Defaults to true. */
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
  /** Canonical project directory used to scope project spaces. */
  readonly directory?: string
  /** With directory, also include Global spaces. Defaults to true. */
  readonly includeGlobal?: boolean
}

export interface SpacesOutput {
  readonly spaces: readonly Space[]
  readonly total: number
}

export interface CreateSpaceInput {
  readonly name: string
  /** null or omitted creates a Global space. */
  readonly projectDir?: string | null
  readonly pinned?: boolean
}

export interface UpdateSpaceInput {
  readonly spaceID: string
  /** Reject the update if the stored revision differs. Omit for unconditional writes. */
  readonly expectedRevision?: number
  readonly name?: string
  /** null turns the space into a Global space. */
  readonly projectDir?: string | null
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

export interface SearchInput {
  readonly query: string
  readonly directory?: string
  readonly spaceID?: string | null
  readonly statuses?: readonly NoteStatus[]
  readonly pinned?: boolean
  readonly includeGlobal?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface SearchResult {
  /** Body is always empty; `snippet` carries the relevant excerpt. */
  readonly note: Note
  readonly score: number
  readonly snippet: string
}

export interface SearchOutput {
  readonly results: readonly SearchResult[]
  readonly total: number
}

export interface NoteSnapshot {
  readonly note: Note
  readonly savedAt: number
}

export interface HistoryInput {
  readonly noteID: string
  readonly limit?: number
  readonly offset?: number
}

export interface HistorySnapshot {
  readonly revision: number
  readonly title: string
  readonly status: NoteStatus
  readonly spaceID: string | null
  readonly savedAt: number
  readonly updatedAt: number
}

export interface HistoryOutput {
  readonly snapshots: readonly HistorySnapshot[]
  readonly total: number
}

export interface RestoreInput {
  readonly noteID: string
  readonly revision: number
  readonly expectedRevision?: number
}

export interface RestoreOutput {
  readonly note: Note
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
  | "revision_conflict"
  | "note_not_found"
  | "space_not_found"
  | "space_not_empty"
  | "attachment_not_found"
  | "snapshot_not_found"
  | "limit_exceeded"
  | "mime_rejected"

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
  readonly mime?: string
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNoteStatus(value: unknown): value is NoteStatus {
  return (
    typeof value === "string" &&
    (NOTE_STATUSES as readonly string[]).includes(value)
  )
}

export function statusCategory(status: NoteStatus): StatusCategory {
  for (const category of Object.keys(STATUS_CATEGORIES) as StatusCategory[]) {
    if ((STATUS_CATEGORIES[category] as readonly NoteStatus[]).includes(status))
      return category
  }
  // Unreachable while the constants stay in sync.
  return "backlog"
}
