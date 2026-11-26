import { useEffect, useId, useState } from "react"
import { SearchIcon } from "lucide-react"

import { noteStatusText } from "@/lib/note-reference"
import type { NotesNote, NotesSnapshot } from "@/components/notes-panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"

export type NoteReferencePickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  load: () => Promise<NotesSnapshot>
  onSelect: (note: NotesNote, spaceName: string | null) => void
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

/** Searchable note picker for the composer. It reads notes; it never writes them. */
export function NoteReferencePicker({
  open,
  onOpenChange,
  load,
  onSelect,
}: NoteReferencePickerProps) {
  const [snapshot, setSnapshot] = useState<NotesSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const searchID = useId()

  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      setSnapshot(null)
      setLoading(true)
      setError(null)
    })
    void load()
      .then(
        (next) => {
          if (active) setSnapshot(next)
        },
        (failure: unknown) => {
          if (active) setError(`Could not load notes. ${message(failure)}`)
        }
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [load, open])

  const spaces = snapshot?.spaces ?? []
  const normalized = query.trim().toLocaleLowerCase()
  const notes = (snapshot?.notes ?? [])
    .filter(
      (note) =>
        !normalized ||
        `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalized)
    )
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const spaceName = (note: NotesNote) => {
    if (note.spaceID === null) return null
    return spaces.find((space) => space.id === note.spaceID)?.name ?? null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[85dvh] gap-3 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reference a note</DialogTitle>
          <DialogDescription>
            The note is attached as a Markdown file. Its uploaded files are listed, not embedded.
          </DialogDescription>
        </DialogHeader>
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
            autoComplete="off"
          />
        </div>
        <div className="min-h-24 overflow-y-auto">
          {loading && !snapshot ? (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              Loading notes…
            </p>
          ) : error ? (
            <p role="alert" className="py-4 text-sm text-destructive">
              {error}
            </p>
          ) : notes.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {snapshot?.notes.length
                ? "No notes match this search."
                : "No notes yet. Create one in the Notes workspace first."}
            </p>
          ) : (
            <ul aria-label="Notes" className="divide-y divide-border">
              {notes.map((note) => {
                const space = spaceName(note)
                return (
                  <li key={note.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-start px-2 py-2 text-start whitespace-normal"
                      onClick={() => {
                        onSelect(note, space)
                        onOpenChange(false)
                      }}
                    >
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span className="w-full truncate font-medium" dir="auto">
                          {note.title || "Untitled note"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {noteStatusText(note.status)} · {space ?? "No space"}
                        </span>
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </ResponsiveDialogContent>
    </Dialog>
  )
}
