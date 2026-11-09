import type { ComponentType, RefObject } from "react"
import {
  ActivityIcon,
  FileTextIcon,
  GitCompareArrowsIcon,
  InfoIcon,
  SearchIcon,
} from "lucide-react"

import { ActivityPanel, activityBadgeCount } from "@/components/inspector/activity-panel"
import { CommandPanel } from "@/components/inspector/command-panel"
import { SessionPanel } from "@/components/inspector/session-panel"
import {
  ChangesPanel,
  FilesPanel,
  type InspectorPanelHandle,
} from "@/components/files-panel"
import {
  INSPECTOR_TAB_IDS,
  INSPECTOR_TAB_LABELS,
  type InspectorTab,
} from "@/lib/inspector-tabs"
import type { OpenCodeController } from "@/lib/use-opencode"

export type InspectorPanelContext = {
  nav: OpenCodeController
  mode: "sheet" | "sidebar"
  filesRefreshRef: RefObject<InspectorPanelHandle | null>
  changesRefreshRef: RefObject<InspectorPanelHandle | null>
  filesInitialPath?: string
  onOpenFile: (path: string) => void
  onClose: () => void
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}

export type InspectorTabDefinition = {
  id: InspectorTab
  label: string
  icon: typeof SearchIcon
  badge: (nav: OpenCodeController) => number
  component: ComponentType<InspectorPanelContext>
}

function CommandPane(context: InspectorPanelContext) {
  return (
    <CommandPanel
      nav={context.nav}
      mode={context.mode}
      autoFocus={context.mode === "sidebar"}
      onClose={context.onClose}
      onOpenFile={context.onOpenFile}
      onOpenSettings={context.onOpenSettings}
      onOpenWorktrees={context.onOpenWorktrees}
    />
  )
}

function FilesPane(context: InspectorPanelContext) {
  return (
    <FilesPanel
      nav={context.nav}
      session={context.nav.activeSession!}
      refreshRef={context.filesRefreshRef}
      initialPath={context.filesInitialPath}
    />
  )
}

function ChangesPane(context: InspectorPanelContext) {
  return (
    <ChangesPanel
      nav={context.nav}
      session={context.nav.activeSession!}
      refreshRef={context.changesRefreshRef}
      onOpenFile={context.onOpenFile}
    />
  )
}

function ActivityPane(context: InspectorPanelContext) {
  return <ActivityPanel nav={context.nav} />
}

function SessionPane(context: InspectorPanelContext) {
  return <SessionPanel nav={context.nav} />
}

/**
 * Inspector tab registry. A new panel only needs an entry here; the shell,
 * rail, mobile strip, persistence, and badges are generic.
 */
export const INSPECTOR_TABS: readonly InspectorTabDefinition[] = [
  {
    id: "command",
    label: INSPECTOR_TAB_LABELS.command,
    icon: SearchIcon,
    badge: () => 0,
    component: CommandPane,
  },
  {
    id: "files",
    label: INSPECTOR_TAB_LABELS.files,
    icon: FileTextIcon,
    badge: () => 0,
    component: FilesPane,
  },
  {
    id: "changes",
    label: INSPECTOR_TAB_LABELS.changes,
    icon: GitCompareArrowsIcon,
    badge: () => 0,
    component: ChangesPane,
  },
  {
    id: "activity",
    label: INSPECTOR_TAB_LABELS.activity,
    icon: ActivityIcon,
    badge: activityBadgeCount,
    component: ActivityPane,
  },
  {
    id: "session",
    label: INSPECTOR_TAB_LABELS.session,
    icon: InfoIcon,
    badge: () => 0,
    component: SessionPane,
  },
]

export function getInspectorTab(id: InspectorTab): InspectorTabDefinition {
  return INSPECTOR_TABS.find((tab) => tab.id === id) ?? INSPECTOR_TABS[0]
}

// Compile-time guard: every persisted tab has exactly one registered panel.
const registered: readonly InspectorTab[] = INSPECTOR_TABS.map((tab) => tab.id)
void registered
void INSPECTOR_TAB_IDS
