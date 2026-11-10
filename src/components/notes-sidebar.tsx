import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { NotebookPenIcon, PinIcon } from "lucide-react"
import {
  NotesPanel,
  pinnedNoteInput,
  type NotesAdapter,
  type NotesAttachment,
  type NotesNote,
  type NotesSpace,
} from "@/components/notes-panel"
import { NoteStatusLabel } from "@/components/note-status-label"
import { projectName } from "@/components/project-select"
import { Accordion } from "@/components/ui/accordion"
import { AccordionSection } from "@/components/ui/accordion-section"
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
import { Button } from "@/components/ui/button"
import { openCode } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

type PluginAttachment = {
  id: string
  name: string
  mime: string
  size: number
  createdAt?: number
}
type PluginNote = {
  id: string
  title: string
  body: string
  status: NotesNote["status"]
  pinned: boolean
  spaceID: string | null
  revision?: number
  attachments?: PluginAttachment[]
}
type PluginSpace = {
  id: string
  name: string
  project: { id: string } | null
  revision?: number
}

function pluginAttachmentToNotes(
  attachment: PluginAttachment
): NotesAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    ...(typeof attachment.createdAt === "number"
      ? { createdAt: attachment.createdAt }
      : {}),
  }
}

function pluginNoteToNotes(note: PluginNote): NotesNote {
  return {
    id: note.id,
    title: note.title,
    content: note.body,
    status: note.status,
    pinned: note.pinned,
    spaceID: note.spaceID,
    ...(typeof note.revision === "number"
      ? { revision: note.revision }
      : {}),
    attachments: (note.attachments ?? []).map(pluginAttachmentToNotes),
  }
}

function pluginSpaceToNotes(space: PluginSpace): NotesSpace {
  return {
    id: space.id,
    name: space.name,
    projectID: space.project?.id ?? null,
    revision: space.revision,
  }
}

export type NotesContextValue = {
  available: boolean
  open: boolean
  hasWorkspace: boolean
  workspaceKey: string
  selectedNoteID: string | null
  selectionRequest: number
  setSelectedNoteID: (id: string | null) => void
  openNotes: (id?: string | null) => boolean
  closeNotes: () => void
  adapter: NotesAdapter
  pinnedNotes: NotesNote[]
  pinnedSpaces: NotesSpace[]
  pinnedSpacesError: boolean
  pinnedTotal: number
  pinnedError: boolean
  pinnedLoading: boolean
  directoryChanged: boolean
  connected: boolean
  refreshKey: string
}
const NotesContext = createContext<NotesContextValue | null>(null)

export function useNotesWorkspace() {
  const context = useContext(NotesContext)
  if (!context) throw new Error("NotesProvider is required")
  return context
}

/** Optional client for surfaces that also render without a NotesProvider. */
export function useOptionalNotesWorkspace(): NotesContextValue | null {
  return useContext(NotesContext)
}


