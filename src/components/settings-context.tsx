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
import { useOptionalWorkspace } from "@/components/workspace-context"
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
  "connection",
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
  /** Close through the shared transition; the shell's guard applies. */
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
  const workspace = useOptionalWorkspace()
  const notesOpen = notes?.open ?? false
  const closeNotes = notes?.closeNotes

  const [openRequested, setOpenRequested] = useState(false)
  const [section, setSection] = useState<SettingsSectionID>("appearance")
  const [agentDirty, setAgentDirtyState] = useState(false)
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  // Inside the app shell the shared discriminator decides; standalone fixtures
  // keep the local request so Settings can be tested on its own.
  const open = workspace ? workspace.active === "settings" : openRequested && !notesOpen

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
    if (workspace) {
      workspace.requestWorkspace("chat")
      return
    }
    setOpenRequested(false)
    setPendingChange(null)
    setAgentDirty(false)
    restoreFocus()
  }, [restoreFocus, setAgentDirty, workspace])

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

  const openSettings = useCallback(
    (nextSection?: SettingsSectionID) => {
      // A pending departure owns the next transition; do not edit behind it.
      if (workspace?.pendingTarget) return
      // Already open: keep the current section and dirty state. A deep link is
      // a section selection, so it goes through the same unsaved-edit guard.
      if (open) {
        if (nextSection) selectSection(nextSection)
        return
      }
      const commit = () => {
        // A fresh open always starts at Appearance; a deep link selects its section.
        setSection(nextSection ?? "appearance")
        setPendingChange(null)
        setAgentDirty(false)
      }
      if (workspace) {
        workspace.requestWorkspace("settings", { onCommit: commit })
        return
      }
      if (typeof document !== "undefined") {
        const active = document.activeElement
        if (active && typeof (active as HTMLElement).focus === "function") {
          returnFocusRef.current = active as HTMLElement
        }
      }
      closeNotes?.()
      commit()
      setOpenRequested(true)
    },
    [closeNotes, open, selectSection, setAgentDirty, workspace]
  )

  // Without the shared coordinator Notes still wins the main pane; drop the
  // pending Settings request so it does not reappear when Notes closes.
  useEffect(() => {
    if (workspace || !notesOpen || !openRequested) return
    /* eslint-disable react-hooks/set-state-in-effect -- reconcile against the Notes workspace, which is external state */
    setOpenRequested(false)
    setPendingChange(null)
    setAgentDirty(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [notesOpen, openRequested, setAgentDirty, workspace])

  // The shell consults this before every transition away from Settings.
  useEffect(() => {
    if (!workspace) return
    return workspace.registerGuard("settings", () => agentDirtyRef.current)
  }, [workspace])

  // A committed transition away from Settings ends any tab-switch prompt and
  // releases the dirty flag; the user already chose to leave.
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    if (open) return
    /* eslint-disable react-hooks/set-state-in-effect -- the shared workspace transition is external state */
    setPendingChange(null)
    setAgentDirty(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, setAgentDirty])

  const requestClose = useCallback(() => {
    if (workspace) {
      workspace.requestWorkspace("chat")
      return
    }
    if (agentDirtyRef.current) {
      setPendingChange({ kind: "close" })
      return
    }
    closeNow()
  }, [closeNow, workspace])

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
