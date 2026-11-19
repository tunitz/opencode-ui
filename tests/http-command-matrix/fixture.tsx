/**
 * Synthetic fixture for the non-loopback plain-HTTP command matrix.
 *
 * This file is test-only. It mounts the real Composer against an in-memory
 * controller with a synthetic dynamic catalog entry (`team/review`). It never
 * contacts a real engine: the only network call is a same-origin POST to the
 * synthetic `/api/command` route served by http-command-matrix.ts, so the
 * "exactly one executeCommand call / no POST" assertions are observable both in
 * the QA log and on the wire.
 */
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import { AppDirection } from "@/components/app-direction"
import { AuthGateProvider } from "@/components/auth-context"
import { Composer } from "@/components/composer"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceProvider } from "@/components/workspace-context"
import type { CommandInfo, SessionInfo, SessionMessageInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

type QACall = {
  kind: string
  value?: string
  args?: Record<string, unknown>
}

type MatrixWindow = Window & {
  __qa: { calls: QACall[] }
  __setCatalogEpoch: (epoch: number) => void
  __getCatalogEpoch: () => number
  __setCommandsStatus: (status: string) => void
  __setCommandsDirectory: (directory: string) => void
  __setCommandAvailable: (name: string, available: boolean) => void
  __staleCatalog: () => void
  __resetCatalog: () => void
  __failNextCommand: () => void
}

const matrixWindow = window as unknown as MatrixWindow
matrixWindow.__qa = { calls: [] }

const DIRECTORY = "/synthetic/alpha"
const REVIEW_COMMAND: CommandInfo = {
  name: "team/review",
  description: "Synthetic dynamic review command",
}

function log(kind: string, value?: string, args?: Record<string, unknown>) {
  matrixWindow.__qa.calls.push({ kind, value, args })
}

const now = Date.now()
const activeSession = {
  id: "ses_alpha",
  projectID: "p-alpha",
  title: "Alpha",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: now - 60_000, updated: now },
  location: { directory: DIRECTORY },
  model: { providerID: "synthetic", id: "synthetic-model" },
} as unknown as SessionInfo

const messages: SessionMessageInfo[] = [
  {
    type: "user",
    id: "u-synthetic",
    time: { created: now - 2_000 },
    text: "Synthetic question",
  },
  {
    type: "assistant",
    id: "a-synthetic",
    agent: "build",
    model: { providerID: "synthetic", id: "synthetic-model" },
    time: { created: now - 1_000, completed: now },
    content: [{ type: "text", text: "Synthetic assistant answer for /copy." }],
  },
] as unknown as SessionMessageInfo[]

function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthGateProvider>
      <AppDirection>
        <ThemeProvider>
          <TooltipProvider delay={0}>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </TooltipProvider>
        </ThemeProvider>
      </AppDirection>
    </AuthGateProvider>
  )
}

