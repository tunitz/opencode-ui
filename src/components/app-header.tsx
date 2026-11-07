import { ArrowLeftIcon } from "lucide-react"
import { useNotesWorkspace } from "@/components/notes-sidebar"
import { SessionInspector } from "@/components/session-inspector"
import { WorkingTreeShortcut } from "@/components/working-tree-shortcut"
import { Button } from "@/components/ui/button"
import {
  SessionsSheet,
  type SessionNavProps,
} from "@/components/session-nav"
import { recordPerfRender } from "@/lib/perf-probe"

export function AppHeader({ nav }: { nav: SessionNavProps }) {
  recordPerfRender("AppHeader")
  const notes = useNotesWorkspace()
  const title = notes.open ? "Notes & plans" : nav.activeSession
    ? nav.activeSession.title?.trim() || "Untitled session"
    : "New session"

  return (
    <header className="safe-horizontal flex h-14 shrink-0 items-center border-b border-border/70 px-2">
      <div className="flex w-11 shrink-0 items-center md:hidden">
        <SessionsSheet nav={nav} />
      </div>
      <div className="hidden w-11 shrink-0 md:block" aria-hidden="true" />
      <h1
        className="min-w-0 flex-1 truncate px-1 text-center text-[13px] font-medium text-foreground"
        dir="auto"
        title={title}
        aria-label={title}
      >
        {title}
      </h1>
      {!notes.open && nav.activeSession ? <WorkingTreeShortcut key={JSON.stringify([nav.activeSession.id, nav.activeSession.location?.directory])} sessionID={nav.activeSession.id} directory={nav.activeSession.location?.directory ?? null} onOpen={() => nav.openInspector("changes")} /> : null}
      <div className="flex w-11 shrink-0 items-center justify-end">
        {notes.open ? <Button variant="ghost" size="icon-lg" className="size-11" aria-label="Back to conversation" onClick={notes.closeNotes}><ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" /></Button> : <SessionInspector nav={nav} />}
      </div>
    </header>
  )
}
