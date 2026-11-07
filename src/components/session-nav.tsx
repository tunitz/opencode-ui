import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import {
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
  LoaderCircleIcon,
  MenuIcon,
  PencilIcon,
  PinIcon,
  RotateCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
  SettingsDialog,
  SettingsTriggerButton,
} from "@/components/settings-dialog"
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
import { ThemeSelect } from "@/components/theme-select"
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
import { recordPerfRender } from "@/lib/perf-probe"
import { groupSessionTreesByStatus, parseSessionShortcuts, SHORTCUT_GROUPS, shortcutStorageKey, updateSessionShortcut, type SessionShortcuts, type SessionShortcut } from "@/lib/session-shortcuts"
import { worktreeNavigationProject } from "@/lib/worktree-navigation"

export type SessionNavProps = OpenCodeController

const shortcutsChanged = "opencode-ui:session-shortcuts-changed"
function subscribeShortcuts(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(shortcutsChanged, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(shortcutsChanged, callback)
  }
}

function useSessionShortcuts(version: string | null) {
  const key = version ? shortcutStorageKey(window.location.origin, version) : null
  const raw = useSyncExternalStore(subscribeShortcuts, () => {
    try { return key ? localStorage.getItem(key) ?? "" : "" } catch { return "" }
  }, () => "")
  const shortcuts = useMemo(() => parseSessionShortcuts(raw), [raw])
  const [error, setError] = useState<string | null>(null)
  function update(id: string, change: Partial<SessionShortcut>) {
    if (!key) { setError("Session labels and pins are unavailable until the server version is known."); return false }
    try {
      const current = parseSessionShortcuts(localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify(updateSessionShortcut(current, id, change)))
      window.dispatchEvent(new Event(shortcutsChanged))
      setError(null)
      return true
    } catch {
      setError("Could not save session labels and pins in this browser.")
      return false
    }
  }
  return { shortcuts, update, error }
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
    <div className="relative flex items-stretch">
      <Button
        variant="ghost"
        aria-current={active ? "page" : undefined}
        title={session.id}
        onClick={() => onSelect(session.id)}
        className={cn(
          "h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-lg py-1.5 ps-2.5 text-start font-normal text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          expandControl ? "pe-24" : "pe-12",
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
              className="absolute top-1/2 end-1 size-11 -translate-y-1/2 rounded-lg text-muted-foreground"
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
        <ResponsiveDialogContent showCloseButton={false} className="gap-4 p-5" finalFocus={() => {
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
          className="gap-4 p-5"
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
              className="absolute top-1/2 end-12 size-11 -translate-y-1/2 rounded-lg text-muted-foreground"
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
  const statusKey = `opencode-ui:session-status-shortcuts:v1:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(nav.serverVersion ?? "unknown")}`
  const statusMode = useSyncExternalStore(subscribeShortcuts, () => {
    try { return localStorage.getItem(statusKey) === "true" } catch { return false }
  }, () => false)
  const attentionSessionID = nav.activeSessionID && (
    nav.pendingPermissions.some((request) => request.sessionID === nav.activeSessionID) ||
    nav.pendingForms.some((form) => form.sessionID === nav.activeSessionID)
  ) ? nav.activeSessionID : null
  const dayStart = useSyncExternalStore(
    subscribeToDayStart,
    currentDayStart,
    currentDayStart
  )
  const groups = groupSessionTreeRows(
    sessionTreeRows([...nav.sessions].sort((a, b) => b.time.updated - a.time.updated)),
    dayStart
  )
  const statusGroups = groupSessionTreesByStatus(
    sessionTreeRows([...nav.sessions].sort((a, b) => b.time.updated - a.time.updated)),
    shortcuts, nav.runningSessionIDs, nav.unreadSessionIDs, attentionSessionID
  )
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

  return (
    <nav aria-label="Sessions" aria-busy={nav.sessionsStatus === "loading"}>
      <Button type="button" variant="ghost" className="min-h-11 w-full justify-start text-xs" onClick={() => {
        try { localStorage.setItem(statusKey, String(!statusMode)); window.dispatchEvent(new Event(shortcutsChanged)) } catch { /* Browsing still works without storage. */ }
      }}>{statusMode ? "Group by date" : "Group by status"}</Button>
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
      {statusMode ? [...SHORTCUT_GROUPS, "Other" as const].map((group) => statusGroups[group].length ? (
        <section key={group} aria-label={`${group} sessions`} className="py-1">
          <h3 className="px-2.5 py-1 text-xs font-medium text-muted-foreground">{group}</h3>
          <SessionTree rows={statusGroups[group]} activeSessionID={notes.open ? null : nav.activeSessionID} runningSessionIDs={nav.runningSessionIDs} unreadSessionIDs={nav.unreadSessionIDs} projects={nav.projects} expandedIDs={expandedIDs} onToggle={toggleSessionTree} onSelect={onSelect} onRename={nav.renameSession} onDelete={nav.deleteSession} shortcuts={shortcuts} onShortcut={updateShortcut} />
        </section>
      ) : null) : <Accordion
        value={openGroup ? [openGroup] : []}
        onValueChange={(value) => {
          const next = value[0]
          setOpenGroup(
            next && SESSION_GROUPS.includes(next as SessionGroup)
              ? (next as SessionGroup)
              : null
          )
        }}
        className="py-1"
      >
        {SESSION_GROUPS.map((label) => {
          const rows = groups[label]

          if (!rows.length) {
            return null
          }

          return (
            <AccordionItem key={label} value={label}>
              <AccordionHeader>
                <AccordionTrigger className="group/session-group">
                  <span>{label}</span>
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/session-group:rotate-90 motion-reduce:transition-none"
                  />
                </AccordionTrigger>
              </AccordionHeader>
              <AccordionPanel>
                <div className="pb-1">
                  <SessionTree
                    rows={rows}
                    activeSessionID={notes.open ? null : nav.activeSessionID}
                    runningSessionIDs={nav.runningSessionIDs}
                    unreadSessionIDs={nav.unreadSessionIDs}
                    projects={nav.projects}
                    expandedIDs={expandedIDs}
                    onToggle={toggleSessionTree}
                    onSelect={onSelect}
                    onRename={nav.renameSession}
                    onDelete={nav.deleteSession}
                    shortcuts={shortcuts}
                    onShortcut={updateShortcut}
                  />
                </div>
              </AccordionPanel>
            </AccordionItem>
          )
        })}
      </Accordion>}
    </nav>
  )
}

function SessionsHeader({ nav }: { nav: SessionNavProps }) {
  return (
    <div className="mt-5 flex shrink-0 items-center justify-between px-5">
      <span className="text-xs font-medium text-muted-foreground">
        Sessions
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {nav.sessionsStatus === "ready" ? nav.sessions.length : "—"}
      </span>
    </div>
  )
}

export function SessionSidebar({ nav }: { nav: SessionNavProps }) {
  recordPerfRender("SessionSidebar")
  const notes = useNotesWorkspace()
  const [worktreeProjectID, setWorktreeProjectID] = useState<string | null>(null)
  const projectID = worktreeNavigationProject(nav.scope, nav.location?.project.id, nav.activeSession?.projectID)
  return (
    <aside className="hidden h-svh flex-col border-e border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
          O
        </span>
        <span className="text-sm font-semibold tracking-tight">OpenUI</span>
      </div>
      <div className="shrink-0 px-3">
        <NewSessionButton nav={nav} onCreated={notes.closeNotes} />
        <Button type="button" variant="ghost" className="min-h-11 w-full justify-start text-[13px]" disabled={!projectID || nav.projectBusy || nav.connection !== "connected"} onClick={() => { if (projectID) setWorktreeProjectID(projectID) }}>Project worktrees</Button>
      </div>
      <IntegrationCommandDialogs kind={worktreeProjectID ? "worktrees" : null} worktreeProjectID={worktreeProjectID ?? undefined} nav={nav} onClose={() => setWorktreeProjectID(null)} onResult={() => {}} />
      <ProjectPanel nav={nav} className="mt-6" />
      <ScrollArea className="mt-2 min-h-0 flex-1">
        <div className="px-3"><NotesSidebar /></div>
        <SessionsHeader nav={nav} />
        <div className="px-3"><SessionList nav={nav} onSelect={(sessionID) => { notes.closeNotes(); nav.selectSession(sessionID) }} /></div>
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-between gap-1 border-t border-sidebar-border p-3">
        <ThemeSelect />
        <SettingsButton nav={nav} />
      </div>
    </aside>
  )
}

export function SessionsSheet({ nav }: { nav: SessionNavProps }) {
  recordPerfRender("SessionsSheet")
  const notes = useNotesWorkspace()
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [worktreeProjectID, setWorktreeProjectID] = useState<string | null>(null)
  const pendingWorktreeProject = useRef<string | null>(null)
  const projectID = worktreeNavigationProject(nav.scope, nav.location?.project.id, nav.activeSession?.projectID)
  const direction = useAppDirection()

  return (
    <>
    <Sheet open={open} onOpenChange={(next) => {
      if (next) pendingWorktreeProject.current = null
      setOpen(next)
    }} onOpenChangeComplete={(next) => {
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
        className="w-[350px]! max-w-[92vw] gap-0 border-e-border bg-card p-0"
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
          <SessionsHeader nav={nav} />
          <div className="px-3">
          <SessionList
            nav={nav}
            onSelect={(sessionID) => {
              notes.closeNotes()
              nav.selectSession(sessionID)
              setOpen(false)
            }}
          />
          </div>
        </ScrollArea>
        <SheetFooter className="flex-row items-center justify-between gap-1 border-t border-border p-4">
          <ThemeSelect />
          <SettingsTriggerButton
            onClick={() => {
              setOpen(false)
              setSettingsOpen(true)
            }}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <SettingsDialog
      nav={nav}
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
    />
    <IntegrationCommandDialogs kind={worktreeProjectID ? "worktrees" : null} worktreeProjectID={worktreeProjectID ?? undefined} nav={nav} onClose={() => setWorktreeProjectID(null)} onResult={() => {}} />
    </>
  )
}
