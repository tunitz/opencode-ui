import { useEffect, useRef, useState } from "react"
import { XIcon } from "lucide-react"

import { AppHeader } from "@/components/app-header"
import { AuthGateProvider } from "@/components/auth-context"
import { Composer } from "@/components/composer"
import { ContextStrip } from "@/components/context-strip"
import { Conversation } from "@/components/conversation"
import { IntegrationCommandDialogs } from "@/components/integration-command-dialogs"
import { NotificationsProvider } from "@/components/notifications-provider"
import { NotesProvider, NotesWorkspace, useNotesWorkspace } from "@/components/notes-sidebar"
import { PendingInbox } from "@/components/pending-inbox"
import { QueueStrip } from "@/components/queue-strip"
import { SessionInspectorPanel } from "@/components/session-inspector"
import { SessionSidebar } from "@/components/session-nav"
import {
  SettingsProvider,
  useSettingsWorkspace,
} from "@/components/settings-context"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { Button } from "@/components/ui/button"
import { useUndoToast, UndoToastProvider } from "@/lib/undo-toast"
import { useAppViewportHeight } from "@/lib/use-app-viewport-height"
import { useOpenCode, type OpenCodeController } from "@/lib/use-opencode"
import { useKeybindings } from "@/lib/use-keybindings"
import { matchesKeybinding } from "@/lib/keybindings"
import { recordPerfRender } from "@/lib/perf-probe"

export function App() {
  recordPerfRender("App")
  useAppViewportHeight()

  return (
    <AuthGateProvider>
      <EngineApp />
    </AuthGateProvider>
  )
}

/** Mounted only after the auth gate reports an authenticated session. */
function EngineApp() {
  const nav = useOpenCode()

  return (
    <UndoToastProvider>
      <NotesProvider nav={nav}>
        <SettingsProvider>
          <AppShell nav={nav} />
        </SettingsProvider>
      </NotesProvider>
    </UndoToastProvider>
  )
}


function AppShell({ nav }: { nav: OpenCodeController }) {
  const notes = useNotesWorkspace()
  const settings = useSettingsWorkspace()
  const undo = useUndoToast()
  const { bindings } = useKeybindings()
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const [worktreesOpen, setWorktreesOpen] = useState(false)
  const previousNotesOpen = useRef(notes.open)
  useEffect(() => {
    if (previousNotesOpen.current !== notes.open) {
      previousNotesOpen.current = notes.open
      if (!settings.open) document.getElementById("chat-main")?.focus()
    }
  }, [notes.open, settings.open])

  // Command opens the inspector's Command tab. It is not a modal search dialog,
  // and it respects custom bindings plus IME/composition.
  useEffect(() => {
    const commandBinding = bindings.find((binding) => binding.command === "command.open")
    if (!commandBinding || !nav.activeSession) return
    const binding = commandBinding
    const openInspector = nav.openInspector
    const closeNotes = notes.closeNotes
    const notesOpen = notes.open
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return
      if (!matchesKeybinding(event, binding, navigator.platform.toLowerCase().includes("mac") ? "mac" : "other")) {
        return
      }
      event.preventDefault()
      if (notesOpen) closeNotes()
      openInspector("command")
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [bindings, nav.activeSession, nav.openInspector, notes.closeNotes, notes.open])

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
          <AppHeader
            nav={nav}
            onOpenSettings={() => settings.openSettings()}
            onOpenWorktrees={() => setWorktreesOpen(true)}
          />
          <main
            id="chat-main"
            tabIndex={-1}
            className="flex min-h-0 w-full flex-1 flex-col focus:outline-none"
          >
            <div
              className={
                notes.open || settings.open
                  ? "hidden"
                  : "mx-auto flex min-h-0 w-full max-w-[42.5rem] flex-1 flex-col md:max-w-none md:px-6 lg:px-8"
              }
            >
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
                serverVersion={nav.serverVersion}
                revert={nav.activeSession?.revert ?? null}
                focusMessageID={nav.focusMessageID}
                onFocusMessageHandled={nav.clearFocusMessage}
                onRetry={nav.retryHistory}
                onLoadOlder={nav.loadOlderMessages}
                onOpenDiff={nav.openInspectorDiff}
                onStageRevert={nav.stageRevert}
                onClearRevert={nav.clearRevert}
                onRestorePrompt={(text: string) => {
                  undo.showUndo("Prompt restored to the composer.")
                  window.dispatchEvent(
                    new CustomEvent("composer-restore-text", {
                      detail: { sessionID: nav.activeSessionID, text },
                    })
                  )
                }}
              />
              <ContextStrip
                sessionID={nav.activeSessionID}
                hasSession={nav.activeSessionID !== null}
                session={nav.activeSession}
                messages={nav.historyStatus === "ready" ? nav.messages : []}
                models={nav.models}
                revert={nav.activeSession?.revert ?? null}
              />
              <QueueStrip nav={nav} />
              <Composer
                nav={nav}
                notes={{
                  available: notes.available,
                  load: notes.adapter.list,
                }}
                modelSettingsOpen={modelSettingsOpen}
                onModelSettingsOpenChange={setModelSettingsOpen}
                onOpenSettings={() => settings.openSettings()}
              />
            </div>
            {notes.hasWorkspace && (
              <div
                className={
                  notes.open && !settings.open
                    ? "min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 lg:px-8"
                    : "hidden"
                }
              >
                <NotesWorkspace />
              </div>
            )}
            {settings.open && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 md:px-6 lg:px-8">
                <SettingsWorkspace nav={nav} />
              </div>
            )}
          </main>
        </div>
        <SessionInspectorPanel
          nav={nav}
          onOpenSettings={() => settings.openSettings()}
          onOpenWorktrees={() => setWorktreesOpen(true)}
        />
      </div>
      <IntegrationCommandDialogs
        kind={worktreesOpen ? "worktrees" : null}
        nav={nav}
        onClose={() => setWorktreesOpen(false)}
        onResult={(message) => {
          if (message) undo.showUndo(message)
        }}
        onSessionCreated={() => {
          if (notes.open) notes.closeNotes()
        }}
      />
    </NotificationsProvider>
  )
}

export default App