/** Optional client: the plugin remains the only source of notes data. */
export function NotesProvider({
  nav,
  children,
}: {
  nav: OpenCodeController
  children: ReactNode
}) {
  const directory = nav.activeSession?.location.directory ?? nav.directory
  const [availableDirectory, setAvailableDirectory] = useState<string | null>(
    null
  )
  const [open, setOpen] = useState(false)
  const [editingDirectory, setEditingDirectory] = useState<string | null>(null)
  const [selectedNoteID, setSelectedNoteID] = useState<string | null>(null)
  const [selectionRequest, setSelectionRequest] = useState(0)
  const [pinnedSnapshot, setPinnedSnapshot] = useState<{
    directory: string
    notes: NotesNote[]
    spaces: NotesSpace[]
    spacesError: boolean
    total: number
    error: boolean
  } | null>(null)
  const pinnedRequest = useRef(0)

  useEffect(() => {
    if (!directory || nav.connection !== "connected") return
    let active = true
    void openCode.plugin.list({ location: { directory } }).then(
      (result) => {
        if (active)
          setAvailableDirectory(
            result.data.some(
              (plugin) =>
                plugin.id === "opencode-notes" &&
                plugin.state.status === "active"
            )
              ? directory
              : null
          )
      },
      () => {
        if (active) setAvailableDirectory(null)
      }
    )
    return () => {
      active = false
    }
  }, [directory, nav.connection, nav.streamStatus])

  const navProjects = nav.projects
  const adapter = useMemo<NotesAdapter>(() => {
    const location = { directory: editingDirectory ?? directory }
    const spaceProjects = new Map<string, string | null>()
    let changeCounter = 0
    const call = async (
      method: string,
      input: Record<string, string | number | boolean | null | { id: string }>
    ) => {
      const result = await openCode.rpc.call({
        rpcID: "opencode-notes",
        method,
        input,
        location,
      })
      return result.output
    }
    const toAttachment = pluginAttachmentToNotes
    const toNote = pluginNoteToNotes
    const projectDirectory = (
      project: (typeof navProjects)[number]
    ): string | null => {
      const record = project as unknown as {
        location?: { directory?: string | null } | null
        canonical?: string | null
      }
      return record.location?.directory ?? record.canonical ?? null
    }
    return {
      async list() {
        const started = changeCounter
        const [spacesResult, first] = await Promise.all([
          call("spaces", {}) as Promise<{ spaces: PluginSpace[] }>,
          call("list", { limit: 1000, offset: 0 }) as Promise<{
            notes: PluginNote[]
            total: number
          }>,
        ])
        const notes = [...first.notes]
        while (notes.length < first.total) {
          const page = (await call("list", {
            limit: 1000,
            offset: notes.length,
          })) as { notes: PluginNote[]; total: number }
          if (!page.notes.length)
            throw new Error(
              "The complete notes list could not be loaded. Refresh and try again."
            )
          notes.push(...page.notes)
        }
        if (
          changeCounter !== started ||
          new Set(notes.map((note) => note.id)).size !== notes.length
        ) {
          throw new Error("Notes changed while loading. Refresh to try again.")
        }
        if (
          notes.some((note) => typeof note.revision !== "number") ||
          spacesResult.spaces.some(
            (space) => typeof space.revision !== "number"
          )
        ) {
          throw new Error(
            "This notes plugin version does not support safe editing. Update the plugin."
          )
        }
        for (const space of spacesResult.spaces)
          spaceProjects.set(space.id, space.project?.id ?? null)
        return {
          notes: notes.map(toNote),
          spaces: spacesResult.spaces.map(pluginSpaceToNotes),
          projects: navProjects.map((project) => ({
            id: project.id,
            name: projectName(project),
            directory: projectDirectory(project),
          })),
          workspaceDirectory: editingDirectory ?? directory ?? "",
        }
      },
      createNote: (input) =>
        call("create", {
          title: input.title,
          body: input.content,
          status: input.status,
          pinned: input.pinned,
          spaceID: input.spaceID,
        }),
      updateNote: (noteID, input, revision) =>
        call("update", {
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
        call("delete", {
          noteID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        }),
      createSpace: (input) =>
        call("createSpace", {
          name: input.name,
          kind: "planning",
          project: input.projectID ? { id: input.projectID } : null,
        }),
      updateSpace: (spaceID, input, revision) => {
        if (!spaceProjects.has(spaceID))
          return Promise.reject(
            new Error("Refresh the space before editing it.")
          )
        return call("updateSpace", {
          spaceID,
          name: input.name,
          ...(spaceProjects.get(spaceID) !== input.projectID
            ? { project: input.projectID ? { id: input.projectID } : null }
            : {}),
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        })
      },
      deleteSpace: (spaceID, revision) =>
        call("deleteSpace", {
          spaceID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        }),
      async createAttachment(noteID, input, revision) {
        const output = (await call("createAttachment", {
          noteID,
          name: input.name,
          mime: input.mime,
          data: input.data,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        })) as { note?: PluginNote; attachment?: PluginAttachment }
        if (!output?.note || !output.attachment)
          throw new Error("Invalid attachment response")
        return {
          note: toNote(output.note),
          attachment: toAttachment(output.attachment),
        }
      },
      async readAttachment(noteID, attachmentID) {
        const output = (await call("readAttachment", {
          noteID,
          attachmentID,
        })) as { attachment?: PluginAttachment; data?: string }
        if (!output?.attachment || typeof output.data !== "string")
          throw new Error("Invalid attachment response")
        return {
          attachment: toAttachment(output.attachment),
          data: output.data,
        }
      },
      async deleteAttachment(noteID, attachmentID, revision) {
        const output = (await call("deleteAttachment", {
          noteID,
          attachmentID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        })) as { note?: PluginNote }
        if (!output?.note) throw new Error("Invalid attachment response")
        return { note: toNote(output.note) }
      },
      subscribe(onChange) {
        const controller = new AbortController()
        void (async () => {
          try {
            for await (const event of openCode.event.subscribe({
              signal: controller.signal,
            })) {
              if (
                event.type === "rpc.opencode-notes.changed" ||
                event.type === "server.connected"
              ) {
                changeCounter++
                onChange()
              }
            }
          } catch {
            /* The next connection refresh reloads the snapshot. */
          }
        })()
        return () => controller.abort()
      },
    }
  }, [directory, editingDirectory, navProjects])

  const available = Boolean(
    directory &&
    availableDirectory === directory &&
    nav.connection === "connected"
  )
  const openNotes = useCallback(
    (id: string | null = null) => {
      if (!available || !directory) {
        if (!editingDirectory || id !== null) return false
        setOpen(true)
        return true
      }
      if (
        editingDirectory &&
        editingDirectory !== directory &&
        !window.confirm(
          "Switch notes project? Unsaved notes in the current workspace will be discarded."
        )
      )
        return false
      setEditingDirectory(directory)
      setSelectedNoteID(id)
      setSelectionRequest((request) => request + 1)
      setOpen(true)
      return true
    },
    [available, directory, editingDirectory]
  )
  const closeNotes = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!available || !directory) return
    let active = true
    const controller = new AbortController()
    const currentRequest = pinnedRequest
    const refresh = async () => {
      const token = ++currentRequest.current
      try {
        const [listResult, spacesResult] = await Promise.allSettled([
          openCode.rpc.call({
            rpcID: "opencode-notes",
            method: "list",
            input: { pinned: true, limit: 5 },
            location: { directory },
          }),
          openCode.rpc.call({
            rpcID: "opencode-notes",
            method: "spaces",
            input: {},
            location: { directory },
          }),
        ])
        if (listResult.status === "rejected") throw listResult.reason
        if (!active || token !== currentRequest.current) return
        const output = listResult.value.output as {
          notes?: PluginNote[]
          total?: number
        }
        if (!Array.isArray(output?.notes) || typeof output.total !== "number")
          throw new Error("Invalid notes response")
        const spacesOutput =
          spacesResult.status === "fulfilled"
            ? (spacesResult.value.output as { spaces?: PluginSpace[] })
            : null
        const spaces = Array.isArray(spacesOutput?.spaces)
          ? spacesOutput.spaces.map(pluginSpaceToNotes)
          : []
        setPinnedSnapshot({
          directory,
          notes: output.notes.map(pluginNoteToNotes),
          spaces,
          spacesError:
            spacesResult.status !== "fulfilled" ||
            !Array.isArray(spacesOutput?.spaces),
          total: output.total,
          error: false,
        })
      } catch {
        if (active && token === currentRequest.current)
          setPinnedSnapshot({
            directory,
            notes: [],
            spaces: [],
            spacesError: true,
            total: 0,
            error: true,
          })
      }
    }
    void refresh()
    void (async () => {
      try {
        for await (const event of openCode.event.subscribe({
          signal: controller.signal,
        })) {
          if (
            event.type === "rpc.opencode-notes.changed" ||
            event.type === "server.connected"
          )
            void refresh()
        }
      } catch {
        /* Reconnect re-runs this effect. */
      }
    })()
    return () => {
      active = false
      currentRequest.current++
      controller.abort()
    }
  }, [available, directory, nav.streamStatus])

  const value: NotesContextValue = {
    available,
    open,
    hasWorkspace: editingDirectory !== null,
    workspaceKey: editingDirectory ?? "",
    selectedNoteID,
    selectionRequest,
    setSelectedNoteID,
    openNotes,
    closeNotes,
    adapter,
    pinnedNotes:
      pinnedSnapshot?.directory === directory ? pinnedSnapshot.notes : [],
    pinnedSpaces:
      pinnedSnapshot?.directory === directory ? pinnedSnapshot.spaces : [],
    pinnedSpacesError:
      pinnedSnapshot?.directory === directory
        ? pinnedSnapshot.spacesError
        : false,
    pinnedTotal:
      pinnedSnapshot?.directory === directory ? pinnedSnapshot.total : 0,
    pinnedError:
      pinnedSnapshot?.directory === directory && pinnedSnapshot.error,
    pinnedLoading: pinnedSnapshot?.directory !== directory,
    directoryChanged: Boolean(
      editingDirectory && editingDirectory !== directory
    ),
    connected: nav.connection === "connected",
    refreshKey: nav.streamStatus,
  }
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
}

