/**
 * Notes HTTP adapter.
 *
 * Notes are served by the UI server (`POST /api/ui/notes/<method>`), so the
 * workspace no longer depends on an engine plugin. Errors are normalized into
 * `NotesApiError` and, for an expired session, reported to the auth gate.
 */
import { isAuthErrorPayload } from "@/lib/auth"
import {
  isNoteStatus,
  uniqueByID,
  type NoteInput,
  type NotesAdapter,
  type NotesAttachment,
  type NotesNote,
  type NotesSpace,
  type NotesSnapshot,
  type SpaceInput,
} from "@/lib/notes-types"

export type NotesMethod =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "search"
  | "history"
  | "restore"
  | "spaces"
  | "createSpace"
  | "updateSpace"
  | "deleteSpace"
  | "createAttachment"
  | "readAttachment"
  | "deleteAttachment"

export const NOTES_METHODS: readonly NotesMethod[] = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "search",
  "history",
  "restore",
  "spaces",
  "createSpace",
  "updateSpace",
  "deleteSpace",
  "createAttachment",
  "readAttachment",
  "deleteAttachment",
]

export class NotesApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "NotesApiError"
    this.status = status
    this.code = code
  }
}

type NotesAuthHandler = (code?: string) => void

let authHandler: NotesAuthHandler | null = null

/**
 * Register the auth gate's `signalUnauthorized`. The provider wires this from
 * `useAuthGate`; the adapter stays free of React context so it can be used by
 * any notes surface.
 */
export function setNotesAuthHandler(handler: NotesAuthHandler | null): void {
  authHandler = handler
}

function readErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error === "string") return error
  if (typeof error !== "object" || error === null) return null
  const code = (error as { code?: unknown }).code
  return typeof code === "string" && code ? code : null
}

function readErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error === "string") return error
  if (typeof error !== "object" || error === null) return null
  if (typeof (error as { message?: unknown }).message === "string")
    return (error as { message: string }).message
  if (typeof (body as { message?: unknown }).message === "string")
    return (body as { message: string }).message
  return null
}

function fallbackMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again."
  if (status === 404) return "This note or space no longer exists."
  if (status === 409) return "Someone changed this note. Refresh and try again."
  if (status === 413) return "This file is too large."
  if (status === 415) return "This file type is not allowed."
  if (status === 0) return "The notes server could not be reached."
  return "The notes server rejected the request."
}

/** POST one notes service method and return its JSON output. */
export async function notesRequest<T>(
  method: NotesMethod,
  input: unknown = {}
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/ui/notes/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? {}),
      credentials: "same-origin",
      cache: "no-store",
    })
  } catch {
    throw new NotesApiError(
      0,
      "network_error",
      "The notes server could not be reached."
    )
  }

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = null
    }
    const code =
      readErrorCode(body) ??
      (response.status === 401 ? "auth_required" : "unknown_error")
    const error = new NotesApiError(
      response.status,
      code,
      readErrorMessage(body) ?? fallbackMessage(response.status)
    )
    if (response.status === 401 && isAuthErrorPayload(body)) {
      try {
        authHandler?.(code)
      } catch {
        // The auth gate must never break the notes error path.
      }
    }
    throw error
  }

  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new NotesApiError(
      response.status,
      "invalid_response",
      "The notes server returned an unreadable response."
    )
  }
}

/**
 * Subscribe to notes change events. EventSource reconnects on its own, but a
 * half-open connection can stay "connected" while delivering nothing. A
 * watchdog forces a fresh stream and a refetch after a silent stall.
 */
export function subscribeNotesEvents(
  onChange: (at: number) => void,
  staleMs = 45_000
): () => void {
  if (typeof EventSource === "undefined") return () => undefined

  const STALE_MS = staleMs
  let source: EventSource | null = null
  let staleTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const handleChange = (event: MessageEvent) => {
    let at = Date.now()
    try {
      const body = JSON.parse(String(event.data)) as { at?: unknown }
      if (typeof body.at === "number") at = body.at
    } catch {
      // A malformed payload still means "something changed".
    }
    onChange(at)
    arm()
  }
  const handleOpen = () => {
    onChange(Date.now())
    arm()
  }
  const closeSource = () => {
    if (!source) return
    try {
      source.removeEventListener("changed", handleChange as EventListener)
      source.removeEventListener("open", handleOpen)
      source.close()
    } catch {
      // Already closed.
    }
    source = null
  }
  function arm() {
    if (staleTimer) clearTimeout(staleTimer)
    staleTimer = setTimeout(() => {
      if (stopped) return
      closeSource()
      onChange(Date.now())
      open()
    }, STALE_MS)
  }
  function open() {
    try {
      source = new EventSource("/api/ui/notes/events")
    } catch {
      return
    }
    source.addEventListener("changed", handleChange as EventListener)
    source.addEventListener("open", handleOpen)
    arm()
  }

  open()
  return () => {
    stopped = true
    if (staleTimer) clearTimeout(staleTimer)
    closeSource()
  }
}