function useMatrixNav() {
  const [catalogEpoch, setCatalogEpoch] = useState(0)
  const [commandsStatus, setCommandsStatus] = useState("ready")
  const [commandsDirectory, setCommandsDirectory] = useState(DIRECTORY)
  const [commands, setCommands] = useState<CommandInfo[]>([REVIEW_COMMAND])
  const failNextCommandRef = useRef(false)

  useEffect(() => {
    matrixWindow.__setCatalogEpoch = (epoch) => setCatalogEpoch(epoch)
    matrixWindow.__getCatalogEpoch = () => catalogEpoch
    matrixWindow.__setCommandsStatus = (status) => setCommandsStatus(status)
    matrixWindow.__setCommandsDirectory = (directory) =>
      setCommandsDirectory(directory)
    matrixWindow.__setCommandAvailable = (name, available) =>
      setCommands((current) =>
        available
          ? current.some((entry) => entry.name === name)
            ? current
            : [...current, { name, description: `Synthetic ${name}` }]
          : current.filter((entry) => entry.name !== name)
      )
    matrixWindow.__staleCatalog = () => {
      setCatalogEpoch((epoch) => epoch + 1)
      setCommandsStatus("stale")
      setCommandsDirectory("/synthetic/stale")
    }
    matrixWindow.__resetCatalog = () => {
      setCatalogEpoch(0)
      setCommandsStatus("ready")
      setCommandsDirectory(DIRECTORY)
      setCommands([REVIEW_COMMAND])
    }
    matrixWindow.__failNextCommand = () => {
      failNextCommandRef.current = true
    }
  }, [catalogEpoch])

  const nav = {
    connection: "connected",
    connectionError: null,
    connectionStatus: "connected",
    scope: "all",
    location: {
      directory: DIRECTORY,
      project: { id: "p-alpha", directory: DIRECTORY, canonical: DIRECTORY },
    },
    directory: DIRECTORY,
    directoryError: null,
    projects: [],
    projectsStatus: "ready",
    projectsError: null,
    projectError: null,
    projectBusy: false,
    serverVersion: "2.1.4",
    startupNotice: null,
    sessions: [activeSession],
    sessionsStatus: "ready",
    sessionsError: null,
    runningSessionIDs: {},
    unreadSessionIDs: {},
    activeSessionID: activeSession.id,
    activeSession,
    messages,
    historyStatus: "ready",
    streamStatus: "ready",
    historyError: null,
    hasOlder: false,
    loadingOlder: false,
    olderError: null,
    olderCursor: null,
    focusMessageID: null,
    pendingPermissions: [],
    pendingForms: [],
    formBusy: {},
    models: [
      {
        id: "synthetic-model",
        modelID: "synthetic-model",
        providerID: "synthetic",
        name: "Synthetic Model",
        variants: [{ id: "high" }],
        enabled: true,
        status: "active",
        capabilities: {},
        cost: [],
        limit: { context: 100000, output: 10000 },
        time: { released: now },
      },
    ],
    modelsStatus: "ready",
    modelsError: null,
    agents: [
      { id: "build", name: "Build", mode: "primary", hidden: false },
    ],
    agentsStatus: "ready",
    agentsError: null,
    configEntries: [],
    attachments: [],
    commands,
    commandsStatus,
    commandsError: null,
    commandsDirectory,
    catalogEpoch,
    commandsEpoch: catalogEpoch,
    draftPruneIds: [],
    composerRestore: null,
    interrupting: false,
    sending: false,
    creating: false,
    switchingAgent: false,
    switchingModel: false,
    archivedSessions: [],
    archivedStatus: "ready",
    archivedError: null,
    inbox: [],
    inboxStatus: "ready",
    inboxError: null,
    inboxBusy: {},
    selectProject: async () => undefined,
    selectAllProjects: () => undefined,
    selectSession: () => undefined,
    openSessionByID: async () => null,
    openSession: () => undefined,
    retryConnection: () => log("retryConnection"),
    retryProjects: () => log("retryProjects"),
    refreshSessions: () => log("refreshSessions"),
    dismissStartupNotice: () => undefined,
    createSession: async () => {
      log("createSession")
      return true
    },
    checkProjectDirectory: async () => null,
    renameSession: async (sessionID: string, title: string) => {
      log("renameSession", `${sessionID}:${title}`)
      return null
    },
    deleteSession: async () => null,
    sendPrompt: async () => {
      log("sendPrompt")
      return null
    },
    openInspector: (tab: string) => {
      log("openInspector", tab)
    },
    openInspectorDiff: () => undefined,
    setChangesScope: () => undefined,
    setSessionArchived: async () => null,
    loadArchivedSessions: async () => null,
    unarchiveSession: async () => null,
    loadInbox: async () => null,
    cancelInboxItem: async () => null,
    takeBackInboxItem: async () => null,
    steerInboxItem: async () => null,
    clearComposerRestore: () => undefined,
    loadTurnDiff: async () => ({ ok: false, reason: "Synthetic." }),
    loadSessionContext: async () => null,
    loadSessionStats: async () => null,
    searchSessions: async () => ({ ok: true, sessions: [] }),
    closeInspector: () => log("closeInspector"),
    setInspectorTab: () => undefined,
    addAttachment: () => null,
    removeAttachment: () => undefined,
    attachProjectFile: async () => null,
    interruptSession: async () => null,
    switchAgent: async () => null,
    switchAgentWithDefaults: async () => null,
    switchModel: async () => null,
    subscribeSessionListChanges: () => () => undefined,
    replyPermission: async () => null,
    replyForm: async () => null,
    cancelForm: async () => null,
    executeCommand: async (
      name: string,
      text: string,
      attachments: readonly unknown[],
      skills: readonly unknown[] = []
    ) => {
      log("executeCommand", name, {
        name,
        text,
        attachments: attachments.length,
        skills: [...skills],
      })
      const simulateUnknown = failNextCommandRef.current
      failNextCommandRef.current = false
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          text,
          skills: [...skills],
          ...(simulateUnknown ? { simulateUnknown: true } : {}),
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          _tag?: unknown
          name?: unknown
        }
        if (body._tag === "CommandNotFoundError" || body.name === "CommandNotFoundError") {
          log("reloadCommands")
          return "The command is no longer available. The catalog was refreshed; choose the command again."
        }
        return "Synthetic command endpoint failed."
      }
      return null
    },
    reloadCommands: () => log("reloadCommands"),
    retryCatalogs: () => log("retryCatalogs"),
    retryStream: () => log("retryStream"),
    retryHistory: () => log("retryHistory"),
    loadOlderMessages: async () => undefined,
    forkSession: async () => null,
    compactSession: async () => null,
    stageRevert: async () => null,
    clearRevert: async () => null,
    moveSession: async () => null,
    revealMessage: async () => undefined,
    clearFocusMessage: () => undefined,
    clearSessionView: () => log("clearSessionView"),
    reloadConfiguration: async () => null,
  } as unknown as OpenCodeController

  return nav
}

