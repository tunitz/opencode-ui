import {
  Component,
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
import { useAuthGate } from "@/components/auth-context"
import {
  NotesPanel,
  pinnedNoteInput,
  type NotesAdapter,
  type NotesNote,
  type NotesSpace,
} from "@/components/notes-panel"
import { NoteStatusLabel } from "@/components/note-status-label"
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
import {
  createNotesAdapter,
  listNotesScoped,
  listSpacesScoped,
  setNotesAuthHandler,
  subscribeNotesEvents,
} from "@/lib/notes-api"
import { uniqueByID } from "@/lib/notes-types"
import { useNotesPluginState } from "@/lib/notes-plugin-state"
import { useOptionalWorkspace } from "@/components/workspace-context"
import type { OpenCodeController } from "@/lib/use-opencode"

const PINNED_PREVIEW_LIMIT = 5
// Matches the notes service LIMITS.list maximum, so "Show more" returns every
// pinned note the service can list in a single page.
const PINNED_EXPANDED_LIMIT = 1_000

export type NotesContextValue = {
  /** Notes surfaces are allowed: true while the plugin state is unknown. */
  notesEnabled: boolean
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
  refreshPinned: () => void
  pinnedExpanded: boolean
  setPinnedExpanded: (expanded: boolean) => void
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

/**
 * `useAuthGate` throws without an AuthGateProvider. Notes also mount in
 * isolated fixtures and tests, so a missing gate must not take the workspace
 * down; in the app the provider is always present inside App.
 */
class OptionalAuthBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Surfaces a mid-session 401 from the notes API through the auth gate. */
function NotesAuthBridge() {
  const { signalUnauthorized } = useAuthGate()
  useEffect(() => {
    setNotesAuthHandler(signalUnauthorized)
    return () => setNotesAuthHandler(null)
  }, [signalUnauthorized])
  return null
}

/**
 * Notes are served by the UI server, but the Notes plugin registry decides
 * whether the surfaces are offered. Only a definitive `registered: false`
 * hides them; an unreadable registry stays optimistic.
 */
export function NotesProvider({
  nav,
  children,
}: {
  nav: OpenCodeController
  children: ReactNode
}) {
  const pluginState = useNotesPluginState()
  const notesEnabled = pluginState.registered !== false
  const workspace = useOptionalWorkspace()
  const directory = nav.activeSession?.location.directory ?? nav.directory
  // Without an app-shell coordinator (isolated fixtures) Notes keeps its own
  // open flag; inside the shell the shared discriminator is authoritative.
  const [localOpen, setLocalOpen] = useState(false)
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
  const [pinnedRequest, setPinnedRequest] = useState(0)
  const [pinnedExpanded, setPinnedExpanded] = useState(false)

  // One adapter per directory. Drafts are kept in a map keyed by adapter, so a
  // cached adapter is what lets drafts survive leaving a project and returning.
  const [adapters] = useState(() => new Map<string, NotesAdapter>())
  const workspaceDirectory = editingDirectory ?? directory ?? ""
  const adapter = useMemo(() => {
    const existing = adapters.get(workspaceDirectory)
    if (existing) return existing
    const created = createNotesAdapter(workspaceDirectory)
    adapters.set(workspaceDirectory, created)
    return created
  }, [adapters, workspaceDirectory])

  const refreshPinned = useCallback(
    () => setPinnedRequest((request) => request + 1),
    []
  )

  useEffect(() => {
    if (!notesEnabled) return
    let active = true
    let token = 0
    const load = async () => {
      const current = ++token
      try {
        const [listResult, spacesResult] = await Promise.allSettled([
          listNotesScoped(null, {
            pinned: true,
            limit: pinnedExpanded ? PINNED_EXPANDED_LIMIT : PINNED_PREVIEW_LIMIT,
          }),
          listSpacesScoped(null),
        ])
        if (listResult.status === "rejected") throw listResult.reason
        if (!active || current !== token) return
        setPinnedSnapshot({
          directory: "all",
          notes: uniqueByID(listResult.value.notes),
          spaces:
            spacesResult.status === "fulfilled"
              ? uniqueByID(spacesResult.value)
              : [],
          spacesError: spacesResult.status !== "fulfilled",
          total: listResult.value.total,
          error: false,
        })
      } catch {
        if (active && current === token)
          setPinnedSnapshot({
            directory: "all",
            notes: [],
            spaces: [],
            spacesError: true,
            total: 0,
            error: true,
          })
      }
    }
    void load()
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = subscribeNotesEvents(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (active) void load()
      }, 250)
    })
    return () => {
      active = false
      token++
      if (timer) clearTimeout(timer)
      stop()
    }
  }, [pinnedRequest, notesEnabled, pinnedExpanded])

  const available = notesEnabled && Boolean(directory)
  const showWorkspace = notesEnabled && (workspace
    ? workspace.active === "notes"
    : localOpen)
  const openNotes = useCallback(
    (id: string | null = null) => {
      if (!directory || !notesEnabled) return false
      // No prompt: drafts stay with their project's adapter and come back.
      const commit = () => {
        setEditingDirectory(directory)
        setSelectedNoteID(id)
        setSelectionRequest((request) => request + 1)
        if (!workspace) setLocalOpen(true)
      }
      if (workspace) {
        // A dirty Settings workspace may hold this transition until confirmed;
        // the caller can still close its own menu because the request queued.
        return workspace.requestWorkspace("notes", { onCommit: commit })
      }
      commit()
      return true
    },
    [directory, notesEnabled, workspace]
  )
  const closeNotes = useCallback(() => {
    if (workspace) {
      workspace.requestWorkspace("chat")
      return
    }
    setLocalOpen(false)
  }, [workspace])

  // Disabling the plugin closes the workspace on the same transition, so no
  // Notes pane or header title can outlive the registry state. Depend only on
  // the active workspace and the stable force action: a pending confirmation or
  // another workspace's transition must not re-run this reconciliation.
  const workspaceActive = workspace?.active
  const forceWorkspace = workspace?.forceWorkspace
  useEffect(() => {
    if (notesEnabled) return
    /* eslint-disable react-hooks/set-state-in-effect -- reconcile external workspace state with the plugin registry */
    if (forceWorkspace) {
      if (workspaceActive === "notes") forceWorkspace("chat")
    } else {
      setLocalOpen(false)
    }
    setEditingDirectory(null)
    setSelectedNoteID(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [forceWorkspace, notesEnabled, workspaceActive])

  const value: NotesContextValue = {
    notesEnabled,
    available,
    open: showWorkspace,
    hasWorkspace: notesEnabled && editingDirectory !== null,
    workspaceKey: editingDirectory ?? "",
    selectedNoteID,
    selectionRequest,
    setSelectedNoteID,
    openNotes,
    closeNotes,
    adapter,
    pinnedNotes: pinnedSnapshot?.notes ?? [],
    pinnedSpaces: pinnedSnapshot?.spaces ?? [],
    pinnedSpacesError: pinnedSnapshot?.spacesError ?? false,
    pinnedTotal: pinnedSnapshot?.total ?? 0,
    pinnedError: pinnedSnapshot?.error ?? false,
    pinnedLoading: pinnedSnapshot === null,
    directoryChanged: Boolean(
      editingDirectory && editingDirectory !== directory
    ),
    connected: nav.connection === "connected",
    refreshKey: "",
    refreshPinned,
    pinnedExpanded,
    setPinnedExpanded,
  }
  return (
    <NotesContext.Provider value={value}>
      <OptionalAuthBoundary>
        <NotesAuthBridge />
      </OptionalAuthBoundary>
      {children}
    </NotesContext.Provider>
  )
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
      notes.refreshPinned()
    } catch (error) {
      setUnpinError(
        error instanceof Error && error.message.trim()
          ? error.message
          : "The note could not be unpinned."
      )
    } finally {
      setUnpinning(false)
    }
  }, [notes, unpinTarget, unpinning])

  if (!notes.notesEnabled) return null
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
              <div className="grid gap-1 px-2.5 py-2">
                <p role="status" className="text-xs text-muted-foreground">
                  Pinned notes unavailable.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-fit px-2 text-xs"
                  onClick={() => notes.refreshPinned()}
                >
                  Retry
                </Button>
              </div>
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
            {notes.available &&
            !notes.pinnedLoading &&
            !notes.pinnedError &&
            notes.pinnedTotal > PINNED_PREVIEW_LIMIT ? (
              <Button
                type="button"
                variant="ghost"
                aria-label={
                  notes.pinnedExpanded
                    ? "Show less"
                    : `Show ${notes.pinnedTotal - notes.pinnedNotes.length} more`
                }
                aria-expanded={notes.pinnedExpanded}
                className="h-11 w-full justify-start px-2.5 text-xs text-muted-foreground"
                onClick={() =>
                  notes.setPinnedExpanded(!notes.pinnedExpanded)
                }
              >
                {notes.pinnedExpanded
                  ? "Show less"
                  : `Show ${notes.pinnedTotal - notes.pinnedNotes.length} more`}
              </Button>
            ) : null}
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
  if (!notes.notesEnabled) return null
  return (
    <>
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
