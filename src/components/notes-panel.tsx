import { useCallback, useEffect, useId, useRef, useState } from "react"
import { PlusIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
}

type NoteDraft = { original: NotesNote | null; value: NoteInput }
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-lg font-semibold">Notes</h2>
          <p className="text-sm text-muted-foreground">
            Keep track of work across spaces.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => void refresh()}
            disabled={loading || busy}
          >
            <RefreshCwIcon aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => {
              setFormError(null)
              setSpaceDraft({
                original: null,
                value: { name: "", projectID: null },
              })
            }}
          >
            <PlusIcon aria-hidden="true" />
            New space
          </Button>
          <Button
            className="h-11"
            onClick={() => {
              setFormError(null)
              setNoteDraft({
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
      {snapshot && (
        <div className="grid gap-6 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label htmlFor={searchID} className="text-sm font-medium">
                Search notes
              </label>
              <Input
                id={searchID}
                className="h-11"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title or text"
              />
            </div>
            <Choice
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All statuses" },
                ...Object.entries(statusLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <Choice
              label="Space"
              value={space}
              onChange={setSpace}
              options={[
                { value: "all", label: "All spaces" },
                { value: noSelection, label: "No space" },
                ...spaces.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </div>
          <div>
            <h3 className="mb-2 font-medium">
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
              <ul className="divide-y rounded-lg border">
                {notes.map((note) => (
                  <li
                    key={note.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words">
                        {note.pinned && (
                          <span className="me-2 text-muted-foreground">
                            Pinned
                          </span>
                        )}
                        {note.title || "Untitled note"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {statusLabels[note.status]} ·{" "}
                        {note.spaceID === null
                          ? "No space"
                          : (spaces.find((item) => item.id === note.spaceID)
                              ?.name ?? "Unavailable space")}
                      </p>
                      {note.content && (
                        <p className="mt-1 line-clamp-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">
                          {note.content}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        className="h-11"
                        aria-label={`Edit ${note.title || "untitled note"}`}
                        onClick={() => {
                          setFormError(null)
                          setNoteDraft({
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
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-11 text-destructive"
                        aria-label={`Delete ${note.title || "untitled note"}`}
                        onClick={() => {
                          setFormError(null)
                          setDeletion({ kind: "note", item: note })
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
          <div>
            <h3 className="mb-2 font-medium">
              Spaces{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({spaces.length})
              </span>
            </h3>
            {spaces.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                Create a space to group notes, with or without a project.
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
                        onClick={() => {
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
      <Dialog
        open={noteDraft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setNoteDraft(null)
        }}
      >
        <ResponsiveDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {noteDraft?.original ? "Edit note" : "New note"}
            </DialogTitle>
            <DialogDescription>
              Write a note and choose where it belongs.
            </DialogDescription>
          </DialogHeader>
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
                  () => setNoteDraft(null)
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
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={busy}
                    onClick={() => setNoteDraft(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-11"
                    disabled={busy || !noteDraft.value.title.trim()}
                  >
                    {busy ? "Saving…" : "Save note"}
                  </Button>
                </DialogFooter>
              </fieldset>
            </form>
          )}
        </ResponsiveDialogContent>
      </Dialog>
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
        <AlertDialogContent>
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
