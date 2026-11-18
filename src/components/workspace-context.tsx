import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

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

/**
 * The app shell has exactly one main workspace. Chat stays mounted so streams
 * and component state survive; each workspace owns its own scroll and draft
 * restoration. No other surface can be active at the same time.
 */
export const WORKSPACE_IDS = ["chat", "notes", "settings"] as const

export type WorkspaceID = (typeof WORKSPACE_IDS)[number]

export const WORKSPACE_LABELS: Record<WorkspaceID, string> = {
  chat: "Conversation",
  notes: "Notes",
  settings: "Settings",
}

/** Returns true while leaving this workspace would discard unsaved work. */
export type WorkspaceGuard = () => boolean

export type WorkspaceTransition = {
  /** Runs only once the transition is committed (immediately or after confirmation). */
  onCommit?: () => void
  /** Runs after the transition commits, for navigation that belongs with it. */
  run?: () => void
  /**
   * Element focused when the user returns to chat. Captured from the active
   * element when leaving chat if omitted; an unavailable target falls back to
   * the chat pane.
   */
  returnFocus?: HTMLElement | null
}

export type WorkspaceCoordinator = {
  active: WorkspaceID
  /** A transition waiting for the user to confirm leaving unsaved work. */
  pendingTarget: WorkspaceID | null
  /**
   * Ask to make `target` the active workspace. Returns false only when the
   * transition was refused outright; a queued confirmation counts as accepted.
   */
  requestWorkspace: (target: WorkspaceID, options?: WorkspaceTransition) => boolean
  /** Commit a transition without consulting the current workspace's guard. */
  forceWorkspace: (target: WorkspaceID) => void
  /** Register the guard for one workspace; returns an unregister function. */
  registerGuard: (id: WorkspaceID, guard: WorkspaceGuard) => () => void
  confirmLeave: () => void
  keepEditing: () => void
}

const WorkspaceContext = createContext<WorkspaceCoordinator | null>(null)

export function useWorkspace(): WorkspaceCoordinator {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error("WorkspaceProvider is required")
  return context
}

/** Optional client for providers and fixtures that also mount standalone. */
export function useOptionalWorkspace(): WorkspaceCoordinator | null {
  return useContext(WorkspaceContext)
}

function activeElement(): HTMLElement | null {
  if (typeof document === "undefined") return null
  const element = document.activeElement as HTMLElement | null
  if (!element || typeof element.focus !== "function") return null
  // Body/documentElement are not meaningful return targets; use the chat pane.
  if (element === document.body || element === document.documentElement) {
    return null
  }
  return element
}

function focusElement(element: HTMLElement | null | undefined): boolean {
  if (!element || !element.isConnected || typeof element.focus !== "function") {
    return false
  }
  element.focus()
  return true
}

function focusWorkspacePane(id: WorkspaceID): void {
  if (typeof document === "undefined") return
  const pane = document.querySelector<HTMLElement>(
    `[data-workspace-focus="${id}"]`
  )
  pane?.focus()
}

function focusChat(): void {
  if (typeof document === "undefined") return
  focusElement(document.getElementById("chat-main"))
}

/**
 * Owns the chat/notes/settings discriminator and the one confirmation
 * used by every exit path. Workspaces register a synchronous dirty check; the
 * coordinator keeps transitions pending until the user chooses. It moves focus
 * into the active pane, but never owns chat scroll or virtualized offsets.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<WorkspaceID>("chat")
  const [pendingTarget, setPendingTarget] = useState<WorkspaceID | null>(null)
  const activeRef = useRef<WorkspaceID>("chat")
  const pendingRef = useRef<{
    target: WorkspaceID
    options?: WorkspaceTransition
  } | null>(null)
  const guards = useRef(new Map<WorkspaceID, WorkspaceGuard>())
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const previousActiveRef = useRef<WorkspaceID>("chat")

  const commit = useCallback(
    (target: WorkspaceID, options?: WorkspaceTransition) => {
      if (target === activeRef.current) {
        options?.onCommit?.()
        options?.run?.()
        return
      }
      activeRef.current = target
      pendingRef.current = null
      setPendingTarget(null)
      setActive(target)
      options?.onCommit?.()
      options?.run?.()
    },
    []
  )

  const requestWorkspace = useCallback(
    (target: WorkspaceID, options?: WorkspaceTransition) => {
      // A pending confirmation owns the next transition. Do not retarget it
      // with another click, and do not run same-target work behind the dialog.
      if (pendingRef.current) return false
      if (target === activeRef.current) {
        options?.onCommit?.()
        options?.run?.()
        return true
      }
      // Capture the trigger before a confirmation dialog can take focus.
      if (activeRef.current === "chat" && target !== "chat") {
        returnFocusRef.current = options?.returnFocus ?? activeElement()
      }
      const guard = guards.current.get(activeRef.current)
      if (guard?.()) {
        pendingRef.current = { target, options }
        setPendingTarget(target)
        return true
      }
      commit(target, options)
      return true
    },
    [commit]
  )

  const forceWorkspace = useCallback(
    (target: WorkspaceID) => {
      commit(target)
    },
    [commit]
  )

  const registerGuard = useCallback(
    (id: WorkspaceID, guard: WorkspaceGuard) => {
      guards.current.set(id, guard)
      return () => {
        if (guards.current.get(id) === guard) guards.current.delete(id)
      }
    },
    []
  )

  const keepEditing = useCallback(() => {
    pendingRef.current = null
    setPendingTarget(null)
  }, [])

  const confirmLeave = useCallback(() => {
    const transition = pendingRef.current
    pendingRef.current = null
    setPendingTarget(null)
    if (transition) commit(transition.target, transition.options)
  }, [commit])

  // Focus moves into the newly active workspace before paint, and back to the
  // trigger (or the chat pane) on return. The initial chat mount never steals
  // focus.
  useLayoutEffect(() => {
    const previous = previousActiveRef.current
    previousActiveRef.current = active
    if (previous === active) return
    if (active === "chat") {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target) {
        if (focusElement(target)) return
      }
      focusChat()
      return
    }
    focusWorkspacePane(active)
  }, [active])

  const value = useMemo<WorkspaceCoordinator>(
    () => ({
      active,
      pendingTarget,
      requestWorkspace,
      forceWorkspace,
      registerGuard,
      confirmLeave,
      keepEditing,
    }),
    [
      active,
      pendingTarget,
      requestWorkspace,
      forceWorkspace,
      registerGuard,
      confirmLeave,
      keepEditing,
    ]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pendingTarget !== null}
        onOpenChange={(next) => {
          if (!next) keepEditing()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Leave {WORKSPACE_LABELS[active]} anyway? The latest edit may not
              be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmLeave}>
              Leave anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceContext.Provider>
  )
}