type WireAttachment = {
  id?: unknown
  name?: unknown
  mime?: unknown
  size?: unknown
  createdAt?: unknown
}

type WireNote = {
  id?: unknown
  title?: unknown
  body?: unknown
  content?: unknown
  status?: unknown
  pinned?: unknown
  spaceID?: unknown
  revision?: unknown
  attachments?: unknown
}

type WireSpace = {
  id?: unknown
  name?: unknown
  projectDir?: unknown
  pinned?: unknown
  revision?: unknown
}

function toAttachment(value: WireAttachment): NotesAttachment | null {
  if (typeof value.id !== "string" || typeof value.name !== "string") return null
  return {
    id: value.id,
    name: value.name,
    mime: typeof value.mime === "string" ? value.mime : "",
    size: typeof value.size === "number" ? value.size : 0,
    ...(typeof value.createdAt === "number" ? { createdAt: value.createdAt } : {}),
  }
}

function toNote(value: WireNote): NotesNote | null {
  if (typeof value.id !== "string") return null
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .map((item) => toAttachment(item as WireAttachment))
        .filter((item): item is NotesAttachment => item !== null)
    : []
  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "",
    content:
      typeof value.body === "string"
        ? value.body
        : typeof value.content === "string"
          ? value.content
          : "",
    status: isNoteStatus(value.status) ? value.status : "todo",
    pinned: value.pinned === true,
    spaceID: typeof value.spaceID === "string" ? value.spaceID : null,
    ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
    attachments,
  }
}

function toSpace(value: WireSpace): NotesSpace | null {
  if (typeof value.id !== "string" || typeof value.name !== "string")
    return null
  return {
    id: value.id,
    name: value.name,
    projectDir: typeof value.projectDir === "string" ? value.projectDir : null,
    pinned: value.pinned === true,
    ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
  }
}

export type ScopedListInput = {
  pinned?: boolean
  statuses?: readonly string[]
  spaceID?: string | null
  includeBodies?: boolean
  includeGlobal?: boolean
  limit?: number
  offset?: number
}

function scope(directory: string | null): { directory?: string } {
  return directory ? { directory } : {}
}

