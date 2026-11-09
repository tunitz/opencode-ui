import { useEffect, useRef, useState } from "react"
import { XIcon } from "lucide-react"

import { AppHeader } from "@/components/app-header"
import { Composer } from "@/components/composer"
import { ContextStrip } from "@/components/context-strip"
import { Conversation } from "@/components/conversation"
import { NotificationsProvider } from "@/components/notifications-provider"
import { NotesProvider, NotesWorkspace, useNotesWorkspace } from "@/components/notes-sidebar"
import { PendingInbox } from "@/components/pending-inbox"
import { SessionInspectorPanel } from "@/components/session-inspector"
import { SessionSidebar } from "@/components/session-nav"
import { Button } from "@/components/ui/button"
import { useAppViewportHeight } from "@/lib/use-app-viewport-height"
import { useOpenCode, type OpenCodeController } from "@/lib/use-opencode"
import { recordPerfRender } from "@/lib/perf-probe"

export function App() {
  recordPerfRender("App")
  const nav = useOpenCode()
  useAppViewportHeight()

  return <NotesProvider nav={nav}><AppShell nav={nav} /></NotesProvider>
}

function AppShell({ nav }: { nav: OpenCodeController }) {
  const notes = useNotesWorkspace()
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const previousNotesOpen = useRef(notes.open)
  useEffect(() => {
    if (previousNotesOpen.current !== notes.open) {
      previousNotesOpen.current = notes.open
      document.getElementById("chat-main")?.focus()
    }
  }, [notes.open])

  return (
    <NotificationsProvider nav={nav}>
      <a
        href="#chat-main"
        className="sr-only fixed top-2 start-2 z-50 rounded-lg bg-background px-4 py-3 text-foreground shadow-lg focus:not-sr-only focus:outline-2 focus:outline-ring"
      >
        Skip to main content
      </a>
      <div className="app-height app-viewport bg-background md:flex md:h-svh md:overflow-hidden">
      <SessionSidebar nav={nav} />
      <div className="app-height flex min-w-0 flex-1 flex-col md:h-svh">
        <AppHeader nav={nav} />
        <main id="chat-main" tabIndex={-1} className="flex min-h-0 w-full flex-1 flex-col focus:outline-none">
          <div className={notes.open ? "hidden" : "mx-auto flex min-h-0 w-full max-w-[42.5rem] flex-1 flex-col md:max-w-none md:px-6 lg:px-8"}>
          {nav.startupNotice ? (
            <div
              role="status"
              className="mx-4 mt-2 flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="min-w-0 break-words">{nav.startupNotice}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss startup notice"
                className="shrink-0"
                onClick={nav.dismissStartupNotice}
              >
                <XIcon aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ) : null}
          <PendingInbox nav={nav} />
          <Conversation
            sessionKey={nav.activeSessionID}
            hasSession={nav.activeSessionID !== null}
            status={nav.historyStatus}
            error={nav.historyError}
            messages={nav.messages}
            streamStatus={nav.streamStatus}
            hasOlder={nav.hasOlder}
            loadingOlder={nav.loadingOlder}
            olderError={nav.olderError}
            revert={nav.activeSession?.revert ?? null}
            focusMessageID={nav.focusMessageID}
            onFocusMessageHandled={nav.clearFocusMessage}
            onRetry={nav.retryHistory}
            onLoadOlder={nav.loadOlderMessages}
          />
          <ContextStrip
            sessionID={nav.activeSessionID}
            hasSession={nav.activeSessionID !== null}
            session={nav.activeSession}
            messages={nav.historyStatus === "ready" ? nav.messages : []}
            models={nav.models}
            revert={nav.activeSession?.revert ?? null}
          />
          <Composer nav={nav} modelSettingsOpen={modelSettingsOpen} onModelSettingsOpenChange={setModelSettingsOpen} />
          </div>
          {notes.hasWorkspace && <div className={notes.open ? "min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 lg:px-8" : "hidden"}><NotesWorkspace /></div>}
        </main>
      </div>
      <SessionInspectorPanel nav={nav} />
      </div>
    </NotificationsProvider>
  )
}

export default App