function MatrixFixture() {
  const nav = useMatrixNav()
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  return (
    <Providers>
      <div className="flex h-svh min-h-0 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <button
            type="button"
            aria-label="Open sessions"
            className="min-h-11 rounded-lg border px-3 text-xs"
            onClick={() => log("ui:Open sessions")}
          >
            Sessions
          </button>
          <button
            type="button"
            aria-label="New session"
            className="min-h-11 rounded-lg border px-3 text-xs"
            onClick={() => log("ui:New session")}
          >
            New
          </button>
          <button
            type="button"
            aria-label="Settings"
            className="min-h-11 rounded-lg border px-3 text-xs"
            onClick={() => log("ui:Settings")}
          >
            Settings
          </button>
          <button
            type="button"
            aria-label="Active model synthetic"
            className="min-h-11 rounded-lg border px-3 text-xs"
            onClick={() => log("ui:Active model")}
          >
            Model
          </button>
          <aside>
            <nav aria-label="Sessions">
              <button type="button" title="ses_alpha" className="min-h-11 px-2 text-xs">
                Alpha
              </button>
            </nav>
          </aside>
        </header>
        <main className="flex min-h-0 flex-1 flex-col md:px-6 lg:px-8">
          <Composer
            nav={nav}
            modelSettingsOpen={modelSettingsOpen}
            onModelSettingsOpenChange={(open) => {
              log("onModelSettingsOpenChange", String(open))
              setModelSettingsOpen(open)
            }}
            onOpenSettings={() => log("onOpenSettings")}
          />
        </main>
      </div>
    </Providers>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root")
createRoot(root).render(
  <StrictMode>
    <div data-fixture="command-matrix" style={{ minHeight: "100svh" }}>
      <MatrixFixture />
    </div>
  </StrictMode>
)
