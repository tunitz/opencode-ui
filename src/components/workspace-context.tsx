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

/**
 * The app shell has exactly one main workspace. Chat stays mounted so streams
 * and component state survive; each workspace owns its own scroll and draft
 * restoration. No other surface can be active at the same time.
 */
export const WORKSPACE_IDS = ["chat", "notes", "settings"] as const

export type WorkspaceID = (typeof WORKSPACE_IDS)[number]

export type WorkspaceTransition = {
  /** Runs once the transition is committed. */
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
  /** Make `target` active and run its callbacks. Transitions are always accepted. */
  requestWorkspace: (target: WorkspaceID, options?: WorkspaceTransition) => boolean
  /** Commit a transition directly, without callbacks (e.g. plugin shutdown). */
  forceWorkspace: (target: WorkspaceID) => void
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
 * Owns the chat/notes/settings discriminator. Workspaces are mutually
 * exclusive; callers run their own navigation with the transition callbacks.
 * Focus moves into the active pane, but the coordinator never owns chat scroll
 * or virtualized offsets.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<WorkspaceID>("chat")
  const activeRef = useRef<WorkspaceID>("chat")
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
      setActive(target)
      options?.onCommit?.()
      options?.run?.()
    },
    []
  )

  const requestWorkspace = useCallback(
    (target: WorkspaceID, options?: WorkspaceTransition) => {
      // Capture the trigger before focus moves into the destination pane.
      if (activeRef.current === "chat" && target !== "chat") {
        returnFocusRef.current = options?.returnFocus ?? activeElement()
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
    () => ({ active, requestWorkspace, forceWorkspace }),
    [active, requestWorkspace, forceWorkspace]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}