/** One page of notes scoped to a project directory. */
export async function listNotesScoped(
  directory: string | null,
  input: ScopedListInput = {}
): Promise<{ notes: NotesNote[]; total: number }> {
  const output = await notesRequest<{
    notes?: unknown
    total?: unknown
  }>("list", {
    ...scope(directory),
    ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
    ...(input.statuses ? { statuses: [...input.statuses] } : {}),
    ...(input.spaceID === undefined ? {} : { spaceID: input.spaceID }),
    ...(input.includeBodies === undefined
      ? {}
      : { includeBodies: input.includeBodies }),
    ...(input.includeGlobal === undefined
      ? {}
      : { includeGlobal: input.includeGlobal }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  })
  if (!Array.isArray(output?.notes) || typeof output.total !== "number")
    throw new Error("The notes server returned an invalid list response.")
  const notes = output.notes
    .map((item) => toNote(item as WireNote))
    .filter((item): item is NotesNote => item !== null)
  return { notes, total: output.total }
}

/** Spaces visible in a project: its own project spaces plus Global spaces. */
export async function listSpacesScoped(
  directory: string | null,
  options: { includeGlobal?: boolean } = {}
): Promise<NotesSpace[]> {
  const output = await notesRequest<{ spaces?: unknown }>("spaces", {
    ...scope(directory),
    ...(options.includeGlobal === undefined
      ? {}
      : { includeGlobal: options.includeGlobal }),
  })
  if (!Array.isArray(output?.spaces))
    throw new Error("The notes server returned an invalid spaces response.")
  return output.spaces
    .map((item) => toSpace(item as WireSpace))
    .filter((item): item is NotesSpace => item !== null)
}

const LIST_PAGE_SIZE = 1_000

/**
 * The workspace adapter for one project directory. Instances are cached by the
 * provider per directory so draft state (keyed by adapter) survives switching
 * projects and coming back.
 */
export function createNotesAdapter(directory: string): NotesAdapter {
  const target = directory || null
  async function list(): Promise<NotesSnapshot> {
    const [spaces, first] = await Promise.all([
      listSpacesScoped(target),
      listNotesScoped(target, { limit: LIST_PAGE_SIZE, offset: 0 }),
    ])
    const notes = [...first.notes]
    while (notes.length < first.total) {
      const page = await listNotesScoped(target, {
        limit: LIST_PAGE_SIZE,
        offset: notes.length,
      })
      if (!page.notes.length)
        throw new Error(
          "The complete notes list could not be loaded. Refresh and try again."
        )
      notes.push(...page.notes)
    }
    if (uniqueByID(notes).length !== notes.length)
      throw new Error("Notes changed while loading. Refresh to try again.")
    if (
      notes.some((note) => typeof note.revision !== "number") ||
      spaces.some((space) => typeof space.revision !== "number")
    )
      throw new Error(
        "This notes server does not support safe editing. Refresh and try again."
      )
    return {
      notes,
      spaces: uniqueByID(spaces),
      workspaceDirectory: directory,
    }
  }

  return {
    list,
    createNote: (input: NoteInput) =>
      notesRequest("create", {
        title: input.title,
        body: input.content,
        status: input.status,
        pinned: input.pinned,
        spaceID: input.spaceID,
      }),
    updateNote: (noteID, input, revision) =>
      notesRequest("update", {
        noteID,
        title: input.title,
        body: input.content,
        status: input.status,
        pinned: input.pinned,
        spaceID: input.spaceID,
        ...(typeof revision === "number"
          ? { expectedRevision: revision }
          : {}),
      }),
    deleteNote: (noteID, revision) =>
      notesRequest("delete", {
        noteID,
        ...(typeof revision === "number"
          ? { expectedRevision: revision }
          : {}),
      }),
    createSpace: (input: SpaceInput) =>
      notesRequest("createSpace", {
        name: input.name,
        projectDir: input.projectDir,
      }),
    updateSpace: (spaceID, input: SpaceInput, revision) =>
      notesRequest("updateSpace", {
        spaceID,
        name: input.name,
        projectDir: input.projectDir,
        ...(typeof revision === "number"
          ? { expectedRevision: revision }
          : {}),
      }),
    deleteSpace: (spaceID, revision) =>
      notesRequest("deleteSpace", {
        spaceID,
        ...(typeof revision === "number"
          ? { expectedRevision: revision }
          : {}),
      }),
    async createAttachment(noteID, input, revision) {
      const output = await notesRequest<{
        note?: WireNote
        attachment?: WireAttachment
      }>("createAttachment", {
        noteID,
        name: input.name,
        mime: input.mime,
        data: input.data,
        ...(typeof revision === "number"
          ? { expectedRevision: revision }
          : {}),
      })
      const note = output?.note ? toNote(output.note) : null
      const attachment = output?.attachment
        ? toAttachment(output.attachment)
        : null
      if (!note || !attachment)
        throw new Error("The notes server returned an invalid attachment response.")
      return { note, attachment }
    },
    async readAttachment(noteID, attachmentID) {
      const output = await notesRequest<{
        attachment?: WireAttachment
        data?: unknown
      }>("readAttachment", { noteID, attachmentID })
      const attachment = output?.attachment
        ? toAttachment(output.attachment)
        : null
      if (!attachment || typeof output.data !== "string")
        throw new Error("The notes server returned an invalid attachment response.")
      return { attachment, data: output.data }
    },
    async deleteAttachment(noteID, attachmentID, revision) {
      const output = await notesRequest<{ note?: WireNote }>(
        "deleteAttachment",
        {
          noteID,
          attachmentID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        }
      )
      const note = output?.note ? toNote(output.note) : null
      if (!note)
        throw new Error("The notes server returned an invalid attachment response.")
      return { note }
    },
    subscribe(onChange) {
      let timer: ReturnType<typeof setTimeout> | null = null
      const stop = subscribeNotesEvents(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          onChange()
        }, 150)
      })
      return () => {
        if (timer) clearTimeout(timer)
        timer = null
        stop()
      }
    },
  }
}
