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

import { useOptionalNotesWorkspace } from "@/components/notes-sidebar"
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

export const SETTINGS_SECTION_IDS = [
  "appearance",
  "agents",
  "alerts",
  "keys",
  "plugins",
  "access",
] as const

export type SettingsSectionID = (typeof SETTINGS_SECTION_IDS)[number]

type PendingChange =
  | { kind: "section"; id: SettingsSectionID }
  | { kind: "close" }

export type SettingsWorkspaceContextValue = {
  /** The Settings workspace is the active main pane. */
  open: boolean
  /** Selected tab. A plain open always starts at Appearance; deep links win. */
  section: SettingsSectionID
  /** Open the workspace, optionally deep-linking to a section. Closes Notes. */
  openSettings: (section?: SettingsSectionID) => void
  /** Close without the unsaved-agent-edits guard. */
  closeSettings: () => void
  /** Close, confirming first while agent edits are still saving. */
  requestClose: () => void
  /** Select a tab, confirming first while agent edits are still saving. */
  selectSection: (section: SettingsSectionID) => void
  agentDirty: boolean
  setAgentDirty: (dirty: boolean) => void
  confirmOpen: boolean
  confirmChange: PendingChange | null
  keepEditing: () => void
  confirmDiscard: () => void
}

const SettingsWorkspaceContext =
  createContext<SettingsWorkspaceContextValue | null>(null)

export function useSettingsWorkspace(): SettingsWorkspaceContextValue {
  const context = useContext(SettingsWorkspaceContext)
  if (!context) throw new Error("SettingsProvider is required")
  return context
}

/** Optional client for surfaces that also render without a SettingsProvider. */
export function useOptionalSettingsWorkspace(): SettingsWorkspaceContextValue | null {
  return useContext(SettingsWorkspaceContext)
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const notes = useOptionalNotesWorkspace()
  const notesOpen = notes?.open ?? false
  const closeNotes = notes?.closeNotes

  const [openRequested, setOpenRequested] = useState(false)
  const [section, setSection] = useState<SettingsSectionID>("appearance")
  const [agentDirty, setAgentDirtyState] = useState(false)
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  // Notes and Settings are mutually exclusive: Notes wins while it is open, so
  // the settings pane disappears on the same render that Notes appears.
  const open = openRequested && !notesOpen

  const returnFocusRef = useRef<HTMLElement | null>(null)
  const agentDirtyRef = useRef(false)

  const setAgentDirty = useCallback((dirty: boolean) => {
    agentDirtyRef.current = dirty
    setAgentDirtyState(dirty)
  }, [])

  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (typeof document === "undefined") return
    if (target && target.isConnected && typeof target.focus === "function") {
      target.focus()
      return
    }
    if (typeof document.getElementById === "function") {
      document.getElementById("chat-main")?.focus()
    }
  }, [])

  const closeNow = useCallback(() => {
    setOpenRequested(false)
    setPendingChange(null)
    setAgentDirty(false)
    restoreFocus()
  }, [restoreFocus, setAgentDirty])

  const openSettings = useCallback(
    (nextSection?: SettingsSectionID) => {
      if (typeof document !== "undefined") {
        const active = document.activeElement
        if (active && typeof (active as HTMLElement).focus === "function") {
          returnFocusRef.current = active as HTMLElement
        }
      }
      closeNotes?.()
      // A plain open always starts at Appearance; a deep link selects its section.
      setSection(nextSection ?? "appearance")
      setPendingChange(null)
      setAgentDirty(false)
      setOpenRequested(true)
    },
    [closeNotes, setAgentDirty]
  )

  // Notes takes over the main pane; drop the pending Settings request so it
  // does not reappear when Notes closes.
  useEffect(() => {
    if (!notesOpen || !openRequested) return
    /* eslint-disable react-hooks/set-state-in-effect -- reconcile against the Notes workspace, which is external state */
    setOpenRequested(false)
    setPendingChange(null)
    setAgentDirty(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [notesOpen, openRequested, setAgentDirty])

  const requestClose = useCallback(() => {
    if (agentDirtyRef.current) {
      setPendingChange({ kind: "close" })
      return
    }
    closeNow()
  }, [closeNow])

  const selectSection = useCallback(
    (next: SettingsSectionID) => {
      if (next === section) return
      if (agentDirtyRef.current) {
        setPendingChange({ kind: "section", id: next })
        return
      }
      setSection(next)
    },
    [section]
  )

  const keepEditing = useCallback(() => setPendingChange(null), [])

  const confirmDiscard = useCallback(() => {
    const change = pendingChange
    setPendingChange(null)
    setAgentDirty(false)
    if (!change) return
    if (change.kind === "close") {
      closeNow()
      return
    }
    setSection(change.id)
  }, [pendingChange, setAgentDirty, closeNow])

  const value = useMemo<SettingsWorkspaceContextValue>(
    () => ({
      open,
      section,
      openSettings,
      closeSettings: closeNow,
      requestClose,
      selectSection,
      agentDirty,
      setAgentDirty,
      confirmOpen: pendingChange !== null,
      confirmChange: pendingChange,
      keepEditing,
      confirmDiscard,
    }),
    [
      open,
      section,
      openSettings,
      closeNow,
      requestClose,
      selectSection,
      agentDirty,
      setAgentDirty,
      pendingChange,
      keepEditing,
      confirmDiscard,
    ]
  )

  return (
    <SettingsWorkspaceContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pendingChange !== null}
        onOpenChange={(next) => {
          if (!next) setPendingChange(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changes are still saving</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingChange?.kind === "section"
                ? "Switch tabs anyway? The latest edit may not be saved."
                : "Close Settings anyway? The latest edit may not be saved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDiscard}
            >
              {pendingChange?.kind === "section"
                ? "Switch anyway"
                : "Close anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsWorkspaceContext.Provider>
  )
}
