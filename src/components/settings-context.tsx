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

export const SETTINGS_SECTION_IDS = [
  "appearance",
  "alerts",
  "plugins",
  "connection",
  "access",
] as const

export type SettingsSectionID = (typeof SETTINGS_SECTION_IDS)[number]

export type SettingsWorkspaceContextValue = {
  /** The Settings workspace is the active main pane. */
  open: boolean
  /** Selected tab. A plain open always starts at Appearance; deep links win. */
  section: SettingsSectionID
  /** Open the workspace, optionally deep-linking to a section. Closes Notes. */
  openSettings: (section?: SettingsSectionID) => void
  /** Close through the shared workspace transition. */
  closeSettings: () => void
  /** Request a close; through the shared coordinator in the app shell. */
  requestClose: () => void
  /** Select a tab. */
  selectSection: (section: SettingsSectionID) => void
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
  // Inside the app shell the shared discriminator decides; standalone fixtures
  // keep the local request so Settings can be tested on its own.
  const open = workspace ? workspace.active === "settings" : openRequested && !notesOpen

  const returnFocusRef = useRef<HTMLElement | null>(null)

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
    restoreFocus()
  }, [restoreFocus, workspace])

  const selectSection = useCallback(
    (next: SettingsSectionID) => {
      if (next === section) return
      setSection(next)
    },
    [section]
  )

  const openSettings = useCallback(
    (nextSection?: SettingsSectionID) => {
      // Already open: keep the current section. A deep link is a section
      // selection, so it goes through the same path as clicking a tab.
      if (open) {
        if (nextSection) selectSection(nextSection)
        return
      }
      const commit = () => {
        // A fresh open always starts at Appearance; a deep link selects its section.
        setSection(nextSection ?? "appearance")
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
    [closeNotes, open, selectSection, workspace]
  )

  // Without the shared coordinator Notes still wins the main pane; drop the
  // pending Settings request so it does not reappear when Notes closes.
  useEffect(() => {
    if (workspace || !notesOpen || !openRequested) return
    /* eslint-disable react-hooks/set-state-in-effect -- reconcile against the Notes workspace, which is external state */
    setOpenRequested(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [notesOpen, openRequested, workspace])

  const value = useMemo<SettingsWorkspaceContextValue>(
    () => ({
      open,
      section,
      openSettings,
      closeSettings: closeNow,
      requestClose: closeNow,
      selectSection,
    }),
    [open, section, openSettings, closeNow, selectSection]
  )

  return (
    <SettingsWorkspaceContext.Provider value={value}>
      {children}
    </SettingsWorkspaceContext.Provider>
  )
}
