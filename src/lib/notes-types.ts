/**
 * Notes domain types shared by the HTTP adapter, the workspace panel and the
 * composer reference picker. Wire shapes mirror the notes service exactly:
 * seven statuses, spaces scoped by `projectDir` (null = Global).
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

export type NoteStatus = (typeof NOTE_STATUSES)[number]
export type StatusCategory = "backlog" | "active" | "done"

/** Status groups, in the order the UI presents them. */
export const NOTE_STATUS_CATEGORIES: readonly {
  id: StatusCategory
  label: string
  statuses: readonly NoteStatus[]
}[] = [
  { id: "backlog", label: "Backlog", statuses: ["idea", "todo"] },
  { id: "active", label: "Active", statuses: ["in-progress", "blocked"] },
  { id: "done", label: "Done", statuses: ["finished", "cancelled", "archived"] },
]

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  idea: "Idea",
  todo: "To do",
  "in-progress": "In progress",
  blocked: "Blocked",
  finished: "Finished",
  cancelled: "Cancelled",
  archived: "Archived",
}

export function isNoteStatus(value: unknown): value is NoteStatus {
  return (
    typeof value === "string" &&
    (NOTE_STATUSES as readonly string[]).includes(value)
  )
}

export function noteStatusCategory(status: NoteStatus): StatusCategory {
  return (
    NOTE_STATUS_CATEGORIES.find((category) =>
      (category.statuses as readonly NoteStatus[]).includes(status)
    )?.id ?? "backlog"
  )
}

export type NotesAttachment = {
  id: string
  name: string
  mime: string
  size: number
  createdAt?: number
}

export type NotesNote = {
  id: string
  title: string
  content: string
  status: NoteStatus
  pinned: boolean
  spaceID: string | null
  revision?: number
  attachments?: NotesAttachment[]
}

export type NotesSpace = {
  id: string
  name: string
  /** null is a Global space, visible in every project. */
  projectDir: string | null
  pinned: boolean
  revision?: number
}

export type NotesSnapshot = {
  notes: NotesNote[]
  spaces: NotesSpace[]
  workspaceDirectory: string
}

export type NoteInput = Pick<
  NotesNote,
  "title" | "content" | "status" | "pinned" | "spaceID"
>

export type SpaceInput = {
  name: string
  projectDir: string | null
}

/** Mutations resolve only after they succeed. list returns the authoritative current snapshot. */
export type NotesAdapter = {
  list: () => Promise<NotesSnapshot>
  subscribe?: (onChange: () => void) => () => void
  createNote: (input: NoteInput) => Promise<unknown>
  updateNote: (
    id: string,
    input: NoteInput,
    expectedRevision?: number
  ) => Promise<unknown>
  deleteNote: (id: string, expectedRevision?: number) => Promise<unknown>
  createSpace: (input: SpaceInput) => Promise<unknown>
  updateSpace: (
    id: string,
    input: SpaceInput,
    expectedRevision?: number
  ) => Promise<unknown>
  deleteSpace: (id: string, expectedRevision?: number) => Promise<unknown>
  createAttachment?: (
    noteID: string,
    input: { name: string; mime: string; data: string },
    expectedRevision?: number
  ) => Promise<{ note: NotesNote; attachment: NotesAttachment }>
  readAttachment?: (
    noteID: string,
    attachmentID: string
  ) => Promise<{ attachment: NotesAttachment; data: string }>
  deleteAttachment?: (
    noteID: string,
    attachmentID: string,
    expectedRevision?: number
  ) => Promise<{ note: NotesNote }>
}

/** Spaces and notes are shown once even when a response repeats an id. */
export function uniqueByID<T extends { id: string }>(
  items: readonly T[]
): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

/** Trailing path segment of a canonical directory, for space badges. */
export function projectBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path
}

/** "Global" for unscoped spaces, otherwise the project directory's basename. */
export function spaceScopeLabel(
  space: Pick<NotesSpace, "projectDir">
): string {
  return space.projectDir ? projectBasename(space.projectDir) : "Global"
}
