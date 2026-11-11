import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  ChevronRightIcon,
  EllipsisIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  PinIcon,
  RotateCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

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
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { NewSessionButton } from "@/components/new-session-dialog"
import { NotesSidebar, useNotesWorkspace } from "@/components/notes-sidebar"
import { IntegrationCommandDialogs } from "@/components/integration-command-dialogs"
import {
  SettingsButton,
  SettingsTriggerButton,
} from "@/components/settings-workspace"
import { useOptionalSettingsWorkspace } from "@/components/settings-context"
import { projectName } from "@/components/project-select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppDirection } from "@/components/app-direction"
import type { Project, SessionInfo } from "@/lib/opencode"
import {
  SESSION_GROUPS,
  sessionGroupForID,
  type SessionGroup,
} from "@/lib/session-activity"
import {
  countSessionTreeDescendants,
  groupSessionTreeRows,
  sessionAncestorIDs,
  sessionTreeRows,
  type SessionTreeRow,
} from "@/lib/session-tree"
import type { OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"
import { DESKTOP_SIDEBAR_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "@/lib/sidebar-layout"
import { recordPerfRender } from "@/lib/perf-probe"
import type { SessionShortcuts, SessionShortcut } from "@/lib/session-shortcuts"
import { useSessionShortcuts } from "@/lib/use-session-shortcuts"
import { worktreeNavigationProject } from "@/lib/worktree-navigation"

export type SessionNavProps = OpenCodeController

const SIDEBAR_COLLAPSED_KEY = "opencode-ui:desktop-sidebar-collapsed"

function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}
function ConnectionRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <Button
      variant="outline"
      onClick={onRetry}
      className="h-11 w-full justify-start gap-2 text-[13px]"
    >
      <RotateCwIcon aria-hidden="true" className="size-4" />
      Retry connection
    </Button>
  )
}

function ProjectPanel({
  nav,
  className,
}: {
  nav: SessionNavProps
  className?: string
}) {
  if (
    nav.connection !== "offline" &&
    !nav.projectError &&
    !nav.projectsError &&
    !nav.directoryError
  ) return null

  return (
    <div className={cn("shrink-0 space-y-1.5 px-5", className)}>
      {nav.connection === "offline" ? (
        <div className="space-y-1.5">
          <ConnectionRetry onRetry={nav.retryConnection} />
          {nav.connectionError ? (
            <p role="alert" className="text-xs break-words text-destructive">
              {nav.connectionError}
            </p>
          ) : null}
        </div>
      ) : null}
      {nav.projectError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {nav.projectError}
        </p>
      ) : null}
      {nav.projectsError ? (
        <div role="alert" className="space-y-1.5">
          <p className="text-xs break-words text-destructive">
            {nav.projectsError}
          </p>
          <Button
            variant="outline"
            onClick={nav.retryProjects}
            className="h-11 w-full text-[13px]"
          >
            Reload projects
          </Button>
        </div>
      ) : null}
      {nav.directoryError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {nav.directoryError}
        </p>
      ) : null}
    </div>
  )
}

function sessionProjectLabel(session: SessionInfo, projects: Project[]) {
  const listed = projects.find((project) => project.id === session.projectID)

  if (listed) {
    return projectName(listed)
  }

  return (
    session.location?.directory?.split("/").filter(Boolean).at(-1) ??
    session.projectID
  )
}

