import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { ServerIcon, XIcon } from "lucide-react"

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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-context"
import { useUndoToast, UndoToastProvider } from "@/lib/undo-toast"
import { useAppViewportHeight } from "@/lib/use-app-viewport-height"
import { useEngineConnection, type EngineConnectionCheck } from "@/lib/use-engine-connection"
import { useOpenCode, type OpenCodeController } from "@/lib/use-opencode"
import { prefetchTargetCatalog } from "@/lib/use-target-catalog"
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

/** The home shell is available even before an engine is configured. */
function EngineApp() {
  const { check, retry } = useEngineConnection()
  const nav = useOpenCode(check.kind === "configured")

  return (
    <UndoToastProvider>
      <WorkspaceProvider>
        <NotesProvider nav={nav}>
          <SettingsProvider>
            <AppShell nav={nav} engineCheck={check} retryEngineCheck={retry} />
          </SettingsProvider>
        </NotesProvider>
      </WorkspaceProvider>
    </UndoToastProvider>
  )
}

function AppShell({ nav, engineCheck, retryEngineCheck }: {
  nav: OpenCodeController
  engineCheck: EngineConnectionCheck
  retryEngineCheck: () => void
}) {
  const workspace = useWorkspace()
  const notes = useNotesWorkspace()
  const settings = useSettingsWorkspace()
  const undo = useUndoToast()
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
  const openConnections = useCallback(
    () => openSettingsAction("connection"),
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
              {engineCheck.kind !== "configured" ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ServerIcon aria-hidden="true" />
                    </EmptyMedia>
                    {engineCheck.kind === "loading" ? (
                      <EmptyDescription role="status">Checking connections…</EmptyDescription>
                    ) : engineCheck.kind === "error" ? (
                      <EmptyDescription role="alert">{engineCheck.message}</EmptyDescription>
                    ) : (
                      <>
                        <h2 className="text-sm font-medium">No available connections</h2>
                        <EmptyDescription>Add an OpenCode engine in Settings to start chatting.</EmptyDescription>
                      </>
                    )}
                  </EmptyHeader>
                  {engineCheck.kind !== "loading" ? (
                    <EmptyContent>
                      <Button type="button" className="h-11" onClick={openConnections}>
                        Open Connection Settings
                      </Button>
                      {engineCheck.kind === "error" ? (
                        <Button type="button" variant="outline" className="h-11" onClick={retryEngineCheck}>
                          Retry
                        </Button>
                      ) : null}
                    </EmptyContent>
                  ) : null}
                </Empty>
              ) : (
                <>
                  {nav.startupNotice ? (
                    <div
                      role="status"
                      className="mx-4 mt-2 flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
                    >
                      <span className="min-w-0 break-words">{nav.startupNotice}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        aria-label="Dismiss startup notice"
                        className="size-11 shrink-0"
                        onClick={nav.dismissStartupNotice}
                      >
                        <XIcon aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                  {nav.compactionNotice?.sessionID === activeSessionID ? (
                    <div
                      role={nav.compactionNotice.status === "failed" ? "alert" : "status"}
                      className="mx-4 mt-2 flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
                    >
                      <span className="min-w-0 break-words">
                        {nav.compactionNotice.text}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        aria-label="Dismiss compaction status"
                        className="size-11 shrink-0"
                        onClick={nav.clearCompactionNotice}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                  <MemoPendingInbox nav={nav} />
                  <MemoConversation
                    sessionKey={nav.activeSessionID}
                    hasSession={nav.activeSessionID !== null}
                    connection={nav.connection}
                    connectionError={nav.connectionError}
                    onRetryConnection={nav.retryConnection}
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
                </>
              )}
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
                <Suspense
                  fallback={
                    <p role="status" className="py-6 text-sm text-muted-foreground">
                      Loading settings…
                    </p>
                  }
                >
                  <SettingsWorkspace nav={nav} />
                </Suspense>
              </div>
            )}
          </main>
        </div>
        <MemoSessionInspectorPanel
          nav={nav}
          hidden={!chatActive}
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
