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
} from "@/components/settings-trigger"
import { useOptionalSettingsWorkspace } from "@/components/settings-context"
import { useOptionalWorkspace } from "@/components/workspace-context"
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
import type { LoadStatus, OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"
import { DESKTOP_SIDEBAR_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "@/lib/sidebar-layout"
import { recordPerfRender } from "@/lib/perf-probe"
import { fullActivityTime, relativeActivityTime } from "@/lib/relative-time"
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

export function sessionProjectLabel(session: SessionInfo, projects: Project[]) {
  const listed = projects.find((project) => project.id === session.projectID)

  if (listed) {
    return projectName(listed)
  }

  return (
    session.location?.directory?.split("/").filter(Boolean).at(-1) ??
    session.projectID
  )
}

const SessionRow = memo(function SessionRow({
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
  archived = false,
  onArchive,
  onUnarchive,
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
  archived?: boolean
  onArchive?: (sessionID: string) => Promise<string | null>
  onUnarchive?: (sessionID: string) => Promise<string | null>
  shortcut?: SessionShortcut
  onShortcut: (sessionID: string, change: Partial<SessionShortcut>) => boolean
}) {
  const title = session.title?.trim() || session.id
  const activityLabel = relativeActivityTime(session.time.updated)
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
        data-session-id={session.id}
        aria-current={active ? "page" : undefined}
        title={`${session.id}\nLast activity: ${fullActivityTime(session.time.updated)}`}
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
            <span className="shrink-0 tabular-nums" aria-label={`Last activity ${fullActivityTime(session.time.updated)}`}>
              {activityLabel}
            </span>
            {archived ? <span className="shrink-0">Archived</span> : null}
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
          {onArchive ? (
            <DropdownMenuItem onClick={() => void onArchive(session.id)}>
              <RotateCwIcon aria-hidden="true" />
              Archive session
            </DropdownMenuItem>
          ) : null}
          {onUnarchive ? (
            <DropdownMenuItem onClick={() => void onUnarchive(session.id)}>
              <RotateCwIcon aria-hidden="true" />
              Unarchive session
            </DropdownMenuItem>
          ) : null}
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
})

/**
 * Inner scroll for one session group or subtree. It owns its own wheel/scroll
 * chaining and bottom fade so long lists never take over the whole sidebar.
 */
function IncrementalViewport({
  children,
  label,
  maxHeightClass,
  hasMore,
  loading,
  onLoadMore,
}: {
  children: ReactNode
  label: string
  maxHeightClass: string
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [faded, setFaded] = useState(false)

  const syncFade = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    setFaded(
      element.scrollTop + element.clientHeight < element.scrollHeight - 4
    )
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    syncFade()
    const observer = new ResizeObserver(syncFade)
    observer.observe(element)
    element.addEventListener("scroll", syncFade, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener("scroll", syncFade)
    }
  }, [children, syncFade])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!hasMore || loading || !root || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { root, rootMargin: "48px 0px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, onLoadMore, children])

  return (
    <div
      ref={scrollRef}
      role="group"
      aria-label={label}
      className={cn(
        "min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain ps-0.5 pe-1",
        maxHeightClass
      )}
      style={
        faded
          ? { maskImage: "linear-gradient(to bottom, black calc(100% - 1.5rem), transparent)" }
          : undefined
      }
    >
      <div className="space-y-0.5">{children}</div>
      {hasMore ? (
        <div ref={sentinelRef} aria-hidden="true" className="flex h-8 items-center justify-center text-[11px] text-muted-foreground">
          {loading ? "Loading more…" : null}
        </div>
      ) : null}
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
  onToggle: (sessionID: string, hasLoadedChildren: boolean) => Promise<boolean>
  onSelect: (sessionID: string) => void
  onRename: (sessionID: string, title: string) => Promise<string | null>
  onDelete: (sessionID: string) => Promise<string | null>
  loadSubsessionPage: (
    parentID: string,
    cursor?: string | null
  ) => Promise<
    | { ok: true; hasChildren: boolean; nextCursor: string | null }
    | { ok: false; error: string }
  >
  archived?: boolean
  onArchive?: (sessionID: string) => Promise<string | null>
  onUnarchive?: (sessionID: string) => Promise<string | null>
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

/** An expanded subtree reveals ten children at a time inside its own scroll. */
function SubsessionList({
  parentID,
  rows,
  context,
}: {
  parentID: string
  rows: readonly SessionTreeRow<SessionInfo>[]
  context: SessionTreeContext
}) {
  const [visibleCount, setVisibleCount] = useState(10)
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasMore = visibleCount < rows.length || cursor !== null

  const loadMore = useCallback(async () => {
    if (visibleCount < rows.length) {
      setVisibleCount((current) => Math.min(rows.length, current + 10))
      return
    }
    if (loading) return
    setLoading(true)
    setError(null)
    const result = await context.loadSubsessionPage(parentID, cursor ?? null)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCursor(result.nextCursor)
  }, [context, cursor, loading, parentID, rows.length, visibleCount])

  return (
    <div className="ms-3 border-s border-sidebar-border ps-1">
      <IncrementalViewport
        label="Subagents"
        maxHeightClass="max-h-60"
        hasMore={hasMore}
        loading={loading}
        onLoadMore={() => void loadMore()}
      >
        {rows.slice(0, visibleCount).map((child) => (
          <SessionTreeNode key={child.session.id} row={child} {...context} />
        ))}
      </IncrementalViewport>
      {error ? <p role="alert" className="px-2 py-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}

const SessionTreeNode = memo(function SessionTreeNode({
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
  loadSubsessionPage,
  archived,
  onArchive,
  onUnarchive,
  shortcuts,
  onShortcut,
}: { row: SessionTreeRow<SessionInfo> } & SessionTreeContext) {
  const { session, children } = row
  const title = session.title?.trim() || session.id
  const expanded = expandedIDs.has(session.id)
  const childrenID = `session-subtree-${session.id}`
  const descendants = countSessionTreeDescendants(row)

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
          <Button
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={expanded && children.length > 0 ? childrenID : undefined}
            aria-label={`${expanded ? "Hide" : "Show"} subagents for ${title}`}
            onClick={() => { void onToggle(session.id, children.length > 0) }}
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
        }
        onSelect={onSelect}
        onRename={onRename}
        onDelete={onDelete}
        archived={archived}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        shortcut={shortcuts[session.id]}
        onShortcut={onShortcut}
      />
      {expanded && children.length > 0 ? (
        <div id={childrenID}>
          <SubsessionList parentID={session.id} rows={children} context={{
            activeSessionID,
            runningSessionIDs,
            unreadSessionIDs,
            projects,
            expandedIDs,
            onToggle,
            onSelect,
            onRename,
            onDelete,
            loadSubsessionPage,
            archived,
            onArchive,
            onUnarchive,
            shortcuts,
            onShortcut,
          }} />
        </div>
      ) : null}
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

function PagedSessionTree({
  rows,
  context,
  label,
  hasMore,
  loading,
  onLoadMore,
}: {
  rows: readonly SessionTreeRow<SessionInfo>[]
  context: SessionTreeContext
  label: string
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}) {
  const [visibleCount, setVisibleCount] = useState(10)
  const loadMore = useCallback(() => {
    if (visibleCount < rows.length) {
      setVisibleCount((current) => Math.min(rows.length, current + 10))
      return
    }
    onLoadMore()
  }, [onLoadMore, rows.length, visibleCount])

  return (
    <IncrementalViewport
      label={label}
      maxHeightClass="max-h-80"
      hasMore={hasMore || visibleCount < rows.length}
      loading={loading}
      onLoadMore={loadMore}
    >
      <SessionTree rows={rows.slice(0, visibleCount)} {...context} />
    </IncrementalViewport>
  )
}

function SessionList({
  nav,
  onSelect = nav.selectSession,
}: {
  nav: SessionNavProps
  onSelect?: (sessionID: string) => void
}) {
  const notes = useNotesWorkspace()
  const workspace = useOptionalWorkspace()
  // Only chat marks a row current; every other workspace is a separate surface.
  const highlightedSessionID = workspace
    ? workspace.active === "chat"
      ? nav.activeSessionID
      : null
    : notes.open
      ? null
      : nav.activeSessionID
  const { shortcuts, update: updateShortcut, error: shortcutError } = useSessionShortcuts()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [pinnedExtras, setPinnedExtras] = useState<SessionInfo[]>([])
  const pinnedExtrasRef = useRef<SessionInfo[]>([])
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  const handleSelect = useCallback(
    (sessionID: string) => onSelectRef.current(sessionID),
    []
  )
  // The controller recreates its callback identities on status frames. Refs
  // keep the memoized tree rows from re-rendering for that churn alone.
  const renameSessionRef = useRef(nav.renameSession)
  const deleteSessionRef = useRef(nav.deleteSession)
  const setSessionArchivedRef = useRef(nav.setSessionArchived)
  useEffect(() => {
    renameSessionRef.current = nav.renameSession
    deleteSessionRef.current = nav.deleteSession
    setSessionArchivedRef.current = nav.setSessionArchived
  }, [nav.renameSession, nav.deleteSession, nav.setSessionArchived])
  const handleRename = useCallback(
    (sessionID: string, title: string) => renameSessionRef.current(sessionID, title),
    []
  )
  const handleDelete = useCallback(
    (sessionID: string) => deleteSessionRef.current(sessionID),
    []
  )
  const handleArchive = useCallback(
    (sessionID: string) => setSessionArchivedRef.current(sessionID, true),
    []
  )
  const handleUnarchive = useCallback(
    (sessionID: string) => setSessionArchivedRef.current(sessionID, false),
    []
  )
  // Live run/unread maps change on activity frames; deferring them keeps the
  // heavy tree rows interactive while status catches up in a low-priority pass.
  const deferredRunningSessionIDs = useDeferredValue(nav.runningSessionIDs)
  const deferredUnreadSessionIDs = useDeferredValue(nav.unreadSessionIDs)
  const searchQuery = query.trim()
  const searching = searchQuery.length > 0
  const deferredQuery = useDeferredValue(searchQuery)
  const [searchRows, setSearchRows] = useState<SessionInfo[]>([])
  const [searchCursor, setSearchCursor] = useState<string | null>(null)
  const [searchStatus, setSearchStatus] = useState<LoadStatus>("idle")
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchRequest = useRef(0)
  const searchCursorRef = useRef<string | null>(null)
  const loadingSearchRef = useRef(false)
  const searchPageRef = useRef(nav.searchSessionPage)
  const loadSubsessionRef = useRef(nav.loadSubsessionPage)
  const loadPinnedRef = useRef(nav.loadPinnedSessions)
  useEffect(() => {
    searchPageRef.current = nav.searchSessionPage
    loadSubsessionRef.current = nav.loadSubsessionPage
    loadPinnedRef.current = nav.loadPinnedSessions
  }, [nav.searchSessionPage, nav.loadSubsessionPage, nav.loadPinnedSessions])

  // Pinned IDs are external server state; resolving them keeps the section
  // complete even when the pinned session is outside the current paged list.
  useEffect(() => {
    const ids = Object.entries(shortcuts)
      .filter(([, shortcut]) => shortcut?.pinned)
      .map(([sessionID]) => sessionID)
    const known = new Set([
      ...nav.sessions.map((session) => session.id),
      ...pinnedExtrasRef.current.map((session) => session.id),
    ])
    const missing = ids.filter((id) => !known.has(id)).slice(0, 50)
    if (missing.length === 0) return
    let cancelled = false
    void loadPinnedRef.current(missing).then((rows) => {
      if (cancelled || rows.length === 0) return
      setPinnedExtras((current) => {
        const seen = new Set(current.map((session) => session.id))
        const next = [...current, ...rows.filter((session) => !seen.has(session.id))]
        pinnedExtrasRef.current = next
        return next
      })
    })
    return () => { cancelled = true }
  }, [shortcuts, nav.sessions])

  /* eslint-disable react-hooks/set-state-in-effect -- search state is keyed
     to the deferred query, so each new query starts from an empty page. */
  useEffect(() => {
    const request = ++searchRequest.current
    searchCursorRef.current = null
    setSearchCursor(null)
    setSearchRows([])
    setSearchError(null)
    if (!deferredQuery) {
      setSearchStatus("idle")
      return
    }
    setSearchStatus("loading")
    const timer = setTimeout(() => {
      void searchPageRef.current(deferredQuery).then((result) => {
        if (request !== searchRequest.current) return
        if (!result.ok) {
          setSearchError(result.error)
          setSearchStatus("error")
          return
        }
        searchCursorRef.current = result.nextCursor
        setSearchCursor(result.nextCursor)
        setSearchRows(result.sessions)
        setSearchStatus("ready")
      })
    }, 180)
    return () => clearTimeout(timer)
  }, [deferredQuery])
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadMoreSearch = useCallback(async () => {
    const cursor = searchCursorRef.current
    if (!cursor || loadingSearchRef.current || !deferredQuery) return
    const request = searchRequest.current
    loadingSearchRef.current = true
    setSearchStatus("loading")
    try {
      const result = await searchPageRef.current(deferredQuery, cursor)
      if (request !== searchRequest.current) return
      if (!result.ok) {
        setSearchError(result.error)
        setSearchStatus("error")
        return
      }
      searchCursorRef.current = result.nextCursor
      setSearchCursor(result.nextCursor)
      setSearchRows((current) => {
        const seen = new Set(current.map((session) => session.id))
        return [...current, ...result.sessions.filter((session) => !seen.has(session.id))]
      })
      setSearchStatus("ready")
    } finally {
      loadingSearchRef.current = false
    }
  }, [deferredQuery])

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
  const pinnedRows = useMemo(() => {
    const known = new Set(sortedSessions.map((session) => session.id))
    const source = [
      ...sortedSessions,
      ...pinnedExtras.filter((session) => !known.has(session.id)),
    ].sort((a, b) => b.time.updated - a.time.updated)
    return sessionTreeRows(source.filter((session) => shortcuts[session.id]?.pinned))
  }, [sortedSessions, pinnedExtras, shortcuts])
  const archivedRows = useMemo(
    () => sessionTreeRows(nav.archivedSessions),
    [nav.archivedSessions]
  )
  const searchTreeRows = useMemo(
    () => sessionTreeRows(searchRows),
    [searchRows]
  )
  const groups = useMemo(
    () => groupSessionTreeRows(treeRows, dayStart),
    [treeRows, dayStart]
  )
  const activeAncestors = useMemo(
    () => sessionAncestorIDs(nav.sessions, nav.activeSessionID),
    [nav.sessions, nav.activeSessionID]
  )
  const activeGroup = sessionGroupForID(
    nav.sessions,
    activeAncestors.at(-1) ?? nav.activeSessionID,
    dayStart
  )
  const [openGroup, setOpenGroup] = useState<SessionGroup | null>(activeGroup)
  const lastActiveGroup = useRef<SessionGroup | null>(activeGroup)
  const [expandedID, setExpandedID] = useState<string | null>(null)
  const expandedIDs = useMemo(
    () => (expandedID ? new Set([expandedID]) : new Set<string>()),
    [expandedID]
  )

  // The selected session's group is the default-open panel; every other group
  // starts closed. Moving the selection to another group opens that group and
  // collapses the previous one. A manual collapse is preserved until selection
  // actually moves.
  useEffect(() => {
    if (!activeGroup) {
      lastActiveGroup.current = null
      return
    }
    if (activeGroup === lastActiveGroup.current) return
    lastActiveGroup.current = activeGroup
    setOpenGroup(activeGroup)
  }, [activeGroup])

  const loadSubsessionPage = useCallback(
    async (parentID: string, cursor: string | null = null) => {
      const result = await loadSubsessionRef.current(parentID, cursor)
      if (!result.ok) return { ok: false as const, error: result.error }
      return {
        ok: true as const,
        hasChildren: result.sessions.length > 0,
        nextCursor: result.nextCursor,
      }
    },
    []
  )

  const toggleSessionTree = useCallback(
    async (sessionID: string, hasLoadedChildren: boolean) => {
      if (expandedID === sessionID) {
        setExpandedID(null)
        return true
      }
      if (!hasLoadedChildren) {
        // An empty subtree still toggles the chevron; there is simply no panel.
        void loadSubsessionPage(sessionID)
      }
      setExpandedID(sessionID)
      return true
    },
    [expandedID, loadSubsessionPage]
  )

  const treeContext = useMemo(
    () => ({
      activeSessionID: highlightedSessionID,
      runningSessionIDs: deferredRunningSessionIDs,
      unreadSessionIDs: deferredUnreadSessionIDs,
      projects: nav.projects,
      expandedIDs,
      onToggle: toggleSessionTree,
      onSelect: handleSelect,
      onRename: handleRename,
      onDelete: handleDelete,
      loadSubsessionPage,
      shortcuts,
      onShortcut: updateShortcut,
    }),
    [
      highlightedSessionID,
      deferredRunningSessionIDs,
      deferredUnreadSessionIDs,
      nav.projects,
      expandedIDs,
      toggleSessionTree,
      handleSelect,
      handleRename,
      handleDelete,
      loadSubsessionPage,
      shortcuts,
      updateShortcut,
    ]
  )
  const activeTreeContext = useMemo(
    () => ({ ...treeContext, onArchive: handleArchive }),
    [treeContext, handleArchive]
  )
  const archiveTreeContext = useMemo(
    () => ({ ...treeContext, archived: true, onUnarchive: handleUnarchive }),
    [treeContext, handleUnarchive]
  )

  function closeSearch() {
    setSearchOpen(false)
    setQuery("")
  }

  function loadMoreGroup() {
    if (nav.sessionsHasMore && !nav.loadingMoreSessions) {
      void nav.loadMoreSessions()
    }
  }

  return (
    <>
      <SessionsHeader
        count={
          nav.sessionsStatus === "ready"
            ? searching
              ? searchRows.length
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
          {nav.sessionsStatus === "loading" && !searching ? (
            <p role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">
              Loading sessions…
            </p>
          ) : null}
          {nav.sessionsStatus === "error" && !searching ? (
            <div role="alert" className="space-y-2 px-2.5 py-1.5">
              <p className="text-xs break-words text-destructive">
                {nav.sessionsError ?? "Could not load sessions."}
              </p>
              <Button variant="outline" onClick={nav.refreshSessions} className="h-11 w-full text-[13px]">
                Retry sessions
              </Button>
            </div>
          ) : null}
          {nav.sessionsStatus === "ready" && nav.sessions.length === 0 && !searching ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">No sessions yet.</p>
          ) : null}
          {searching ? (
            <Accordion multiple defaultValue={["search-results"]} className="mt-2 space-y-2 py-1">
              <AccordionSection
                value="search-results"
                title="Search results"
                count={searchStatus === "loading" ? undefined : searchRows.length}
                contentClassName="p-1"
              >
                {searchError ? (
                  <p role="alert" className="px-2.5 py-2 text-[13px] break-words text-destructive">{searchError}</p>
                ) : null}
                {searchStatus === "loading" && searchRows.length === 0 ? (
                  <p role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">Searching sessions…</p>
                ) : null}
                {searchStatus === "ready" && searchTreeRows.length === 0 ? (
                  <p role="status" className="px-2.5 py-2 text-[13px] break-words text-muted-foreground">
                    No sessions match “{searchQuery}”.
                  </p>
                ) : null}
                {searchTreeRows.length > 0 ? (
                  <PagedSessionTree
                    key={`search-${deferredQuery}`}
                    rows={searchTreeRows}
                    context={activeTreeContext}
                    label="Session search results"
                    hasMore={searchCursor !== null}
                    loading={searchStatus === "loading"}
                    onLoadMore={() => void loadMoreSearch()}
                  />
                ) : null}
              </AccordionSection>
            </Accordion>
          ) : null}
          {!searching && pinnedRows.length > 0 ? (
            <Accordion defaultValue={["pinned"]} className="space-y-2 py-1">
              <AccordionSection value="pinned" title="Pinned sessions" count={pinnedRows.length} contentClassName="p-1">
                <PagedSessionTree
                  rows={pinnedRows}
                  context={activeTreeContext}
                  label="Pinned sessions"
                  hasMore={nav.sessionsHasMore}
                  loading={nav.loadingMoreSessions}
                  onLoadMore={loadMoreGroup}
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
                if (!rows.length && label !== "Today") return null
                return (
                  <AccordionSection
                    key={label}
                    value={label}
                    title={label}
                    count={rows.length}
                    contentClassName="p-1"
                  >
                    {rows.length > 0 ? (
                      <PagedSessionTree
                        rows={rows}
                        context={activeTreeContext}
                        label={`${label} sessions`}
                        hasMore={nav.sessionsHasMore}
                        loading={nav.loadingMoreSessions}
                        onLoadMore={loadMoreGroup}
                      />
                    ) : (
                      <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
                        No sessions today.
                      </p>
                    )}
                  </AccordionSection>
                )
              })}
            </Accordion>
          ) : null}
          {!searching ? (
            <Accordion
              key="archive"
              value={archivedOpen ? ["archive"] : []}
              onValueChange={(value) => {
                const next = value.includes("archive")
                setArchivedOpen(next)
                if (next && nav.archivedStatus === "idle") void nav.loadArchivedSessions()
              }}
              className="mt-2 space-y-2 pb-3"
            >
              <AccordionSection
                value="archive"
                title="Archive"
                count={nav.archivedStatus === "loading" ? undefined : nav.archivedSessions.length}
                contentClassName="p-1"
              >
                {nav.archivedStatus === "error" ? (
                  <div role="alert" className="space-y-1 px-2 py-1 text-xs text-destructive">
                    <p className="break-words">{nav.archivedError ?? "Could not load archived sessions."}</p>
                    <Button variant="outline" className="h-11 px-3 text-xs" onClick={() => void nav.loadArchivedSessions()}>Retry</Button>
                  </div>
                ) : null}
                {nav.archivedStatus === "loading" && nav.archivedSessions.length === 0 ? (
                  <p role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">Loading archived sessions…</p>
                ) : null}
                {nav.archivedSessions.length === 0 && (nav.archivedStatus === "ready" || nav.archivedStatus === "idle") ? (
                  <p className="px-2.5 py-2 text-[13px] text-muted-foreground">No archived sessions in this scope.</p>
                ) : null}
                {archivedRows.length > 0 ? (
                  <PagedSessionTree
                    rows={archivedRows}
                    context={archiveTreeContext}
                    label="Archived sessions"
                    hasMore={nav.archivedHasMore}
                    loading={nav.loadingMoreArchived}
                    onLoadMore={() => {
                      if (nav.archivedHasMore && !nav.loadingMoreArchived) void nav.loadMoreArchivedSessions()
                    }}
                  />
                ) : null}
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
  const settings = useOptionalSettingsWorkspace()
  const workspace = useOptionalWorkspace()
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const [worktreeProjectID, setWorktreeProjectID] = useState<string | null>(null)
  const projectID = worktreeNavigationProject(nav.scope, nav.location?.project.id, nav.activeSession?.projectID)

  // One exit path for every session navigation: the shared guard decides, and
  // the selection only runs once the transition is committed.
  function leaveToChat(run: () => void) {
    if (workspace) {
      workspace.requestWorkspace("chat", { run })
      return
    }
    notes.closeNotes()
    settings?.requestClose()
    run()
  }

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
      aria-label="Sessions sidebar"
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
              <PanelLeftOpenIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
            </TooltipTrigger>
            <TooltipContent side="inline-end">Expand sidebar</TooltipContent>
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
            <span className="text-sm font-semibold tracking-tight">opencode-ui</span>
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
                <PanelLeftCloseIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
              </TooltipTrigger>
              <TooltipContent side="inline-end">Collapse sidebar</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      <div className={cn("shrink-0", collapsed ? "flex flex-col items-center gap-1 px-2" : "px-3")}>
        <NewSessionButton nav={nav} onCreated={() => leaveToChat(() => {})} compact={collapsed} />
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
            <TooltipContent side="inline-end">Project worktrees</TooltipContent>
          </Tooltip>
        ) : (
          <Button type="button" variant="ghost" className="min-h-11 w-full justify-start text-[13px]" disabled={!projectID || nav.projectBusy || nav.connection !== "connected"} onClick={() => { if (projectID) setWorktreeProjectID(projectID) }}>Project worktrees</Button>
        )}
      </div>
      <IntegrationCommandDialogs kind={worktreeProjectID ? "worktrees" : null} worktreeProjectID={worktreeProjectID ?? undefined} nav={nav} onClose={() => setWorktreeProjectID(null)} onResult={() => {}} onSessionCreated={() => leaveToChat(() => {})} />
      {collapsed ? null : (
        <>
          <ProjectPanel nav={nav} className="mt-6" />
          <ScrollArea className="mt-2 min-h-0 flex-1">
            <div className="px-3"><NotesSidebar /></div>
            <SessionList nav={nav} onSelect={(sessionID) => leaveToChat(() => nav.selectSession(sessionID))} />
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
  const workspace = useOptionalWorkspace()
  const [open, setOpen] = useState(false)
  const pendingSettings = useRef(false)
  const [worktreeProjectID, setWorktreeProjectID] = useState<string | null>(null)
  const pendingWorktreeProject = useRef<string | null>(null)
  const projectID = worktreeNavigationProject(nav.scope, nav.location?.project.id, nav.activeSession?.projectID)
  const direction = useAppDirection()

  function leaveToChat(run: () => void) {
    if (workspace) {
      workspace.requestWorkspace("chat", { run })
      return
    }
    notes.closeNotes()
    settings?.requestClose()
    run()
  }

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
        <SheetHeader className="flex-row items-start justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
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
          <NewSessionButton nav={nav} onCreated={() => { setOpen(false); leaveToChat(() => {}) }} />
          <Button type="button" variant="ghost" className="min-h-11 w-full justify-start text-[13px]" disabled={!projectID || nav.projectBusy || nav.connection !== "connected"} onClick={() => { if (projectID) { pendingWorktreeProject.current = projectID; setOpen(false) } }}>Project worktrees</Button>
        </div>
        <ProjectPanel nav={nav} className="mt-5" />
        <ScrollArea className="mt-2 min-h-0 flex-1">
          <div className="px-4"><NotesSidebar onNavigate={() => setOpen(false)} /></div>
          <SessionList
            nav={nav}
            onSelect={(sessionID) => {
              leaveToChat(() => nav.selectSession(sessionID))
              setOpen(false)
            }}
          />
        </ScrollArea>
        <SheetFooter className="flex-row items-center justify-start gap-1 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SettingsTriggerButton
            onClick={() => {
              pendingSettings.current = true
              setOpen(false)
            }}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <IntegrationCommandDialogs kind={worktreeProjectID ? "worktrees" : null} worktreeProjectID={worktreeProjectID ?? undefined} nav={nav} onClose={() => setWorktreeProjectID(null)} onResult={() => {}} onSessionCreated={() => leaveToChat(() => {})} />
    </>
  )
}
