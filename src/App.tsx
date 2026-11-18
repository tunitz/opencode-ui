import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
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
import { Button } from "@/components/ui/button"
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-context"
import { useUndoToast, UndoToastProvider } from "@/lib/undo-toast"
import { useAppViewportHeight } from "@/lib/use-app-viewport-height"
import { useOpenCode, type OpenCodeController } from "@/lib/use-opencode"
import { prefetchTargetCatalog } from "@/lib/use-target-catalog"
import { useKeybindings } from "@/lib/use-keybindings"
import { matchesKeybinding } from "@/lib/keybindings"
import { recordPerfRender } from "@/lib/perf-probe"

// Settings is a rarely-opened workspace with a large module graph. Loading it
// on demand keeps it out of the critical chat bundle. The focus target lives on
// the wrapper below so a transition can move focus before the chunk resolves.
const SettingsWorkspace = lazy(() =>
  import("@/components/settings-workspace").then((module) => ({
    default: module.SettingsWorkspace,
  }))
)

// Top-level consumers receive the shared controller. Memoizing them here (the
// shell owns this file) keeps a transient status frame from cascading through
// every subtree when their own props are unchanged. Context subscriptions and
// the external live-run store still bypass these wrappers, so live state is
// never frozen.
const MemoSessionSidebar = memo(SessionSidebar)
const MemoAppHeader = memo(AppHeader)
const MemoPendingInbox = memo(PendingInbox)
const MemoConversation = memo(Conversation)
const MemoContextStrip = memo(ContextStrip)
const MemoQueueStrip = memo(QueueStrip)
const MemoComposer = memo(Composer)
const MemoSessionInspectorPanel = memo(SessionInspectorPanel)
const MemoIntegrationCommandDialogs = memo(IntegrationCommandDialogs)

const EMPTY_MESSAGES: never[] = []

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
      <WorkspaceProvider>
        <NotesProvider nav={nav}>
          <SettingsProvider>
            <AppShell nav={nav} />
          </SettingsProvider>
        </NotesProvider>
      </WorkspaceProvider>
    </UndoToastProvider>
  )
}

