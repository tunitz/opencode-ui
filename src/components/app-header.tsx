import { ArrowLeftIcon } from "lucide-react"
import { useWorkspace } from "@/components/workspace-context"
import { SessionInspector } from "@/components/session-inspector"
import { SubagentNavigation } from "@/components/subagent-navigation"
import { WorkingTreeShortcut } from "@/components/working-tree-shortcut"
import { Button } from "@/components/ui/button"
import {
  SessionsSheet,
  type SessionNavProps,
} from "@/components/session-nav"
import { recordPerfRender } from "@/lib/perf-probe"

export function AppHeader({
  nav,
  onOpenSettings,
  onOpenWorktrees,
}: {
  nav: SessionNavProps
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}) {
  recordPerfRender("AppHeader")
  const workspace = useWorkspace()
  const workspaceOpen = workspace.active !== "chat"
  const workspaceTitle =
    workspace.active === "notes"
      ? "Notes"
      : workspace.active === "settings"
        ? "Settings"
          : null
  const title =
    workspaceTitle ??
    (nav.activeSession
      ? nav.activeSession.title?.trim() || "Untitled session"
      : "New session")

  return (
    <header className="safe-horizontal flex h-14 shrink-0 items-center border-b border-border/70 px-2 md:px-6 lg:px-8">
      {workspaceOpen ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11 shrink-0"
          aria-label="Back to conversation"
          onClick={() => workspace.requestWorkspace("chat")}
        >
          <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        </Button>
      ) : (
        <div className="flex w-11 shrink-0 items-center md:hidden">
          <SessionsSheet nav={nav} />
        </div>
      )}
      {!workspaceOpen && nav.activeSession ? <SubagentNavigation key={nav.activeSession.id} nav={nav} title={title} /> : <h1 className="min-w-0 flex-1 truncate px-1 text-center text-[13px] font-medium text-foreground md:text-start" dir="auto" title={title}>{title}</h1>}
      {!workspaceOpen && nav.activeSession ? <div className="md:hidden"><WorkingTreeShortcut key={JSON.stringify([nav.activeSession.id, nav.activeSession.location?.directory])} sessionID={nav.activeSession.id} directory={nav.activeSession.location?.directory ?? null} onOpen={() => nav.openInspector("changes")} /></div> : null}
      <div className="flex w-11 shrink-0 items-center justify-end">
        {workspaceOpen ? null : <SessionInspector nav={nav} onOpenSettings={onOpenSettings} onOpenWorktrees={onOpenWorktrees} />}
      </div>
    </header>
  )
}
