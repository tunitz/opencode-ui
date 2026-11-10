import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  EllipsisIcon,
  FilePlusIcon,
  PaperclipIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"

import { Markdown, type MarkdownNotes } from "@/components/markdown"
import {
  NoteAttachmentDialog,
  isRejectedAttachmentMime,
  type NoteAttachmentReference,
} from "@/components/note-attachment-dialog"
import { NoteStatusLabel } from "@/components/note-status-label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PickerSelect } from "@/components/ui/picker-select"
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import {
  basename,
  formatFileSize,
  fsFindUrl,
  inferMime,
  isSafeImageMime,
  type ProjectEntry,
} from "@/lib/files"

export type NoteStatus = "todo" | "in-progress" | "finished"
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
  revision?: string | number
  attachments?: NotesAttachment[]
}
export type NotesSpace = {
  id: string
  name: string
  projectID: string | null
  revision?: string | number
}
export type NotesProject = {
  id: string
  name: string
  directory: string | null
}
export type NotesSnapshot = {
  notes: NotesNote[]
  spaces: NotesSpace[]
  projects: NotesProject[]
  workspaceDirectory: string
}
export type NoteInput = Pick<
  NotesNote,
  "title" | "content" | "status" | "pinned" | "spaceID"
>
export type SpaceInput = Pick<NotesSpace, "name" | "projectID">
export function mergeNoteDraft(
  original: NotesNote,
  draft: NoteInput,
  latest: NotesNote
): NoteInput {
  return {
    title: draft.title === original.title ? latest.title : draft.title,
    content:
      draft.content === original.content ? latest.content : draft.content,
    status: draft.status === original.status ? latest.status : draft.status,
    pinned: draft.pinned === original.pinned ? latest.pinned : draft.pinned,
    spaceID:
      draft.spaceID === original.spaceID ? latest.spaceID : draft.spaceID,
  }
}
export function mergeSpaceDraft(
  original: NotesSpace,
  draft: SpaceInput,
  latest: NotesSpace
): SpaceInput {
  return {
    name: draft.name === original.name ? latest.name : draft.name,
    projectID:
      draft.projectID === original.projectID
        ? latest.projectID
        : draft.projectID,
  }
}
/** Mutations resolve only after they succeed. list returns the authoritative current snapshot. */
export type NotesAdapter = {
  list: () => Promise<NotesSnapshot>
  subscribe?: (onChange: () => void) => () => void
  createNote: (input: NoteInput) => Promise<unknown>
  updateNote: (
    id: string,
    input: NoteInput,
    expectedRevision?: string | number
  ) => Promise<unknown>
  deleteNote: (
    id: string,
    expectedRevision?: string | number
  ) => Promise<unknown>
  createSpace: (input: SpaceInput) => Promise<unknown>
  updateSpace: (
    id: string,
    input: SpaceInput,
    expectedRevision?: string | number
  ) => Promise<unknown>
  deleteSpace: (
    id: string,
    expectedRevision?: string | number
  ) => Promise<unknown>
  createAttachment?: (
    noteID: string,
    input: { name: string; mime: string; data: string },
    expectedRevision?: string | number
  ) => Promise<{ note: NotesNote; attachment: NotesAttachment }>
  readAttachment?: (
    noteID: string,
    attachmentID: string
  ) => Promise<{ attachment: NotesAttachment; data: string }>
  deleteAttachment?: (
    noteID: string,
    attachmentID: string,
    expectedRevision?: string | number
  ) => Promise<{ note: NotesNote }>
}
export type NotesPanelProps = {
  adapter: NotesAdapter
  className?: string
  refreshKey?: string
  selectedNoteID?: string | null
  selectionRequest?: number
  onSelectedNoteChange?: (id: string | null) => void
}

type EditorView = "list" | "preview" | "edit"
export type NoteDraft = { original: NotesNote | null; value: NoteInput }
const emptyNoteDraft: NoteInput = {
  title: "",
  content: "",
  status: "todo",
  pinned: false,
  spaceID: null,
}
export function isDirtyNoteDraft(draft: NoteDraft): boolean {
  const original = draft.original
  const value = draft.value
  if (!original) {
    // A freshly opened note is pristine until something is actually entered.
    return (
      value.title !== emptyNoteDraft.title ||
      value.content !== emptyNoteDraft.content ||
      value.status !== emptyNoteDraft.status ||
      value.pinned !== emptyNoteDraft.pinned ||
      value.spaceID !== emptyNoteDraft.spaceID
    )
  }
  return (
    value.title !== original.title ||
    value.content !== original.content ||
    value.status !== original.status ||
    value.pinned !== original.pinned ||
    value.spaceID !== original.spaceID
  )
}
/**
 * One compact, plain-text line for list rows: Markdown syntax is removed so a
 * row never shows raw markers or ships the whole body to assistive technology.
 * The first block is the summary; a heading-like first block is paired with the
 * next block, and a block that just repeats the note title is skipped.
 */