function SessionRow({
  session,
  active,
  running,
  unread,
  scopeLabel,
  descendantCount,
  expandControl,
  onSelect,
  onRename,
  onDelete,
  shortcut,
  onShortcut,
}: {
  session: SessionInfo
  active: boolean
  running: boolean
  unread: boolean
  scopeLabel?: string
  descendantCount: number
  expandControl?: ReactNode
  onSelect: (sessionID: string) => void
  onRename: (sessionID: string, title: string) => Promise<string | null>
  onDelete: (sessionID: string) => Promise<string | null>
  shortcut?: SessionShortcut
  onShortcut: (sessionID: string, change: Partial<SessionShortcut>) => boolean
}) {
  const title = session.title?.trim() || session.id
  const [renameOpen, setRenameOpen] = useState(false)
  const [draft, setDraft] = useState(title)
  const [renamePending, setRenamePending] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const [labelOpen, setLabelOpen] = useState(false)
  const [labelDraft, setLabelDraft] = useState("")
  const [labelError, setLabelError] = useState(false)

  const trimmedDraft = draft.trim()
  const canSave =
    trimmedDraft.length > 0 &&
    trimmedDraft !== title &&
    !renamePending

  function openRename() {
    setDraft(title)
    setRenameError(null)
    setRenameOpen(true)
  }

  function openDelete() {
    setDeleteError(null)
    setDeleteOpen(true)
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSave) {
      return
    }

    setRenamePending(true)
    setRenameError(null)
    const failure = await onRename(session.id, trimmedDraft)
    setRenamePending(false)

    if (failure) {
      setRenameError(failure)
      return
    }

    setRenameOpen(false)
  }

  async function submitDelete() {
    if (deletePending) {
      return
    }

    setDeletePending(true)
    setDeleteError(null)
    const failure = await onDelete(session.id)
    setDeletePending(false)

    if (failure) {
      setDeleteError(failure)
      return
    }

    setDeleteOpen(false)
  }

  return (
    <div className="flex items-stretch gap-0.5">
      <Button
        variant="ghost"
        aria-current={active ? "page" : undefined}
        title={session.id}
        onClick={() => onSelect(session.id)}
        className={cn(
          "session-nav-item h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-lg py-1.5 ps-2.5 pe-2 text-start font-normal text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          active &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span dir="auto" className="min-w-0 flex-1 truncate text-[13px]">
            {title}
          </span>
          {running ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
          ) : null}
          {unread ? (
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          ) : null}
        </span>
        {running || unread ? (
          <span className="sr-only">
            {[running ? "Running" : null, unread ? "New activity" : null]
              .filter(Boolean)
              .join(". ")}
          </span>
        ) : null}
        {scopeLabel || session.title?.trim() || descendantCount > 0 ? (
          <span className="flex w-full min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
            <span dir="ltr" className="min-w-0 truncate font-mono">
              {scopeLabel ?? session.id}
            </span>
            {descendantCount > 0 ? (
              <span className="shrink-0">
                {descendantCount} loaded {descendantCount === 1 ? "subagent" : "subagents"}
              </span>
            ) : null}
          </span>
        ) : null}
        {shortcut?.label ? <span dir="auto" className="max-w-full truncate text-[10px] text-muted-foreground">{shortcut.label}</span> : null}
      </Button>
      {expandControl}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              ref={actionsRef}
              variant="ghost"
              size="icon-lg"
              aria-label={`Session actions: ${title}`}
              className="size-11 shrink-0 self-center rounded-lg text-muted-foreground"
            />
          }
        >
          <EllipsisIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          aria-label={`Actions for ${title}`}
          className="w-auto min-w-44"
        >
          <DropdownMenuItem onClick={() => onShortcut(session.id, { pinned: !shortcut?.pinned })}>
            <PinIcon aria-hidden="true" />
            {shortcut?.pinned ? "Unpin session" : "Pin session"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setLabelDraft(shortcut?.label ?? ""); setLabelError(false); setLabelOpen(true) }}>
            <PencilIcon aria-hidden="true" /> Edit local label
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openRename}>
            <PencilIcon aria-hidden="true" />
            Rename session
            <span className="sr-only"> for {title}</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={openDelete}>
            <Trash2Icon aria-hidden="true" />
            Delete session
            <span className="sr-only"> for {title}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <ResponsiveDialogContent showCloseButton={false} className="gap-4 p-5 md:max-w-md" finalFocus={() => {
          const actions = actionsRef.current
          if (actions?.isConnected && actions.getClientRects().length) return actions
          const trigger = document.querySelector<HTMLButtonElement>("[data-sessions-sheet-trigger]")
          return trigger?.getClientRects().length ? trigger : null
        }}>
          <DialogHeader><DialogTitle>Edit local label</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault()
            if (onShortcut(session.id, { label: labelDraft })) setLabelOpen(false)
            else setLabelError(true)
          }}>
            <p className="text-xs text-muted-foreground">Only saved in this browser. Clear the field to remove the label.</p>
            <Input aria-label="Local session label" maxLength={60} value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} className="h-11" />
            {labelError ? <p role="alert" className="text-xs text-destructive">Could not save the label in this browser.</p> : null}
            <DialogFooter className="mt-0 flex-row justify-end gap-2">
              <DialogClose render={<Button type="button" variant="outline" className="h-11 px-4" />}>Cancel</DialogClose>
              <Button type="submit" className="h-11 px-4">Save label</Button>
            </DialogFooter>
          </form>
        </ResponsiveDialogContent>
      </Dialog>
      <Dialog
        open={renameOpen}
        onOpenChange={(next) => {
          if (!next && renamePending) {
            return
          }

          setRenameOpen(next)

          if (!next) {
            setRenameError(null)
          }
        }}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          className="gap-4 p-5 md:max-w-md"
          finalFocus={() => {
            const actions = actionsRef.current
            if (actions?.isConnected && actions.getClientRects().length) return actions
            const mobileTrigger = document.querySelector<HTMLButtonElement>("[data-sessions-sheet-trigger]")
            return mobileTrigger?.getClientRects().length ? mobileTrigger : null
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-3">
            <Input
              aria-label="Session name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={renamePending}
              aria-invalid={trimmedDraft.length === 0}
              className="h-11"
            />
            {trimmedDraft.length === 0 ? (
              <p className="text-xs text-destructive">
                Session name cannot be empty.
              </p>
            ) : null}
            {renameError ? (
              <p role="alert" className="text-xs break-words text-destructive">
                {renameError}
              </p>
            ) : null}
            <DialogFooter className="mt-0 flex-row justify-end gap-2">
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={renamePending}
                  />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type="submit"
                className="h-11 px-4"
                disabled={!canSave}
                aria-busy={renamePending}
              >
                {renamePending ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </ResponsiveDialogContent>
      </Dialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!next && deletePending) {
            return
          }

          setDeleteOpen(next)

          if (!next) {
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” and its child sessions will be permanently deleted. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-xs break-words text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void submitDelete()}
              disabled={deletePending}
              aria-busy={deletePending}
            >
              {deletePending ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : null}
              Delete session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type SessionTreeProps = {
  rows: readonly SessionTreeRow<SessionInfo>[]
  activeSessionID: string | null
  runningSessionIDs: Record<string, true>
  unreadSessionIDs: Record<string, true>
  projects: Project[]
  expandedIDs: ReadonlySet<string>
  onToggle: (sessionID: string) => void
  onSelect: (sessionID: string) => void
  onRename: (sessionID: string, title: string) => Promise<string | null>
  onDelete: (sessionID: string) => Promise<string | null>
  shortcuts: SessionShortcuts
  onShortcut: (sessionID: string, change: Partial<SessionShortcut>) => boolean
}

type SessionTreeContext = Omit<SessionTreeProps, "rows">

function SessionTree({ rows, ...context }: SessionTreeProps) {
  return (
    <div>
      {rows.map((row) => (
        <SessionTreeNode key={row.session.id} row={row} {...context} />
      ))}
    </div>
  )
}

function SessionTreeNode({
  row,
  activeSessionID,
  runningSessionIDs,
  unreadSessionIDs,
  projects,
  expandedIDs,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  shortcuts,
  onShortcut,
}: { row: SessionTreeRow<SessionInfo> } & SessionTreeContext) {
  const { session, children } = row
  const title = session.title?.trim() || session.id
  const hasChildren = children.length > 0
  const expanded = hasChildren && expandedIDs.has(session.id)
  const childrenID = `session-subtree-${session.id}`
  const descendants = hasChildren ? countSessionTreeDescendants(row) : 0

  return (
    <div>
      <SessionRow
        session={session}
        active={session.id === activeSessionID}
        running={Boolean(runningSessionIDs[session.id])}
        unread={Boolean(unreadSessionIDs[session.id])}
        scopeLabel={sessionProjectLabel(session, projects)}
        descendantCount={descendants}
        expandControl={
          hasChildren ? (
            <Button
              variant="ghost"
              aria-expanded={expanded}
              aria-controls={expanded ? childrenID : undefined}
              aria-label={`${expanded ? "Hide" : "Show"} ${descendants} loaded subagent ${
                descendants === 1 ? "session" : "sessions"
              } for ${title}`}
              onClick={() => onToggle(session.id)}
              className="size-11 shrink-0 self-center rounded-lg text-muted-foreground"
            >
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  expanded && "rotate-90"
                )}
              />
            </Button>
          ) : null
        }
        onSelect={onSelect}
        onRename={onRename}
        onDelete={onDelete}
        shortcut={shortcuts[session.id]}
        onShortcut={onShortcut}
      />
      {expanded ? (
        <div
          id={childrenID}
          className="ms-3 border-s border-sidebar-border ps-1"
        >
          {children.map((child) => (
            <SessionTreeNode
              key={child.session.id}
              row={child}
              activeSessionID={activeSessionID}
              runningSessionIDs={runningSessionIDs}
              unreadSessionIDs={unreadSessionIDs}
              projects={projects}
              expandedIDs={expandedIDs}
              onToggle={onToggle}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              shortcuts={shortcuts}
              onShortcut={onShortcut}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

type SessionSearchResult = {
  session: SessionInfo
  scope: string
  text: string
}

const SessionSearchRow = memo(function SessionSearchRow({
  result,
  active,
  running,
  unread,
  onSelect,
}: {
  result: SessionSearchResult
  active: boolean
  running: boolean
  unread: boolean
  onSelect: (sessionID: string) => void
}) {
  const { session, scope } = result
  const title = session.title?.trim() || session.id

  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={session.id}
      onClick={() => onSelect(session.id)}
      className={cn(
        "session-nav-item flex min-h-11 w-full min-w-0 flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 py-1.5 text-start font-normal text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span dir="auto" className="min-w-0 flex-1 truncate text-[13px]">
          {title}
        </span>
        {running ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
          />
        ) : null}
        {unread ? (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        ) : null}
      </span>
      {running || unread ? (
        <span className="sr-only">
          {[running ? "Running" : null, unread ? "New activity" : null]
            .filter(Boolean)
            .join(". ")}
        </span>
      ) : null}
      <span className="flex w-full min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
        <span dir="ltr" className="min-w-0 truncate font-mono">
          {scope || session.id}
        </span>
      </span>
    </button>
  )
})

const SessionSearchResults = memo(function SessionSearchResults({
  results,
  activeSessionID,
  runningSessionIDs,
  unreadSessionIDs,
  onSelect,
}: {
  results: readonly SessionSearchResult[]
  activeSessionID: string | null
  runningSessionIDs: Record<string, true>
  unreadSessionIDs: Record<string, true>
  onSelect: (sessionID: string) => void
}) {
  return (
    <div className="space-y-0.5" aria-label="Session search results">
      {results.map((result) => (
        <SessionSearchRow
          key={result.session.id}
          result={result}
          active={result.session.id === activeSessionID}
          running={Boolean(runningSessionIDs[result.session.id])}
          unread={Boolean(unreadSessionIDs[result.session.id])}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
})

function currentDayStart(): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today.getTime()
}

/**
 * Day-bucket boundaries are an external clock value, not render state. Reading
 * them through `useSyncExternalStore` keeps render pure and refreshes the
 * accordion after midnight without a state-setting effect.
 */
function subscribeToDayStart(onStoreChange: () => void): () => void {
  let observed = currentDayStart()
  const timer = setInterval(() => {
    const next = currentDayStart()

    if (next !== observed) {
      observed = next
      onStoreChange()
    }
  }, 60_000)

  return () => clearInterval(timer)
}

function SessionList({
  nav,
  onSelect = nav.selectSession,
}: {
  nav: SessionNavProps
  onSelect?: (sessionID: string) => void
}) {
  const notes = useNotesWorkspace()
  const { shortcuts, update: updateShortcut, error: shortcutError } = useSessionShortcuts(nav.serverVersion)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [archivedOpen, setArchivedOpen] = useState(false)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  const handleSelect = useCallback(
    (sessionID: string) => onSelectRef.current(sessionID),
    []
  )
  const searchQuery = query.trim()
  const searching = searchQuery.length > 0
  const deferredQuery = useDeferredValue(searchQuery)
  const pendingSearch = searching && deferredQuery !== searchQuery
  const dayStart = useSyncExternalStore(
    subscribeToDayStart,
    currentDayStart,
    currentDayStart
  )
  const sortedSessions = useMemo(
    () => [...nav.sessions].sort((a, b) => b.time.updated - a.time.updated),
    [nav.sessions]
  )
  const treeRows = useMemo(
    () => sessionTreeRows(sortedSessions),
    [sortedSessions]
  )
  const pinnedRows = useMemo(
    () =>
      sessionTreeRows(
        sortedSessions.filter((session) => shortcuts[session.id]?.pinned)
      ),
    [sortedSessions, shortcuts]
  )
  const groups = useMemo(
    () => groupSessionTreeRows(treeRows, dayStart),
    [treeRows, dayStart]
  )
  const searchIndex = useMemo(
    () =>
      [...nav.sessions]
        .sort((a, b) => b.time.updated - a.time.updated)
        .map((session) => {
          const scope = sessionProjectLabel(session, nav.projects)
          const localLabel = shortcuts[session.id]?.label ?? ""
          return {
            session,
            scope,
            text: [session.title, session.id, scope, localLabel]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase(),
          }
        }),
    [nav.projects, nav.sessions, shortcuts]
  )
  const searchResults = useMemo(() => {
    if (!deferredQuery) return []
    const words = deferredQuery.toLocaleLowerCase().split(/\s+/)
    return searchIndex.filter(({ text }) =>
      words.every((word) => text.includes(word))
    )
  }, [deferredQuery, searchIndex])
  const activeAncestors = useMemo(
    () => sessionAncestorIDs(nav.sessions, nav.activeSessionID),
    [nav.sessions, nav.activeSessionID]
  )
  const activeGroup = sessionGroupForID(
    nav.sessions,
    // A nested session's group is its top-level parent's group, which is the
    // panel the tree row actually renders in.
    activeAncestors.at(-1) ?? nav.activeSessionID,
    dayStart
  )
  const [openGroup, setOpenGroup] = useState<SessionGroup | null>(activeGroup)
  const lastActiveGroup = useRef<SessionGroup | null>(activeGroup)
  const [expandedIDs, setExpandedIDs] = useState<ReadonlySet<string>>(() => new Set())

  // The selected session's group is the default-open panel; every other group
  // starts closed. Moving the selection to another group opens that group and
  // collapses the previous one. A manual collapse is preserved until selection
  // actually moves.
  useEffect(() => {
    if (!activeGroup) {
      lastActiveGroup.current = null
      return
    }

    if (activeGroup === lastActiveGroup.current) {
      return
    }

    lastActiveGroup.current = activeGroup
    setOpenGroup(activeGroup)
  }, [activeGroup])

  function toggleSessionTree(sessionID: string) {
    setExpandedIDs((current) => {
      const next = new Set(current)

      if (next.has(sessionID)) {
        next.delete(sessionID)
      } else {
        next.add(sessionID)
      }

      return next
    })
  }

  function closeSearch() {
    setSearchOpen(false)
    setQuery("")
  }

  return (
    <>
      <SessionsHeader
        count={
          nav.sessionsStatus === "ready"
            ? searching
              ? searchResults.length
              : nav.sessions.length
            : null
        }
        searchOpen={searchOpen}
        query={query}
        onOpenSearch={() => setSearchOpen(true)}
        onChangeQuery={setQuery}
        onCloseSearch={closeSearch}
      />
      <div className="px-3">
        <nav aria-label="Sessions" aria-busy={nav.sessionsStatus === "loading"}>
          {shortcutError ? <p role="alert" className="px-2.5 text-xs text-destructive">{shortcutError}</p> : null}
          {nav.sessionsStatus === "loading" ? (
            <p role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">
              Loading sessions…
            </p>
          ) : null}
          {nav.sessionsStatus === "error" ? (
            <div role="alert" className="space-y-2 px-2.5 py-1.5">
              <p className="text-xs break-words text-destructive">
                {nav.sessionsError ?? "Could not load sessions."}
              </p>
              <Button
                variant="outline"
                onClick={nav.refreshSessions}
                className="h-11 w-full text-[13px]"
              >
                Retry sessions
              </Button>
            </div>
          ) : null}
          {nav.sessionsStatus === "ready" && nav.sessions.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
              No sessions yet.
            </p>
          ) : null}
          {nav.sessionsStatus === "ready" && searching && nav.sessions.length > 0 ? (
            <Accordion
              multiple
              defaultValue={["search-results"]}
              className="mt-2 space-y-2 py-1"
            >
              <AccordionSection
                value="search-results"
                title="Search results"
                count={searchResults.length}
                contentClassName="p-1"
              >
                {searchResults.length > 0 ? (
                  <SessionSearchResults
                    results={searchResults}
                    activeSessionID={notes.open ? null : nav.activeSessionID}
                    runningSessionIDs={nav.runningSessionIDs}
                    unreadSessionIDs={nav.unreadSessionIDs}
                    onSelect={handleSelect}
                  />
                ) : pendingSearch ? null : (
                  <p
                    role="status"
                    className="px-2.5 py-2 text-[13px] break-words text-muted-foreground"
                  >
                    No sessions match “{searchQuery}”.
                  </p>
                )}
              </AccordionSection>
            </Accordion>
          ) : null}
          {!searching && pinnedRows.length > 0 ? (
            <Accordion className="space-y-2 py-1">
              <AccordionSection
                value="pinned"
                title="Pinned sessions"
                count={pinnedRows.length}
                contentClassName="p-1"
              >
                <SessionTree
                  rows={pinnedRows}
                  activeSessionID={notes.open ? null : nav.activeSessionID}
                  runningSessionIDs={nav.runningSessionIDs}
                  unreadSessionIDs={nav.unreadSessionIDs}
                  projects={nav.projects}
                  expandedIDs={expandedIDs}
                  onToggle={toggleSessionTree}
                  onSelect={handleSelect}
                  onRename={nav.renameSession}
                  onDelete={nav.deleteSession}
                  shortcuts={shortcuts}
                  onShortcut={updateShortcut}
                />
              </AccordionSection>
            </Accordion>
          ) : null}
          {!searching ? (
            <Accordion
              key="date-groups"
              value={openGroup ? [openGroup] : []}
              onValueChange={(value) => {
                const next = value[0]
                setOpenGroup(
                  next && SESSION_GROUPS.includes(next as SessionGroup)
                    ? (next as SessionGroup)
                    : null
                )
              }}
              className="space-y-2 py-1"
            >
              {SESSION_GROUPS.map((label) => {
                const rows = groups[label]

                if (!rows.length) {
                  return null
                }

                return (
                  <AccordionSection
                    key={label}
                    value={label}
                    title={label}
                    count={rows.length}
                    contentClassName="p-1"
                  >
                    <SessionTree
                      rows={rows}
                      activeSessionID={notes.open ? null : nav.activeSessionID}
                      runningSessionIDs={nav.runningSessionIDs}
                      unreadSessionIDs={nav.unreadSessionIDs}
                      projects={nav.projects}
                      expandedIDs={expandedIDs}
                      onToggle={toggleSessionTree}
                      onSelect={handleSelect}
                      onRename={nav.renameSession}
                      onDelete={nav.deleteSession}
                      shortcuts={shortcuts}
                      onShortcut={updateShortcut}
                    />
                  </AccordionSection>
                )
              })}
            </Accordion>
          ) : null}
          {!searching ? (
            <Accordion
              key="archived"
              value={archivedOpen ? ["archived"] : []}
              onValueChange={(value) => {
                const next = value.includes("archived")
                setArchivedOpen(next)
                if (next) void nav.loadArchivedSessions()
              }}
              className="mt-2 space-y-2 pb-3"
            >
              <AccordionSection
                value="archived"
                title="Archived"
                count={nav.archivedStatus === "loading" ? undefined : nav.archivedSessions.length}
                contentClassName="p-1"
              >
                {nav.archivedStatus === "error" ? (
                  <div role="alert" className="space-y-1 px-2 py-1 text-xs text-destructive">
                    <p className="break-words">{nav.archivedError ?? "Could not load archived sessions."}</p>
                    <Button variant="outline" className="h-11 px-3 text-xs" onClick={() => void nav.loadArchivedSessions()}>
                      Retry
                    </Button>
                  </div>
                ) : null}
                {nav.archivedStatus === "loading" && nav.archivedSessions.length === 0 ? (
                  <p role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">
                    Loading archived sessions…
                  </p>
                ) : null}
                {nav.archivedSessions.length === 0 && (nav.archivedStatus === "ready" || nav.archivedStatus === "idle") ? (
                  <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
                    No archived sessions in this scope.
                  </p>
                ) : null}
                <ul className="space-y-0.5" aria-label="Archived sessions">
                  {nav.archivedSessions.map((session) => (
                    <li key={session.id} className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 min-w-0 flex-1 justify-start px-2.5 text-start font-normal"
                        title={session.id}
                        onClick={() => void nav.openSessionByID(session.id)}
                      >
                        <span dir="auto" className="min-w-0 truncate text-[13px]">
                          {session.title?.trim() || session.id}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 shrink-0 px-2 text-[11px]"
                        onClick={() => void nav.unarchiveSession(session.id)}
                      >
                        Unarchive
                      </Button>
                    </li>
                  ))}
                </ul>
              </AccordionSection>
            </Accordion>
          ) : null}
        </nav>
      </div>
    </>
  )
}

function SessionsHeader({
  count,
  searchOpen,
  query,
  onOpenSearch,
  onChangeQuery,
  onCloseSearch,
}: {
  count: number | null
  searchOpen: boolean
  query: string
  onOpenSearch: () => void
  onChangeQuery: (value: string) => void
  onCloseSearch: () => void
}) {
  return (
    <div className="mt-5 flex shrink-0 items-center justify-between gap-2 px-5">
      {searchOpen ? (
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            aria-label="Search sessions"
            placeholder="Search sessions"
            value={query}
            onChange={(event) => onChangeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                event.nativeEvent.stopImmediatePropagation()
                onCloseSearch()
              }
            }}
            className="h-11 w-full ps-8 pe-11 text-[13px]"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear session search"
            className="absolute end-0 top-1/2 size-11 -translate-y-1/2 rounded-md text-muted-foreground"
            onClick={onCloseSearch}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <span className="text-xs font-medium text-muted-foreground">
            Sessions
          </span>
          <div className="flex min-w-0 items-center gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">
              {count ?? "—"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Search sessions"
              className="size-11 rounded-md text-muted-foreground"
              onClick={onOpenSearch}
            >
              <SearchIcon className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function SessionSidebar({ nav }: { nav: SessionNavProps }) {
  recordPerfRender("SessionSidebar")
  const notes = useNotesWorkspace()
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const [worktreeProjectID, setWorktreeProjectID] = useState<string | null>(null)
  const projectID = worktreeNavigationProject(nav.scope, nav.location?.project.id, nav.activeSession?.projectID)

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
    } catch {
      // A blocked storage API must not break navigation.
    }
  }

  return (
    <aside
      data-sidebar="sessions"
      style={{ backgroundColor: "var(--sidebar)" }}
      className={cn(
        "hidden h-svh shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none md:flex",
        collapsed ? DESKTOP_SIDEBAR_RAIL_WIDTH : DESKTOP_SIDEBAR_WIDTH
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center px-1" : "gap-2 px-5")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                  onClick={toggleSidebar}
                  className="size-11 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
                />
              }
            >
              <PanelLeftOpenIcon aria-hidden="true" className="size-5" />
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background ring-1 ring-foreground/10"
            >
              <svg viewBox="0 0 32 32" className="size-4" fill="none">
                <path d="M12 10l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight">OpenUI</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    aria-label="Collapse sidebar"
                    aria-expanded={true}
                    onClick={toggleSidebar}
                    className="ms-auto size-11 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
                  />
                }
              >
                <PanelLeftCloseIcon aria-hidden="true" className="size-5" />
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      <div className={cn("shrink-0", collapsed ? "flex flex-col items-center gap-1 px-2" : "px-3")}>
        <NewSessionButton nav={nav} onCreated={notes.closeNotes} compact={collapsed} />
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Project worktrees"
                  disabled={!projectID || nav.projectBusy || nav.connection !== "connected"}
                  onClick={() => { if (projectID) setWorktreeProjectID(projectID) }}
                  className="size-11 shrink-0 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
                />
              }
            >
              <GitBranchIcon aria-hidden="true" className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">Project worktrees</TooltipContent>
          </Tooltip>
        ) : (
          <Button type="button" variant="ghost" className="min-h-11 w-full justify-start text-[13px]" disabled={!projectID || nav.projectBusy || nav.connection !== "connected"} onClick={() => { if (projectID) setWorktreeProjectID(projectID) }}>Project worktrees</Button>
        )}
      </div>
      <IntegrationCommandDialogs kind={worktreeProjectID ? "worktrees" : null} worktreeProjectID={worktreeProjectID ?? undefined} nav={nav} onClose={() => setWorktreeProjectID(null)} onResult={() => {}} onSessionCreated={notes.closeNotes} />
      {collapsed ? null : (
        <>
          <ProjectPanel nav={nav} className="mt-6" />
          <ScrollArea className="mt-2 min-h-0 flex-1">
            <div className="px-3"><NotesSidebar /></div>
            <SessionList nav={nav} onSelect={(sessionID) => { notes.closeNotes(); nav.selectSession(sessionID) }} />
          </ScrollArea>
        </>
      )}
      <div className={cn("mt-auto flex shrink-0 items-center border-t border-sidebar-border", collapsed ? "flex-col gap-1 p-2" : "justify-start gap-1 p-3")}>
        <SettingsButton />
      </div>
    </aside>
  )
}

export function SessionsSheet({ nav }: { nav: SessionNavProps }) {
  recordPerfRender("SessionsSheet")
  const notes = useNotesWorkspace()
  const settings = useOptionalSettingsWorkspace()
  const [open, setOpen] = useState(false)
  const pendingSettings = useRef(false)
  const [worktreeProjectID, setWorktreeProjectID] = useState<string | null>(null)
  const pendingWorktreeProject = useRef<string | null>(null)
  const projectID = worktreeNavigationProject(nav.scope, nav.location?.project.id, nav.activeSession?.projectID)
  const direction = useAppDirection()

  return (
    <>
    <Sheet open={open} onOpenChange={(next) => {
      if (next) { pendingWorktreeProject.current = null; pendingSettings.current = false }
      setOpen(next)
    }} onOpenChangeComplete={(next) => {
      if (!next && pendingSettings.current) {
        pendingSettings.current = false
        document.querySelector<HTMLButtonElement>("[data-sessions-sheet-trigger]")?.focus()
        settings?.openSettings()
      }
      if (!next && pendingWorktreeProject.current) {
        setWorktreeProjectID(pendingWorktreeProject.current)
        pendingWorktreeProject.current = null
      }
    }}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Open sessions"
            data-sessions-sheet-trigger=""
            className="size-11 rounded-full"
          />
        }
      >
        <MenuIcon aria-hidden="true" className="size-5" />
      </SheetTrigger>
      <SheetContent
        side={direction === "rtl" ? "right" : "left"}
        showCloseButton={false}
        className="w-[350px]! max-w-[92vw] gap-0 border-e-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="flex-row items-start justify-between px-5 pt-5 pb-3">
          <div className="space-y-1">
            <SheetTitle className="text-[22px] font-semibold tracking-tight">
              Sessions
            </SheetTitle>
            <SheetDescription className="text-[13px]">
              opencode-ui
            </SheetDescription>
          </div>
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Close sessions"
                className="size-11 rounded-full text-muted-foreground"
              />
            }
          >
            <XIcon aria-hidden="true" className="size-5" />
          </SheetClose>
        </SheetHeader>
        <div className="shrink-0 px-4">
          <NewSessionButton nav={nav} onCreated={() => { notes.closeNotes(); setOpen(false) }} />
          <Button type="button" variant="ghost" className="min-h-11 w-full justify-start text-[13px]" disabled={!projectID || nav.projectBusy || nav.connection !== "connected"} onClick={() => { if (projectID) { pendingWorktreeProject.current = projectID; setOpen(false) } }}>Project worktrees</Button>
        </div>
        <ProjectPanel nav={nav} className="mt-5" />
        <ScrollArea className="mt-2 min-h-0 flex-1">
          <div className="px-4"><NotesSidebar onNavigate={() => setOpen(false)} /></div>
          <SessionList
            nav={nav}
            onSelect={(sessionID) => {
              notes.closeNotes()
              nav.selectSession(sessionID)
              setOpen(false)
            }}
          />
        </ScrollArea>
        <SheetFooter className="flex-row items-center justify-start gap-1 border-t border-border p-4">
          <SettingsTriggerButton
            onClick={() => {
              pendingSettings.current = true
              setOpen(false)
            }}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <IntegrationCommandDialogs kind={worktreeProjectID ? "worktrees" : null} worktreeProjectID={worktreeProjectID ?? undefined} nav={nav} onClose={() => setWorktreeProjectID(null)} onResult={() => {}} onSessionCreated={notes.closeNotes} />
    </>
  )
}
