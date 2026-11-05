import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  EllipsisIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"

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
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type NoteStatus = "todo" | "in-progress" | "finished"
export type NotesNote = {
  id: string
  title: string
  content: string
  status: NoteStatus
  pinned: boolean
  spaceID: string | null
  revision?: string | number
}
export type NotesSpace = {
  id: string
  name: string
  projectID: string | null
  revision?: string | number
}
export type NotesProject = { id: string; name: string }
export type NotesSnapshot = {
  notes: NotesNote[]
  spaces: NotesSpace[]
  projects: NotesProject[]
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
}
export type NotesPanelProps = {
  adapter: NotesAdapter
  className?: string
  refreshKey?: string
  selectedNoteID?: string | null
  selectionRequest?: number
  onSelectedNoteChange?: (id: string | null) => void
}

type NoteDraft = { original: NotesNote | null; value: NoteInput }
function isDirtyNoteDraft(draft: NoteDraft): boolean {
  const original = draft.original
  const value = draft.value
  return (
    !original ||
    value.title !== original.title ||
    value.content !== original.content ||
    value.status !== original.status ||
    value.pinned !== original.pinned ||
    value.spaceID !== original.spaceID
  )
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
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next)
        }}
        items={options}
      >
        <SelectTrigger id={id} className="h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                className="min-h-11"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
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
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [spaceDraft, setSpaceDraft] = useState<SpaceDraft | null>(null)
  const [reviewNote, setReviewNote] = useState<NotesNote | null>(null)
  const [reviewSpace, setReviewSpace] = useState<NotesSpace | null>(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [space, setSpace] = useState("all")
  const searchID = useId()
  const noteTitleID = useId()
  const noteContentID = useId()
  const notePinnedID = useId()
  const spaceNameID = useId()
  const request = useRef(0)
  const notesHeading = useRef<HTMLHeadingElement>(null)
  const noteActionRefs = useRef(new Map<string, HTMLButtonElement>())
  const deletionReturnFocus = useRef<HTMLElement | null>(null)
  // Keep unsaved work when moving between notes, including the mobile back action.
  const [drafts] = useState(() => {
    const existing = workspaceDrafts.get(adapter)
    if (existing) return existing
    const next = new Map<string, NoteDraft>()
    workspaceDrafts.set(adapter, next)
    return next
  })
  const newDraftKey = "__new_note__"
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

  const selectDraft = useCallback(
    (next: NoteDraft | null, notify = true) => {
      if (busy) return
      if (noteDraft) {
        const key = noteDraft.original?.id ?? newDraftKey
        if (isDirtyNoteDraft(noteDraft)) drafts.set(key, noteDraft)
        else drafts.delete(key)
      }
      const key = next?.original?.id ?? newDraftKey
      setNoteDraft(next ? (drafts.get(key) ?? next) : null)
      setFormError(null)
      setReviewNote(null)
      if (notify && onSelectedNoteChange) {
        lastExternalSelection.current = next?.original?.id ?? null
        lastExternalRequest.current = selectionRequest
        onSelectedNoteChange(next?.original?.id ?? null)
      }
    },
    [busy, drafts, noteDraft, onSelectedNoteChange, selectionRequest]
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
        selectDraft(null, false)
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
      selectDraft(
        {
          original: note,
          value: {
            title: note.title,
            content: note.content,
            status: note.status,
            pinned: note.pinned,
            spaceID: note.spaceID,
          },
        },
        false
      )
    })
    return () => {
      active = false
    }
  }, [selectedNoteID, selectionRequest, snapshot, busy, selectDraft])

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

  async function save(action: () => Promise<unknown>, done: () => void) {
    if (busy) return
    setBusy(true)
    setFormError(null)
    setReviewNote(null)
    setReviewSpace(null)
    try {
      await action()
      done()
      await refresh()
    } catch (e) {
      setFormError(message(e))
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
  const spaces = snapshot?.spaces ?? []
  const projects = snapshot?.projects ?? []
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

  return (
    <section className={className} aria-label="Notes">
      <div
        className={`flex items-center justify-between gap-3 border-b pb-4 ${noteDraft ? "hidden md:flex" : ""}`}
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
            disabled={busy || !snapshot}
            onClick={() => {
              selectDraft({
                original: null,
                value: {
                  title: "",
                  content: "",
                  status: "todo",
                  pinned: false,
                  spaceID:
                    space !== "all" && space !== noSelection ? space : null,
                },
              })
            }}
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
      {!snapshot && loading && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading notes…
        </p>
      )}
      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(16rem,0.85fr)_minmax(0,1.5fr)]">
        {snapshot && (
          <div
            className={`flex min-w-0 flex-col gap-6 py-4 ${noteDraft ? "hidden md:flex" : ""}`}
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
                className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1"
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
                    className="h-11 rounded-full px-3"
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
                  {notes.map((note) => (
                    <li
                      key={note.id}
                      className="flex min-w-0 items-start gap-1 py-1"
                    >
                      <Button
                        variant="ghost"
                        className="h-auto min-h-11 min-w-0 flex-1 justify-start px-3 py-3 text-start whitespace-normal"
                        aria-label={`Open ${note.title || "untitled note"}`}
                        aria-describedby={
                          note.content
                            ? `note-preview-${note.id} note-meta-${note.id}`
                            : `note-meta-${note.id}`
                        }
                        aria-current={
                          noteDraft?.original?.id === note.id
                            ? "true"
                            : undefined
                        }
                        disabled={busy}
                        onClick={() => {
                          selectDraft({
                            original: note,
                            value: {
                              title: note.title,
                              content: note.content,
                              status: note.status,
                              pinned: note.pinned,
                              spaceID: note.spaceID,
                            },
                          })
                        }}
                      >
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                          <span className="flex w-full min-w-0 items-center gap-2 font-medium">
                            {note.pinned && <PinIcon aria-hidden="true" />}
                            <span className="min-w-0 break-words" dir="auto">
                              {note.title || "Untitled note"}
                            </span>
                          </span>
                          {note.content && (
                            <span
                              id={`note-preview-${note.id}`}
                              className="line-clamp-2 w-full text-sm font-normal break-words whitespace-pre-wrap text-muted-foreground"
                              dir="auto"
                            >
                              {note.content}
                            </span>
                          )}
                          <span
                            id={`note-meta-${note.id}`}
                            className="text-xs font-normal text-muted-foreground"
                          >
                            {note.pinned && (
                              <span className="sr-only">Pinned. </span>
                            )}
                            {statusLabels[note.status]} ·{" "}
                            {note.spaceID === null
                              ? "No space"
                              : (spaces.find((item) => item.id === note.spaceID)
                                  ?.name ?? "Unavailable space")}
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
                              variant="destructive"
                              aria-label={`Delete ${note.title || "untitled note"}`}
                              onClick={() => {
                                deletionReturnFocus.current =
                                  noteActionRefs.current.get(note.id) ?? null
                                setFormError(null)
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
                            setFormError(null)
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
          className={`min-w-0 py-4 md:border-s md:ps-6 ${noteDraft ? "" : "hidden md:block"}`}
        >
          {noteDraft ? (
            <div className="mb-4 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 md:hidden"
                disabled={busy}
                onClick={() => selectDraft(null)}
              >
                Back to notes
              </Button>
              <h3 className="text-lg font-semibold">
                {noteDraft.original ? "Edit note" : "New note"}
              </h3>
              {isDirtyNoteDraft(noteDraft) && (
                <span role="status" className="text-xs text-muted-foreground">
                  Unsaved changes
                </span>
              )}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              Select a note to view and edit it.
            </p>
          )}
          {noteDraft && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const { original, value } = noteDraft
                void save(
                  () =>
                    original
                      ? adapter.updateNote(
                          original.id,
                          value,
                          original.revision
                        )
                      : adapter.createNote(value),
                  () => {
                    drafts.delete(original?.id ?? newDraftKey)
                    setNoteDraft(null)
                    onSelectedNoteChange?.(null)
                  }
                )
              }}
            >
              <fieldset disabled={busy} className="grid gap-4">
                <div className="grid gap-1.5">
                  <label htmlFor={noteTitleID} className="text-sm font-medium">
                    Title
                  </label>
                  <Input
                    id={noteTitleID}
                    className="h-11"
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
                  <label
                    htmlFor={noteContentID}
                    className="text-sm font-medium"
                  >
                    Text
                  </label>
                  <Textarea
                    id={noteContentID}
                    className="min-h-36"
                    value={noteDraft.value.content}
                    onChange={(e) =>
                      setNoteDraft({
                        ...noteDraft,
                        value: { ...noteDraft.value, content: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
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
                          Saved space:{" "}
                          {reviewNote.spaceID === null
                            ? "No space"
                            : (spaces.find(
                                (item) => item.id === reviewNote.spaceID
                              )?.name ?? "Unavailable space")}
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
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={busy}
                    onClick={() => selectDraft(null)}
                  >
                    Back to notes
                  </Button>
                  <Button
                    type="submit"
                    className="h-11"
                    disabled={busy || !noteDraft.value.title.trim()}
                  >
                    {busy ? "Saving…" : "Save note"}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </div>
      </div>
      <Dialog
        open={spaceDraft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSpaceDraft(null)
        }}
      >
        <ResponsiveDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
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
                void save(
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
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              Could not delete {deletion?.kind}. {formError}
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
                void save(
                  () =>
                    deletion.kind === "note"
                      ? adapter.deleteNote(
                          deletion.item.id,
                          deletion.item.revision
                        )
                      : adapter.deleteSpace(
                          deletion.item.id,
                          deletion.item.revision
                        ),
                  () => {
                    if (deletion.kind === "space" && space === deletion.item.id)
                      setSpace("all")
                    if (deletion.kind === "note") {
                      drafts.delete(deletion.item.id)
                      if (noteDraft?.original?.id === deletion.item.id) {
                        setNoteDraft(null)
                        onSelectedNoteChange?.(null)
                      }
                    }
                    deletionReturnFocus.current = null
                    setDeletion(null)
                  }
                )
              }}
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