export function notePreviewText(
  content: string,
  maxLength = 160,
  title = ""
): string {
  if (maxLength < 1) return ""
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .replace(/```[^\n]*\n?/g, "")
        .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
        .replace(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, " ")
        .replace(/^ {0,3}>[ \t]?/gm, "")
        .replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, "")
        .replace(/^\[[ xX]\][ \t]+/gm, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
        .replace(/(^|[\s(])([*_])(?=\S)([^*_\n]*?\S)\2(?=$|[\s).,;:!?])/g, "$1$3")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
  const key = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  if (title && blocks.length && key(blocks[0]) === key(title)) blocks.shift()
  let text = blocks.shift() ?? ""
  if (text.length > 0 && text.length < 40) {
    const next = blocks.shift()
    if (next) text = `${text} — ${next}`
  }
  const remaining = blocks.length > 0
  if (text.length <= maxLength && !remaining) return text
  const limit = Math.max(1, maxLength - 1)
  const truncated = text.slice(0, limit)
  const lastSpace = truncated.lastIndexOf(" ")
  const cut =
    lastSpace > limit * 0.6 ? truncated.slice(0, lastSpace) : truncated
  return `${cut.trimEnd()}…`
}
// In-memory only: retain drafts if the workspace is temporarily unmounted.
const workspaceDrafts = new WeakMap<NotesAdapter, Map<string, NoteDraft>>()
type SpaceDraft = { original: NotesSpace | null; value: SpaceInput }
type Deletion =
  { kind: "note"; item: NotesNote } | { kind: "space"; item: NotesSpace }
const statusLabels: Record<NoteStatus, string> = {
  todo: "To do",
  "in-progress": "In progress",
  finished: "Finished",
}
const noSelection = "__notes_none__"
const newDraftKey = "__new_note__"

export const NOTE_ATTACHMENT_LIMITS = {
  count: 4,
  fileSize: 4 * 1024 * 1024,
  totalSize: 8 * 1024 * 1024,
} as const

export function noteAttachmentError(
  file: { name: string; mime: string; size: number },
  existing: readonly NotesAttachment[]
): string | null {
  const mime = (file.mime || inferMime(file.name)).toLowerCase()
  if (isRejectedAttachmentMime(mime))
    return "SVG, HTML, and script files cannot be attached."
  if (!Number.isFinite(file.size) || file.size < 0)
    return "This file could not be read."
  if (file.size > NOTE_ATTACHMENT_LIMITS.fileSize)
    return "Each file must be 4 MiB or smaller."
  if (existing.length >= NOTE_ATTACHMENT_LIMITS.count)
    return "A note can have at most 4 files."
  const total =
    existing.reduce((sum, attachment) => sum + attachment.size, 0) + file.size
  if (total > NOTE_ATTACHMENT_LIMITS.totalSize)
    return "A note's files can total at most 8 MiB."
  return null
}

function escapeMarkdownLabel(name: string) {
  return name.replace(/[\\[\]]/g, (character) => `\\${character}`)
}

export function noteAttachmentMarkdown(
  name: string,
  mime: string,
  attachmentID: string
): string {
  const label = escapeMarkdownLabel(name) || "attachment"
  return isSafeImageMime(mime)
    ? `![${label}](attachment://${attachmentID})`
    : `[${label}](attachment://${attachmentID})`
}

export function removeNoteAttachmentReference(
  body: string,
  attachmentID: string
): string {
  const escaped = attachmentID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const reference = new RegExp(
    `!?\\[(?:\\\\.|[^\\]\\\\\\n])*\\]\\(attachment://${escaped}\\)[ \\t]*\\n?`,
    "g"
  )
  return body.replace(reference, "")
}

export function insertNoteText(
  value: string,
  text: string,
  at?: number | null
): { value: string; cursor: number } {
  const index = Math.min(Math.max(at ?? value.length, 0), value.length)
  const prefix =
    index > 0 && !value.slice(0, index).endsWith("\n") ? "\n" : ""
  const suffix =
    index < value.length && !value.slice(index).startsWith("\n") ? "\n" : ""
  return {
    value:
      value.slice(0, index) +
      prefix +
      text +
      suffix +
      value.slice(index),
    cursor: index + prefix.length + text.length,
  }
}

export function noteFileReference(path: string): string {
  const name = basename(path) || path
  const label = escapeMarkdownLabel(name)
  const destination = /[\s()<>]/.test(path)
    ? `<${path.replaceAll("<", "%3C").replaceAll(">", "%3E")}>`
    : path
  return isSafeImageMime(inferMime(path))
    ? `![${label}](${destination})`
    : `[${label}](${destination})`
}

export function pinnedNoteInput(
  note: NotesNote,
  pinned: boolean
): NoteInput {
  return {
    title: note.title,
    content: note.content,
    status: note.status,
    pinned,
    spaceID: note.spaceID,
  }
}

function noteToInput(note: NotesNote): NoteInput {
  return {
    title: note.title,
    content: note.content,
    status: note.status,
    pinned: note.pinned,
    spaceID: note.spaceID,
  }
}

function createdNoteID(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null
  const record = result as Record<string, unknown>
  const note = record.note
  if (
    typeof note === "object" &&
    note !== null &&
    typeof (note as { id?: unknown }).id === "string"
  )
    return (note as { id: string }).id
  return typeof record.id === "string" ? record.id : null
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const comma = result.indexOf(",")
      if (comma < 0) {
        reject(new Error(`Could not read ${file.name}.`))
        return
      }
      resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

function Choice({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  hideLabel?: boolean
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        className={hideLabel ? "sr-only" : "text-sm font-medium"}
      >
        {label}
      </label>
      <PickerSelect
        id={id}
        label={label}
        ariaLabel={label}
        value={value}
        options={options}
        onValueChange={onChange}
      />
    </div>
  )
}

function message(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  )
    return error.message
  return "Please try again."
}

export function NotesPanel({
  adapter,
  className,
  refreshKey,
  selectedNoteID,
  selectionRequest,
  onSelectedNoteChange,
}: NotesPanelProps) {
  const { list } = adapter
  const [snapshot, setSnapshot] = useState<NotesSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [view, setView] = useState<EditorView>("list")
  const [activeNoteID, setActiveNoteID] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [spaceDraft, setSpaceDraft] = useState<SpaceDraft | null>(null)
  const [reviewNote, setReviewNote] = useState<NotesNote | null>(null)
  const [reviewSpace, setReviewSpace] = useState<NotesSpace | null>(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)
  const [previewAttachment, setPreviewAttachment] =
    useState<NoteAttachmentReference | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [space, setSpace] = useState("all")
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [fileQuery, setFileQuery] = useState("")
  const [fileResults, setFileResults] = useState<ProjectEntry[]>([])
  const [fileStatus, setFileStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const searchID = useId()
  const noteTitleID = useId()
  const noteContentID = useId()
  const notePinnedID = useId()
  const spaceNameID = useId()
  const fileSearchID = useId()
  const request = useRef(0)
  const notesHeading = useRef<HTMLHeadingElement>(null)
  const noteActionRefs = useRef(new Map<string, HTMLButtonElement>())
  const previewActionRef = useRef<HTMLButtonElement | null>(null)
  const deletionReturnFocus = useRef<HTMLElement | null>(null)
  const noteComposerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachInputRef = useRef<HTMLInputElement | null>(null)
  const uploadCursor = useRef<number | null>(null)
  // Keep unsaved work when moving between notes, including the mobile back action.
  const [drafts] = useState(() => {
    const existing = workspaceDrafts.get(adapter)
    if (existing) return existing
    const next = new Map<string, NoteDraft>()
    workspaceDrafts.set(adapter, next)
    return next
  })
  const lastExternalSelection = useRef<string | null | undefined>(undefined)
  const lastExternalRequest = useRef<number | undefined>(undefined)
  const currentDraft = useRef<NoteDraft | null>(null)
  useEffect(() => {
    currentDraft.current = noteDraft
  }, [noteDraft])
  useEffect(
    () => () => {
      const draft = currentDraft.current
      if (draft && isDirtyNoteDraft(draft))
        drafts.set(draft.original?.id ?? newDraftKey, draft)
    },
    [drafts]
  )

  const stashDraft = useCallback(
    (draft: NoteDraft | null) => {
      if (!draft) return
      const key = draft.original?.id ?? newDraftKey
      if (isDirtyNoteDraft(draft)) drafts.set(key, draft)
      else drafts.delete(key)
    },
    [drafts]
  )

  const notifySelection = useCallback(
    (id: string | null) => {
      lastExternalSelection.current = id
      lastExternalRequest.current = selectionRequest
      onSelectedNoteChange?.(id)
    },
    [onSelectedNoteChange, selectionRequest]
  )

  const showList = useCallback(
    (notify = true) => {
      if (busy) return
      stashDraft(currentDraft.current)
      setNoteDraft(null)
      setActiveNoteID(null)
      setView("list")
      setFormError(null)
      setReviewNote(null)
      setPreviewAttachment(null)
      if (notify) notifySelection(null)
    },
    [busy, notifySelection, stashDraft]
  )

  const openPreview = useCallback(
    (note: NotesNote, notify = true) => {
      if (busy) return
      stashDraft(currentDraft.current)
      setNoteDraft(null)
      setActiveNoteID(note.id)
      setView("preview")
      setFormError(null)
      setReviewNote(null)
      if (notify) notifySelection(note.id)
    },
    [busy, notifySelection, stashDraft]
  )

  const editNote = useCallback(
    (note: NotesNote, notify = true) => {
      if (busy) return
      stashDraft(currentDraft.current)
      const stored = drafts.get(note.id)
      const value = stored
        ? mergeNoteDraft(stored.original ?? note, stored.value, note)
        : noteToInput(note)
      setNoteDraft({ original: note, value })
      setActiveNoteID(note.id)
      setView("edit")
      setFormError(null)
      setReviewNote(null)
      if (notify) notifySelection(note.id)
    },
    [busy, drafts, notifySelection, stashDraft]
  )

  const startNewNote = useCallback(
    (notify = true) => {
      if (busy) return
      stashDraft(currentDraft.current)
      const stored = drafts.get(newDraftKey)
      setNoteDraft({
        original: null,
        value: stored?.value ?? {
          title: "",
          content: "",
          status: "todo",
          pinned: false,
          spaceID:
            space !== "all" && space !== noSelection ? space : null,
        },
      })
      setActiveNoteID(null)
      setView("edit")
      setFormError(null)
      setReviewNote(null)
      if (notify) notifySelection(null)
    },
    [busy, drafts, notifySelection, space, stashDraft]
  )

  useEffect(() => {
    if (
      selectedNoteID === undefined ||
      (selectedNoteID === lastExternalSelection.current &&
        selectionRequest === lastExternalRequest.current) ||
      busy
    )
      return
    if (selectedNoteID === null) {
      let active = true
      void Promise.resolve().then(() => {
        if (!active) return
        lastExternalSelection.current = null
        lastExternalRequest.current = selectionRequest
        showList(false)
      })
      return () => {
        active = false
      }
    }
    const note = snapshot?.notes.find((item) => item.id === selectedNoteID)
    if (!note) return
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      lastExternalSelection.current = selectedNoteID
      lastExternalRequest.current = selectionRequest
      openPreview(note, false)
    })
    return () => {
      active = false
    }
  }, [
    selectedNoteID,
    selectionRequest,
    snapshot,
    busy,
    showList,
    openPreview,
  ])

  const refresh = useCallback(async () => {
    const token = ++request.current
    setLoading(true)
    setError(null)
    try {
      const next = await list()
      if (token === request.current) setSnapshot(next)
    } catch (e) {
      if (token === request.current)
        setError(`Could not refresh notes. ${message(e)}`)
    } finally {
      if (token === request.current) setLoading(false)
    }
  }, [list])
  useEffect(() => {
    // A stream state transition can mean live events were missed.
    void refreshKey
    let active = true
    const currentRequest = request
    void Promise.resolve().then(() => {
      if (active) void refresh()
    })
    return () => {
      active = false
      currentRequest.current++
    }
  }, [refresh, refreshKey])
  useEffect(() => {
    void refreshKey
    return adapter.subscribe?.(() => void refresh())
  }, [adapter, refresh, refreshKey])

  async function run<T>(
    action: () => Promise<T>,
    done: (result: T) => void,
    target: "form" | "action" = "form"
  ) {
    if (busy) return
    setBusy(true)
    if (target === "form") setFormError(null)
    else setActionError(null)
    setReviewNote(null)
    setReviewSpace(null)
    try {
      const result = await action()
      done(result)
      await refresh()
    } catch (e) {
      if (target === "form") setFormError(message(e))
      else setActionError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const notes = (snapshot?.notes ?? [])
    .filter((note) => {
      const matchesQuery = `${note.title}\n${note.content}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
      return (
        matchesQuery &&
        (status === "all" || note.status === status) &&
        (space === "all" ||
          (space === noSelection
            ? note.spaceID === null
            : note.spaceID === space))
      )
    })
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const noteRows = notes.map((note) => ({
    note,
    preview: notePreviewText(note.content, 160, note.title),
  }))
  const spaces = snapshot?.spaces ?? []
  const projects = snapshot?.projects ?? []
  const workspaceDirectory = snapshot?.workspaceDirectory ?? ""
  const spaceOptions = [
    { value: noSelection, label: "No space" },
    ...spaces.map((item) => ({ value: item.id, label: item.name })),
  ]
  const projectOptions = [
    { value: noSelection, label: "Not linked to a project" },
    ...projects.map((item) => ({ value: item.id, label: item.name })),
  ]
  // Keep unavailable links visible until the user explicitly changes them.
  if (
    spaceDraft?.value.projectID &&
    !projects.some((item) => item.id === spaceDraft.value.projectID)
  )
    projectOptions.push({
      value: spaceDraft.value.projectID,
      label: "Unavailable project",
    })
  if (
    noteDraft?.value.spaceID &&
    !spaces.some((item) => item.id === noteDraft.value.spaceID)
  )
    spaceOptions.push({
      value: noteDraft.value.spaceID,
      label: "Unavailable space",
    })

  function spaceName(spaceID: string | null): string {
    if (spaceID === null) return "No space"
    return (
      spaces.find((item) => item.id === spaceID)?.name ?? "Unavailable space"
    )
  }

  function directoryForSpace(spaceID: string | null): string {
    const linkedSpace =
      spaceID === null
        ? undefined
        : spaces.find((item) => item.id === spaceID)
    const project =
      linkedSpace?.projectID === null || linkedSpace?.projectID === undefined
        ? undefined
        : projects.find((item) => item.id === linkedSpace.projectID)
    return project?.directory ?? workspaceDirectory
  }

  const activeNote =
    activeNoteID === null
      ? null
      : (snapshot?.notes.find((note) => note.id === activeNoteID) ?? null)
  const previewNote = view === "preview" ? activeNote : null
  const previewDirectory = previewNote
    ? directoryForSpace(previewNote.spaceID)
    : ""
  const openAttachment = useCallback(
    (attachment: NoteAttachmentReference) => {
      setPreviewAttachment(attachment)
    },
    []
  )
  const notesMarkdown = useMemo<MarkdownNotes | undefined>(() => {
    if (!previewNote) return undefined
    const noteID = previewNote.id
    return {
      directory: previewDirectory,
      readAttachment: async (attachmentID) => {
        if (!adapter.readAttachment)
          throw new Error("Attachments are unavailable.")
        return await adapter.readAttachment(noteID, attachmentID)
      },
      onOpenAttachment: openAttachment,
    }
  }, [adapter, openAttachment, previewDirectory, previewNote])

  const editorAttachments = noteDraft?.original?.attachments ?? []
  const editorDirectory = directoryForSpace(noteDraft?.value.spaceID ?? null)
  const attachmentNoteID =
    activeNoteID ?? noteDraft?.original?.id ?? previewNote?.id ?? ""

  useEffect(() => {
    if (!filePickerOpen) return
    const trimmed = fileQuery.trim()
    if (!editorDirectory || !trimmed) {
      void Promise.resolve().then(() => {
        setFileResults([])
        setFileStatus("idle")
      })
      return
    }
    const controller = new AbortController()
    let active = true
    void Promise.resolve().then(() => {
      if (active) setFileStatus("loading")
    })
    const timer = setTimeout(() => {
      fetch(fsFindUrl(editorDirectory, trimmed), {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("File search failed.")
          return (await response.json()) as { data?: ProjectEntry[] }
        })
        .then((body) => {
          if (!active) return
          setFileResults(
            (body.data ?? []).filter((entry) => entry.type === "file")
          )
          setFileStatus("ready")
        })
        .catch(() => {
          if (active && !controller.signal.aborted) setFileStatus("error")
        })
    }, 200)
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [editorDirectory, filePickerOpen, fileQuery])

  function openFilePicker() {
    setFileQuery("")
    setFileResults([])
    setFileStatus("idle")
    setFilePickerOpen(true)
  }

  function closeFilePicker() {
    setFilePickerOpen(false)
    setFileQuery("")
    setFileResults([])
    setFileStatus("idle")
  }

  function focusComposer(position: number) {
    setTimeout(() => {
      const element = noteComposerRef.current
      if (!element) return
      if (typeof element.focus === "function") element.focus()
      if (typeof element.setSelectionRange === "function")
        element.setSelectionRange(position, position)
    }, 0)
  }

  function insertProjectFile(entry: ProjectEntry) {
    if (!noteDraft) return
    const at = noteComposerRef.current?.selectionStart
    const inserted = insertNoteText(
      noteDraft.value.content,
      noteFileReference(entry.path),
      at
    )
    setNoteDraft({
      ...noteDraft,
      value: { ...noteDraft.value, content: inserted.value },
    })
    closeFilePicker()
    focusComposer(inserted.cursor)
  }

  async function addFiles(files: File[]) {
    const draft = noteDraft
    const original = draft?.original
    if (!draft || !original) {
      setActionError("Save this note before adding files.")
      return
    }
    const createAttachment = adapter.createAttachment
    if (!createAttachment) {
      setActionError(
        "This notes plugin does not support attachments. Update the plugin."
      )
      return
    }
    const selection = uploadCursor.current
    const pending: Array<{ file: File; mime: string }> = []
    const simulated = [...(original.attachments ?? [])]
    for (const file of files) {
      const mime = (file.type || inferMime(file.name)).toLowerCase()
      const invalid = noteAttachmentError(
        { name: file.name, mime, size: file.size },
        simulated
      )
      if (invalid) {
        setActionError(invalid)
        return
      }
      simulated.push({
        id: `pending-${pending.length}`,
        name: file.name,
        mime,
        size: file.size,
      })
      pending.push({ file, mime })
    }
    let note = original
    let content = draft.value.content
    let insertAt = selection ?? content.length
    setBusy(true)
    setActionError(null)
    try {
      for (const { file, mime } of pending) {
        const data = await readFileBase64(file)
        const created = await createAttachment(
          note.id,
          { name: file.name, mime, data },
          note.revision
        )
        note = created.note
        const inserted = insertNoteText(
          content,
          noteAttachmentMarkdown(
            file.name,
            mime,
            created.attachment.id
          ),
          insertAt
        )
        content = inserted.value
        insertAt = inserted.cursor
      }
    } catch (e) {
      setActionError(message(e))
    } finally {
      // Partial uploads still succeeded: keep their references and refresh.
      if (note !== original) {
        setNoteDraft((current) =>
          current && current.original?.id === note.id
            ? { original: note, value: { ...current.value, content } }
            : current
        )
        await refresh()
        focusComposer(insertAt)
      }
      setBusy(false)
      uploadCursor.current = null
    }
  }

  async function removeAttachment(attachment: NotesAttachment) {
    const draft = noteDraft
    const original = draft?.original
    if (!draft || !original) return
    const deleteAttachment = adapter.deleteAttachment
    if (!deleteAttachment) {
      setActionError(
        "This notes plugin does not support attachments. Update the plugin."
      )
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const result = await deleteAttachment(
        original.id,
        attachment.id,
        original.revision
      )
      // The bytes and metadata are gone, so persist the body cleanup now.
      // Otherwise abandoning the edit would leave a dead attachment reference.
      const storedContent = removeNoteAttachmentReference(
        result.note.content,
        attachment.id
      )
      let stored = result.note
      if (storedContent !== result.note.content) {
        await adapter.updateNote(
          result.note.id,
          {
            title: result.note.title,
            content: storedContent,
            status: result.note.status,
            pinned: result.note.pinned,
            spaceID: result.note.spaceID,
          },
          result.note.revision
        )
        const nextRevision =
          typeof result.note.revision === "number"
            ? result.note.revision + 1
            : undefined
        stored = {
          ...result.note,
          content: storedContent,
          ...(nextRevision === undefined ? {} : { revision: nextRevision }),
        }
      }
      setNoteDraft((current) =>
        current && current.original?.id === original.id
          ? {
              original: stored,
              value: {
                ...current.value,
                content: removeNoteAttachmentReference(
                  current.value.content,
                  attachment.id
                ),
              },
            }
          : current
      )
      await refresh()
    } catch (e) {
      setActionError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const newActionsDisabled = busy || !snapshot

  return (
    <section
      className={`@container ${className ?? ""}`}
      aria-label="Notes"
    >
      <div
        className={`flex items-center justify-between gap-3 border-b pb-4 ${view === "list" ? "" : "hidden @[40rem]:flex"}`}
      >
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Notes</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11"
            onClick={() => void refresh()}
            disabled={loading || busy}
            aria-label={loading ? "Refreshing notes" : "Refresh notes"}
            title="Refresh notes"
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
          <Button
            className="h-11"
            disabled={newActionsDisabled}
            onClick={() => startNewNote()}
          >
            <PlusIcon aria-hidden="true" />
            New note
          </Button>
        </div>
      </div>
      {loading && snapshot && (
        <span role="status" className="sr-only">
          Refreshing notes…
        </span>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {actionError}
        </div>
      )}
      {!snapshot && loading && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading notes…
        </p>
      )}
      <div className="grid min-w-0 gap-6 @[40rem]:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.5fr)]">
        {snapshot && (
          <div
            className={`flex min-w-0 flex-col gap-6 py-4 ${view === "list" ? "" : "hidden @[40rem]:flex"}`}
          >
            <div className="flex min-w-0 flex-col gap-3">
              <div className="relative">
                <label htmlFor={searchID} className="sr-only">
                  Search notes
                </label>
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={searchID}
                  className="h-11 ps-10"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title or text"
                />
              </div>
              <div
                role="group"
                aria-label="Filter by status"
                className="-mx-1 flex max-w-full flex-wrap gap-1 px-1"
              >
                {[
                  { value: "all", label: "All" },
                  { value: "todo", label: "To do" },
                  { value: "in-progress", label: "In progress" },
                  { value: "finished", label: "Done" },
                ].map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={status === option.value ? "secondary" : "ghost"}
                    className="h-11 min-w-11 rounded-full px-2"
                    aria-pressed={status === option.value}
                    onClick={() => setStatus(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <Choice
                label="Filter by space"
                hideLabel
                value={space}
                onChange={setSpace}
                options={[
                  { value: "all", label: "All spaces" },
                  { value: noSelection, label: "No space" },
                  ...spaces.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </div>
            <div>
              <h3 ref={notesHeading} tabIndex={-1} className="mb-2 font-medium">
                Notes{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({notes.length})
                </span>
              </h3>
              {notes.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  {snapshot.notes.length
                    ? "No notes match these filters."
                    : "No notes yet. Create a note to get started."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {noteRows.map(({ note, preview }) => (
                    <li
                      key={note.id}
                      className="flex min-w-0 items-start gap-1 py-1"
                    >
                      <Button
                        variant="ghost"
                        className="h-auto min-h-11 min-w-0 flex-1 justify-start px-3 py-3 text-start whitespace-normal"
                        aria-label={`Open ${note.title || "untitled note"}`}
                        aria-describedby={
                          preview
                            ? `note-preview-${note.id} note-meta-${note.id}`
                            : `note-meta-${note.id}`
                        }
                        aria-current={
                          activeNoteID === note.id ? "true" : undefined
                        }
                        disabled={busy}
                        onClick={() => openPreview(note)}
                      >
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                          <span className="flex w-full min-w-0 items-center gap-2 font-medium">
                            {note.pinned && <PinIcon aria-hidden="true" />}
                            <span className="min-w-0 break-words" dir="auto">
                              {note.title || "Untitled note"}
                            </span>
                          </span>
                          {preview && (
                            <span
                              id={`note-preview-${note.id}`}
                              className="line-clamp-2 w-full text-sm font-normal break-words text-muted-foreground"
                              dir="auto"
                            >
                              {preview}
                            </span>
                          )}
                          <span
                            id={`note-meta-${note.id}`}
                            className="flex flex-wrap items-center gap-1 text-xs font-normal text-muted-foreground"
                          >
                            {note.pinned && (
                              <span className="sr-only">Pinned. </span>
                            )}
                            <NoteStatusLabel status={note.status} />
                            <span aria-hidden="true">·</span>
                            <span>{spaceName(note.spaceID)}</span>
                          </span>
                        </span>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              ref={(node) => {
                                if (node)
                                  noteActionRefs.current.set(note.id, node)
                                else noteActionRefs.current.delete(note.id)
                              }}
                              type="button"
                              variant="ghost"
                              size="icon-lg"
                              className="size-11"
                              aria-label={`More actions for ${note.title || "untitled note"}`}
                              disabled={busy}
                            />
                          }
                        >
                          <EllipsisIcon aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              aria-label={`Edit ${note.title || "untitled note"}`}
                              onClick={() => editNote(note)}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              aria-label={`${note.pinned ? "Unpin" : "Pin"} ${note.title || "untitled note"}`}
                              onClick={() => {
                                setActionError(null)
                                void run(
                                  () =>
                                    adapter.updateNote(
                                      note.id,
                                      pinnedNoteInput(note, !note.pinned),
                                      note.revision
                                    ),
                                  () => {},
                                  "action"
                                )
                              }}
                            >
                              {note.pinned ? "Unpin note" : "Pin note"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              aria-label={`Delete ${note.title || "untitled note"}`}
                              onClick={() => {
                                deletionReturnFocus.current =
                                  noteActionRefs.current.get(note.id) ?? null
                                setActionError(null)
                                setDeletion({ kind: "note", item: note })
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-medium">
                  Spaces{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({spaces.length})
                  </span>
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={() => {
                    setFormError(null)
                    setSpaceDraft({
                      original: null,
                      value: { name: "", projectID: null },
                    })
                  }}
                >
                  <PlusIcon aria-hidden="true" /> New space
                </Button>
              </div>
              {spaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No spaces yet. Group notes for a project or an idea.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {spaces.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium break-words">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.projectID === null
                            ? "Not linked to a project"
                            : (projects.find(
                                (project) => project.id === item.projectID
                              )?.name ?? "Unavailable project")}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          className="h-11"
                          aria-label={`Edit space ${item.name}`}
                          onClick={() => {
                            setFormError(null)
                            setSpaceDraft({
                              original: item,
                              value: {
                                name: item.name,
                                projectID: item.projectID,
                              },
                            })
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11 text-destructive"
                          aria-label={`Delete space ${item.name}`}
                          onClick={(event) => {
                            deletionReturnFocus.current = event.currentTarget
                            setActionError(null)
                            setDeletion({ kind: "space", item })
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div
          className={`min-w-0 py-4 @[40rem]:border-s @[40rem]:ps-6 ${view === "list" ? "hidden @[40rem]:block" : ""}`}
        >
          {view === "preview" &&
            (previewNote ? (
              <article aria-label={`Note ${previewNote.title || "untitled"}`}>
                <div className="mb-5 flex flex-col gap-3">
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11"
                      disabled={busy}
                      onClick={() => showList()}
                    >
                      <ArrowLeftIcon
                        data-icon="inline-start"
                        className="rtl:rotate-180"
                        aria-hidden="true"
                      />
                      Back to Notes
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="grid min-w-0 gap-2">
                      <h3
                        className="text-xl font-semibold break-words"
                        dir="auto"
                      >
                        {previewNote.title || "Untitled note"}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <NoteStatusLabel status={previewNote.status} />
                        <span aria-hidden="true">·</span>
                        <span>{spaceName(previewNote.spaceID)}</span>
                        {previewNote.pinned && (
                          <span className="inline-flex items-center gap-1">
                            <PinIcon aria-hidden="true" className="size-3.5" />
                            Pinned
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        className="h-11"
                        disabled={busy}
                        onClick={() => editNote(previewNote)}
                      >
                        Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              ref={previewActionRef}
                              type="button"
                              variant="ghost"
                              size="icon-lg"
                              className="size-11"
                              aria-label={`More actions for ${previewNote.title || "untitled note"}`}
                              disabled={busy}
                            />
                          }
                        >
                          <EllipsisIcon aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => editNote(previewNote)}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setActionError(null)
                                void run(
                                  () =>
                                    adapter.updateNote(
                                      previewNote.id,
                                      pinnedNoteInput(
                                        previewNote,
                                        !previewNote.pinned
                                      ),
                                      previewNote.revision
                                    ),
                                  () => {},
                                  "action"
                                )
                              }}
                            >
                              {previewNote.pinned
                                ? "Unpin note"
                                : "Pin note"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                deletionReturnFocus.current =
                                  previewActionRef.current
                                setActionError(null)
                                setDeletion({
                                  kind: "note",
                                  item: previewNote,
                                })
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
                {previewNote.content.trim() ? (
                  <div className="min-w-0">
                    <Markdown notes={notesMarkdown}>
                      {previewNote.content}
                    </Markdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No note text</p>
                )}
                {(previewNote.attachments ?? []).length > 0 && (
                  <section aria-label="Note attachments" className="mt-6 grid gap-2">
                    <h4 className="text-sm font-medium">
                      Files{" "}
                      <span className="font-normal text-muted-foreground">
                        ({(previewNote.attachments ?? []).length})
                      </span>
                    </h4>
                    <ul className="divide-y rounded-lg border">
                      {(previewNote.attachments ?? []).map((attachment) => (
                        <li key={attachment.id}>
                          <Button
                            variant="ghost"
                            className="h-auto min-h-11 w-full justify-start gap-2 px-3 py-2 text-start whitespace-normal"
                            aria-label={`Open attachment ${attachment.name}`}
                            onClick={() => setPreviewAttachment(attachment)}
                          >
                            <PaperclipIcon
                              aria-hidden="true"
                              className="shrink-0"
                            />
                            <span className="grid min-w-0 gap-0.5">
                              <span className="break-words" dir="auto">
                                {attachment.name}
                              </span>
                              <span className="text-xs font-normal text-muted-foreground">
                                {attachment.mime} ·{" "}
                                {formatFileSize(attachment.size)}
                              </span>
                            </span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </article>
            ) : (
              <div className="grid gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-fit"
                  disabled={busy}
                  onClick={() => showList()}
                >
                  <ArrowLeftIcon
                    data-icon="inline-start"
                    className="rtl:rotate-180"
                    aria-hidden="true"
                  />
                  Back to Notes
                </Button>
                <p role="status" className="text-sm text-muted-foreground">
                  {loading
                    ? "Loading note…"
                    : "This note is no longer available."}
                </p>
              </div>
            ))}
          {view === "edit" && noteDraft && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const { original, value } = noteDraft
                void run(
                  () =>
                    original
                      ? adapter.updateNote(
                          original.id,
                          value,
                          original.revision
                        )
                      : adapter.createNote(value),
                  (created) => {
                    drafts.delete(original?.id ?? newDraftKey)
                    setNoteDraft(null)
                    setReviewNote(null)
                    if (original) {
                      setActiveNoteID(original.id)
                      setView("preview")
                      notifySelection(original.id)
                    } else {
                      const id = createdNoteID(created)
                      setActiveNoteID(id)
                      setView(id ? "preview" : "list")
                      notifySelection(id)
                    }
                  }
                )
              }}
            >
              <fieldset disabled={busy} className="grid gap-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid min-w-0 gap-2">
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11"
                        onClick={() => showList()}
                      >
                        <ArrowLeftIcon
                          data-icon="inline-start"
                          className="rtl:rotate-180"
                          aria-hidden="true"
                        />
                        Back to Notes
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-xl font-semibold">
                        {noteDraft.original ? "Edit note" : "New note"}
                      </h3>
                      {isDirtyNoteDraft(noteDraft) && (
                        <span
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          Unsaved changes
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="h-11"
                    disabled={busy || !noteDraft.value.title.trim()}
                  >
                    {busy ? "Saving…" : "Save note"}
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={noteTitleID} className="text-sm font-medium">
                    Title
                  </label>
                  <Input
                    id={noteTitleID}
                    className="h-11"
                    dir="auto"
                    required
                    value={noteDraft.value.title}
                    onChange={(e) =>
                      setNoteDraft({
                        ...noteDraft,
                        value: { ...noteDraft.value, title: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label
                      htmlFor={noteContentID}
                      className="text-sm font-medium"
                    >
                      Note
                    </label>
                    <span className="text-xs text-muted-foreground">
                      Markdown supported
                    </span>
                  </div>
                  <Textarea
                    id={noteContentID}
                    ref={noteComposerRef}
                    dir="auto"
                    className="min-h-56 max-h-[60svh] overflow-y-auto sm:min-h-64"
                    value={noteDraft.value.content}
                    onChange={(e) =>
                      setNoteDraft({
                        ...noteDraft,
                        value: { ...noteDraft.value, content: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="grid gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium">Files</p>
                      <p className="text-xs text-muted-foreground">
                        Up to 4 files, 4 MiB each, 8 MiB total.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11"
                        disabled={
                          !noteDraft.original ||
                          !adapter.createAttachment ||
                          editorAttachments.length >=
                            NOTE_ATTACHMENT_LIMITS.count
                        }
                        onClick={() => {
                          uploadCursor.current =
                            noteComposerRef.current?.selectionStart ??
                            noteDraft.value.content.length
                          attachInputRef.current?.click()
                        }}
                      >
                        <PaperclipIcon aria-hidden="true" /> Add files
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11"
                        disabled={!editorDirectory}
                        onClick={() => openFilePicker()}
                      >
                        <FilePlusIcon aria-hidden="true" /> Insert file
                      </Button>
                    </div>
                  </div>
                  <input
                    ref={attachInputRef}
                    type="file"
                    multiple
                    tabIndex={-1}
                    aria-hidden="true"
                    className="sr-only"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? [])
                      event.target.value = ""
                      if (files.length) void addFiles(files)
                    }}
                  />
                  {!noteDraft.original && (
                    <p className="text-xs text-muted-foreground">
                      Save this note before adding files.
                    </p>
                  )}
                  {noteDraft.original && !adapter.createAttachment && (
                    <p className="text-xs text-muted-foreground">
                      This notes plugin does not support attachments. Update
                      the plugin.
                    </p>
                  )}
                  {editorAttachments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No files attached.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {editorAttachments.map((attachment) => (
                        <li
                          key={attachment.id}
                          className="flex flex-wrap items-center justify-between gap-2 p-2"
                        >
                          <div className="min-w-0">
                            <p
                              className="break-words text-sm"
                              dir="auto"
                            >
                              {attachment.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {attachment.mime} ·{" "}
                              {formatFileSize(attachment.size)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-11 text-destructive"
                            aria-label={`Remove ${attachment.name}`}
                            onClick={() => void removeAttachment(attachment)}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!editorDirectory && (
                    <p className="text-xs text-muted-foreground">
                      Project files are unavailable for this note.
                    </p>
                  )}
                </div>
                <div className="grid gap-4 border-t pt-4 min-[400px]:grid-cols-2">
                  <Choice
                    label="Status"
                    value={noteDraft.value.status}
                    onChange={(value) =>
                      setNoteDraft({
                        ...noteDraft,
                        value: {
                          ...noteDraft.value,
                          status: value as NoteStatus,
                        },
                      })
                    }
                    options={Object.entries(statusLabels).map(
                      ([value, label]) => ({ value, label })
                    )}
                  />
                  <Choice
                    label="Space"
                    value={noteDraft.value.spaceID ?? noSelection}
                    onChange={(value) =>
                      setNoteDraft({
                        ...noteDraft,
                        value: {
                          ...noteDraft.value,
                          spaceID: value === noSelection ? null : value,
                        },
                      })
                    }
                    options={spaceOptions}
                  />
                </div>
                <label
                  htmlFor={notePinnedID}
                  className="flex min-h-11 items-center gap-2 text-sm font-medium"
                >
                  <input
                    id={notePinnedID}
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={noteDraft.value.pinned}
                    onChange={(e) =>
                      setNoteDraft({
                        ...noteDraft,
                        value: { ...noteDraft.value, pinned: e.target.checked },
                      })
                    }
                  />
                  Pin note
                </label>
                {formError && (
                  <div className="grid gap-2">
                    <p role="alert" className="text-sm text-destructive">
                      Could not save note. {formError}
                    </p>
                    {noteDraft.original && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        onClick={() => {
                          void list()
                            .then((latest) => {
                              const item = latest.notes.find(
                                (note) => note.id === noteDraft.original?.id
                              )
                              if (item) setReviewNote(item)
                              else
                                setFormError(
                                  "This note no longer exists. Copy your draft before closing."
                                )
                            })
                            .catch((error: unknown) =>
                              setFormError(message(error))
                            )
                        }}
                      >
                        Review saved version
                      </Button>
                    )}
                    {reviewNote && (
                      <div className="grid gap-2 rounded-lg border p-3 text-sm">
                        <p>
                          Saved version: {reviewNote.title} ·{" "}
                          {statusLabels[reviewNote.status]}
                          {reviewNote.pinned ? " · Pinned" : ""}
                        </p>
                        <p>
                          Saved space: {spaceName(reviewNote.spaceID)}
                        </p>
                        <p className="break-words whitespace-pre-wrap">
                          {reviewNote.content || "(No text)"}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          onClick={() => {
                            if (!noteDraft.original) return
                            setNoteDraft({
                              original: reviewNote,
                              value: mergeNoteDraft(
                                noteDraft.original,
                                noteDraft.value,
                                reviewNote
                              ),
                            })
                            setReviewNote(null)
                            setFormError(null)
                          }}
                        >
                          Merge saved changes; keep my edits
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
            </form>
          )}
          {view === "list" && (
            <p className="py-6 text-sm text-muted-foreground">
              Select a note to view and edit it.
            </p>
          )}
        </div>
      </div>
      <Dialog
        open={spaceDraft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSpaceDraft(null)
        }}
      >
        <ResponsiveDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {spaceDraft?.original ? "Edit space" : "New space"}
            </DialogTitle>
            <DialogDescription>
              Spaces can be linked to a project now or later.
            </DialogDescription>
          </DialogHeader>
          {spaceDraft && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const { original, value } = spaceDraft
                void run(
                  () =>
                    original
                      ? adapter.updateSpace(
                          original.id,
                          value,
                          original.revision
                        )
                      : adapter.createSpace(value),
                  () => setSpaceDraft(null)
                )
              }}
            >
              <fieldset disabled={busy} className="grid gap-4">
                <div className="grid gap-1.5">
                  <label htmlFor={spaceNameID} className="text-sm font-medium">
                    Name
                  </label>
                  <Input
                    id={spaceNameID}
                    className="h-11"
                    dir="auto"
                    required
                    value={spaceDraft.value.name}
                    onChange={(e) =>
                      setSpaceDraft({
                        ...spaceDraft,
                        value: { ...spaceDraft.value, name: e.target.value },
                      })
                    }
                  />
                </div>
                <Choice
                  label="Project"
                  value={spaceDraft.value.projectID ?? noSelection}
                  onChange={(value) =>
                    setSpaceDraft({
                      ...spaceDraft,
                      value: {
                        ...spaceDraft.value,
                        projectID: value === noSelection ? null : value,
                      },
                    })
                  }
                  options={projectOptions}
                />
                {formError && (
                  <div className="grid gap-2">
                    <p role="alert" className="text-sm text-destructive">
                      Could not save space. {formError}
                    </p>
                    {spaceDraft.original && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        onClick={() => {
                          void list()
                            .then((latest) => {
                              const item = latest.spaces.find(
                                (space) => space.id === spaceDraft.original?.id
                              )
                              if (item) setReviewSpace(item)
                              else
                                setFormError(
                                  "This space no longer exists. Copy your draft before closing."
                                )
                            })
                            .catch((error: unknown) =>
                              setFormError(message(error))
                            )
                        }}
                      >
                        Review saved version
                      </Button>
                    )}
                    {reviewSpace && (
                      <div className="grid gap-2 rounded-lg border p-3 text-sm">
                        <p>
                          Saved version: {reviewSpace.name} ·{" "}
                          {projects.find(
                            (project) => project.id === reviewSpace.projectID
                          )?.name ??
                            (reviewSpace.projectID
                              ? "Unavailable project"
                              : "Not linked to a project")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          onClick={() => {
                            if (!spaceDraft.original) return
                            setSpaceDraft({
                              original: reviewSpace,
                              value: mergeSpaceDraft(
                                spaceDraft.original,
                                spaceDraft.value,
                                reviewSpace
                              ),
                            })
                            setReviewSpace(null)
                            setFormError(null)
                          }}
                        >
                          Merge saved changes; keep my edits
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={busy}
                    onClick={() => setSpaceDraft(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-11"
                    disabled={busy || !spaceDraft.value.name.trim()}
                  >
                    {busy ? "Saving…" : "Save space"}
                  </Button>
                </DialogFooter>
              </fieldset>
            </form>
          )}
        </ResponsiveDialogContent>
      </Dialog>
      <Dialog
        open={filePickerOpen}
        onOpenChange={(open) => {
          if (!open) closeFilePicker()
        }}
      >
        <ResponsiveDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg md:max-w-xl">
          <DialogHeader>
            <DialogTitle>Insert project file</DialogTitle>
            <DialogDescription>
              Insert a link relative to{" "}
              {editorDirectory || "the notes workspace"}.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <label htmlFor={fileSearchID} className="sr-only">
              Search project files
            </label>
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={fileSearchID}
              className="h-11 ps-10"
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              placeholder="Search project files"
            />
          </div>
          <div className="min-h-24">
            {!editorDirectory ? (
              <p className="text-sm text-muted-foreground">
                Project files are unavailable for this note.
              </p>
            ) : fileStatus === "loading" ? (
              <p role="status" className="text-sm text-muted-foreground">
                Searching files…
              </p>
            ) : fileStatus === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                Could not search project files.
              </p>
            ) : fileStatus === "idle" ? (
              <p className="text-sm text-muted-foreground">
                Type to search project files.
              </p>
            ) : fileResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No files match this search.
              </p>
            ) : (
              <ul className="max-h-[45dvh] divide-y overflow-y-auto rounded-lg border">
                {fileResults.map((entry) => (
                  <li key={entry.path}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-start px-3 py-2 text-start whitespace-normal"
                      onClick={() => insertProjectFile(entry)}
                    >
                      <span className="min-w-0 break-words">
                        {entry.path}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => closeFilePicker()}
            >
              Cancel
            </Button>
          </DialogFooter>
        </ResponsiveDialogContent>
      </Dialog>
      <AlertDialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeletion(null)
        }}
      >
        <AlertDialogContent
          finalFocus={() =>
            deletionReturnFocus.current?.isConnected
              ? deletionReturnFocus.current
              : notesHeading.current
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletion?.kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletion?.kind === "note"
                ? `Delete “${deletion.item.title}”? This cannot be undone.`
                : deletion?.kind === "space"
                  ? `Delete “${deletion.item.name}”? Only empty spaces can be deleted. This cannot be undone.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              Could not delete {deletion?.kind}. {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                if (!deletion) return
                const deleted = deletion
                void run(
                  () =>
                    deleted.kind === "note"
                      ? adapter.deleteNote(
                          deleted.item.id,
                          deleted.item.revision
                        )
                      : adapter.deleteSpace(
                          deleted.item.id,
                          deleted.item.revision
                        ),
                  () => {
                    if (deleted.kind === "space" && space === deleted.item.id)
                      setSpace("all")
                    if (deleted.kind === "note") {
                      drafts.delete(deleted.item.id)
                      if (
                        activeNoteID === deleted.item.id ||
                        noteDraft?.original?.id === deleted.item.id
                      ) {
                        setNoteDraft(null)
                        setActiveNoteID(null)
                        setView("list")
                        notifySelection(null)
                      }
                    }
                    deletionReturnFocus.current = null
                    setDeletion(null)
                  },
                  "action"
                )
              }}
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {previewAttachment && (
        <NoteAttachmentDialog
          noteID={attachmentNoteID}
          attachment={previewAttachment}
          adapter={adapter}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </section>
  )
}