function AppShell({ nav }: { nav: OpenCodeController }) {
  const workspace = useWorkspace()
  const notes = useNotesWorkspace()
  const settings = useSettingsWorkspace()
  const undo = useUndoToast()
  const { bindings } = useKeybindings()
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const [worktreesOpen, setWorktreesOpen] = useState(false)
  const chatActive = workspace.active === "chat"

  // Stable callback/object props let the memoized consumers above skip
  // unrelated re-renders instead of being defeated by fresh inline identities.
  const openSettingsAction = settings.openSettings
  const openSettings = useCallback(
    () => openSettingsAction(),
    [openSettingsAction]
  )
  const openWorktrees = useCallback(() => setWorktreesOpen(true), [])
  const closeWorktrees = useCallback(() => setWorktreesOpen(false), [])
  const showUndo = undo.showUndo
  const onDialogResult = useCallback(
    (message: string) => {
      if (message) showUndo(message)
    },
    [showUndo]
  )
  const requestWorkspace = workspace.requestWorkspace
  const onSessionCreated = useCallback(
    () => requestWorkspace("chat"),
    [requestWorkspace]
  )
  const notesForComposer = useMemo(
    () => ({ available: notes.available, load: notes.adapter.list }),
    [notes.available, notes.adapter.list]
  )
  const activeSessionID = nav.activeSessionID
  const onRestorePrompt = useCallback(
    (text: string) => {
      showUndo("Prompt restored to the composer.")
      window.dispatchEvent(
        new CustomEvent("composer-restore-text", {
          detail: { sessionID: activeSessionID, text },
        })
      )
    },
    [activeSessionID, showUndo]
  )

  // Warm the target catalog while the user is still in chat so the New Session
  // and worktree pickers open without a round-trip stall.
  useEffect(() => {
    const directory =
      nav.activeSession?.location.directory ?? nav.location?.directory
    if (directory) prefetchTargetCatalog(directory)
  }, [nav.activeSession?.location.directory, nav.location?.directory])

  // Command opens the inspector's Command tab. It is not a modal search dialog,
  // and it respects custom bindings plus IME/composition. Another workspace is
  // left through the same guarded transition as the header Back control.
  useEffect(() => {
    const commandBinding = bindings.find((binding) => binding.command === "command.open")
    if (!commandBinding || !nav.activeSession) return
    const binding = commandBinding
    const openInspector = nav.openInspector
    const requestWorkspace = workspace.requestWorkspace
    const activeWorkspace = workspace.active
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return
      if (!matchesKeybinding(event, binding, navigator.platform.toLowerCase().includes("mac") ? "mac" : "other")) {
        return
      }
      event.preventDefault()
      if (activeWorkspace === "chat") {
        openInspector("command")
        return
      }
      requestWorkspace("chat", { run: () => openInspector("command") })
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [bindings, nav.activeSession, nav.openInspector, workspace])

  return (
    <NotificationsProvider nav={nav}>
      <a
        href="#chat-main"
        className="sr-only fixed top-2 start-2 z-50 rounded-lg bg-background px-4 py-3 text-foreground shadow-lg focus:not-sr-only focus:outline-2 focus:outline-ring"
      >
        Skip to main content
      </a>
      <div className="app-height app-viewport bg-background md:flex md:h-svh md:overflow-hidden">
        <MemoSessionSidebar nav={nav} />
        <div className="app-height flex min-w-0 flex-1 flex-col md:h-svh">
          <MemoAppHeader
            nav={nav}
            onOpenSettings={openSettings}
            onOpenWorktrees={openWorktrees}
          />
          <main
            id="chat-main"
            tabIndex={-1}
            className="flex min-h-0 w-full min-w-0 flex-1 flex-col focus:outline-none"
          >
            <div
              className={
                !chatActive
                  ? "hidden"
                  : "mx-auto flex min-h-0 w-full max-w-[42.5rem] flex-1 flex-col md:max-w-none md:px-6 lg:px-8"
              }
              inert={!chatActive ? true : undefined}
              aria-hidden={!chatActive ? true : undefined}
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
              <MemoPendingInbox nav={nav} />
              <MemoConversation
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
                onRestorePrompt={onRestorePrompt}
              />
              <MemoContextStrip
                sessionID={nav.activeSessionID}
                hasSession={nav.activeSessionID !== null}
                session={nav.activeSession}
                messages={nav.historyStatus === "ready" ? nav.messages : EMPTY_MESSAGES}
                models={nav.models}
                revert={nav.activeSession?.revert ?? null}
              />
              <MemoQueueStrip nav={nav} />
              <MemoComposer
                nav={nav}
                notes={notesForComposer}
                modelSettingsOpen={modelSettingsOpen}
                onModelSettingsOpenChange={setModelSettingsOpen}
                onOpenSettings={openSettings}
              />
            </div>
            {notes.hasWorkspace && (
              <section
                data-workspace-focus="notes"
                tabIndex={-1}
                aria-label="Notes"
                className={
                  workspace.active === "notes"
                    ? "min-h-0 flex-1 overflow-y-auto px-4 py-4 focus:outline-none md:px-6 lg:px-8"
                    : "hidden"
                }
              >
                {/* The panel is unmounted while another workspace is active.
                    Drafts survive because NotesPanel stashes them in the
                    adapter-keyed workspaceDrafts WeakMap on unmount, and the
                    adapter itself is cached by the NotesProvider above. */}
                {workspace.active === "notes" ? <NotesWorkspace /> : null}
              </section>
            )}
            {workspace.active === "settings" && (
              <div
                data-workspace-focus="settings"
                tabIndex={-1}
                className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 focus:outline-none md:px-6 lg:px-8"
              >
                <Suspense fallback={null}>
                  <SettingsWorkspace nav={nav} />
                </Suspense>
              </div>
            )}
          </main>
        </div>
        <MemoSessionInspectorPanel
          nav={nav}
          onOpenSettings={openSettings}
          onOpenWorktrees={openWorktrees}
        />
      </div>
      <MemoIntegrationCommandDialogs
        kind={worktreesOpen ? "worktrees" : null}
        nav={nav}
        onClose={closeWorktrees}
        onResult={onDialogResult}
        onSessionCreated={onSessionCreated}
      />
    </NotificationsProvider>
  )
}

export default App