export function NotesSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const notes = useNotesWorkspace()
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const unpinReturnFocus = useRef<HTMLElement | null>(null)
  const [unpinTarget, setUnpinTarget] = useState<NotesNote | null>(null)
  const [unpinning, setUnpinning] = useState(false)
  const [unpinError, setUnpinError] = useState<string | null>(null)

  const confirmUnpin = useCallback(async () => {
    const note = unpinTarget
    if (!note || unpinning) return
    setUnpinning(true)
    setUnpinError(null)
    try {
      await notes.adapter.updateNote(
        note.id,
        pinnedNoteInput(note, false),
        note.revision
      )
      setUnpinTarget(null)
    } catch (error) {
      setUnpinError(
        error instanceof Error && error.message.trim()
          ? error.message
          : "The note could not be unpinned."
      )
    } finally {
      setUnpinning(false)
    }
  }, [notes.adapter, unpinTarget, unpinning])

  if (!notes.available && !notes.hasWorkspace) return null

  function pinnedSpaceName(note: NotesNote): string {
    if (note.spaceID === null) return "No space"
    return (
      notes.pinnedSpaces.find((space) => space.id === note.spaceID)?.name ??
      "Space unavailable"
    )
  }

  return (
    <>
      <div ref={sidebarRef}>
        <Accordion
          multiple
          defaultValue={[]}
          aria-label="Notes"
          className="mt-4"
        >
          <AccordionSection
            value="notes"
            title="Notes"
            count={notes.available ? notes.pinnedTotal : undefined}
            contentClassName="space-y-1"
          >
            <Button
              variant="ghost"
              aria-label="All notes"
              aria-current={
                notes.open && !notes.selectedNoteID ? "page" : undefined
              }
              className="h-11 w-full justify-start gap-2"
              onClick={() => {
                if (notes.openNotes()) onNavigate?.()
              }}
            >
              <NotebookPenIcon aria-hidden="true" /> All notes
            </Button>
            <div className="px-2.5 pt-2 text-xs font-medium text-muted-foreground">
              Pinned notes
            </div>
            {!notes.available ? (
              <p
                role="status"
                className="px-2.5 py-2 text-xs text-muted-foreground"
              >
                Pinned notes unavailable.
              </p>
            ) : notes.pinnedLoading ? (
              <p
                role="status"
                className="px-2.5 py-2 text-xs text-muted-foreground"
              >
                Loading pinned notes…
              </p>
            ) : notes.pinnedError ? (
              <p
                role="status"
                className="px-2.5 py-2 text-xs text-muted-foreground"
              >
                Pinned notes unavailable.
              </p>
            ) : notes.pinnedNotes.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                No pinned notes yet.
              </p>
            ) : (
              <ul
                aria-label="Pinned notes"
                className="mt-1 max-h-52 overflow-y-auto"
              >
                {notes.pinnedNotes.map((note) => (
                  <li key={note.id}>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        aria-label={`Unpin “${note.title}”`}
                        title={`Unpin “${note.title}”`}
                        className="size-11 shrink-0 text-muted-foreground"
                        onClick={(event) => {
                          unpinReturnFocus.current = event.currentTarget
                          setUnpinError(null)
                          setUnpinTarget(note)
                        }}
                      >
                        <PinIcon aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-current={
                          notes.open && notes.selectedNoteID === note.id
                            ? "page"
                            : undefined
                        }
                        className="h-auto min-h-11 min-w-0 flex-1 justify-start py-2"
                        onClick={() => {
                          if (notes.openNotes(note.id)) onNavigate?.()
                        }}
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5 text-start">
                          <span className="min-w-0 truncate" dir="auto">
                            {note.title}
                          </span>
                          <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs font-normal text-muted-foreground">
                            <NoteStatusLabel status={note.status} />
                            <span aria-hidden="true">·</span>
                            <span className="min-w-0 truncate">
                              {pinnedSpaceName(note)}
                            </span>
                          </span>
                        </span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {notes.available && notes.pinnedTotal > notes.pinnedNotes.length && (
              <p className="px-2.5 py-1 text-xs text-muted-foreground">
                Showing {notes.pinnedNotes.length} of {notes.pinnedTotal}; open
                all notes to see the rest.
              </p>
            )}
          </AccordionSection>
        </Accordion>
      </div>
      <AlertDialog
        open={unpinTarget !== null}
        onOpenChange={(open) => {
          if (!open && !unpinning) {
            setUnpinTarget(null)
            setUnpinError(null)
          }
        }}
      >
        <AlertDialogContent
          finalFocus={() => {
            const trigger = unpinReturnFocus.current
            if (trigger?.isConnected) return trigger
            return (
              sidebarRef.current?.querySelector<HTMLElement>(
                '[data-slot="accordion-trigger"]'
              ) ?? null
            )
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Unpin note?</AlertDialogTitle>
            <AlertDialogDescription>
              {`“${unpinTarget?.title ?? ""}” will be removed from pinned notes. The note itself is unchanged.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unpinError && (
            <p role="alert" className="text-sm text-destructive">
              Could not unpin the note. {unpinError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unpinning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={unpinning}
              onClick={(event) => {
                event.preventDefault()
                void confirmUnpin()
              }}
            >
              {unpinning ? "Unpinning…" : "Unpin note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function NotesWorkspace() {
  const notes = useNotesWorkspace()
  return (
    <>
      {!notes.connected && (
        <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">
          Connection unavailable. Your open draft is retained; reconnect before
          saving.
        </p>
      )}
      {notes.directoryChanged && (
        <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">
          This workspace remains connected to the project where it was opened.
        </p>
      )}
      <NotesPanel
        key={notes.workspaceKey}
        adapter={notes.adapter}
        refreshKey={notes.refreshKey}
        selectedNoteID={notes.selectedNoteID}
        selectionRequest={notes.selectionRequest}
        onSelectedNoteChange={notes.setSelectedNoteID}
      />
    </>
  )
}
