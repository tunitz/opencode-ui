/**
 * Isolated browser fixture for synthetic interaction checks.
 *
 * This file is test-only. It mounts real product components against in-memory
 * controllers and synthetic data. It never contacts an engine: the temporary
 * static server in run.ts answers the handful of same-origin API routes that
 * the mounted panels request with fixed, synthetic JSON.
 */
import { StrictMode, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import { AppDirection } from "@/components/app-direction"
import { AuthGateProvider } from "@/components/auth-context"
import { AppHeader } from "@/components/app-header"
import { CommandCenter } from "@/components/command-center"
import { Composer } from "@/components/composer"
import { Conversation } from "@/components/conversation"
import { ChangesPanel } from "@/components/files-panel"
import { ModelSettingsDrawer } from "@/components/model-settings"
import { NotesProvider, NotesSidebar, NotesWorkspace } from "@/components/notes-sidebar"
import { PendingInbox } from "@/components/pending-inbox"
import { SettingsProvider, useSettingsWorkspace } from "@/components/settings-context"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { SessionInspector, SessionInspectorPanel } from "@/components/session-inspector"
import { SessionSidebar, SessionsSheet } from "@/components/session-nav"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceProvider } from "@/components/workspace-context"
import type { FormInfo, SessionInfo, SessionMessageInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"
import { liveRunStore } from "@/lib/live-run-store"
import { useAppViewportHeight } from "@/lib/use-app-viewport-height"

type QACall = { kind: string; value?: string }
type QAWindow = Window & {
  __qa: {
    calls: QACall[]
    openedFiles: string[]
    navigations: string[]
    stream?: (text: string) => void
    streamText?: () => string
  }
}

const qaWindow = window as unknown as QAWindow
qaWindow.__qa = { calls: [], openedFiles: [], navigations: [] }

// Anchor relative session times at local noon so date grouping is stable
// regardless of when the synthetic suite runs.
const now = (() => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  return date.getTime()
})()
const directory = "/synthetic/alpha"

function session(
  id: string,
  title: string,
  updated: number,
  overrides: Partial<SessionInfo> = {}
): SessionInfo {
  return {
    id,
    projectID: "p-alpha",
    title,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: updated - 60_000, updated },
    location: { directory },
    ...overrides,
  } as SessionInfo
}

const sessions: SessionInfo[] = [
  session("s-alpha", "Alpha", now - 1_000),
  session("s-beta", "Beta", now - 2_000, {
    parentID: "s-alpha",
    location: { directory },
  }),
  session("s-gamma", "Gamma", now - 24 * 60 * 60 * 1000, {
    projectID: "p-gamma",
    location: { directory: "/synthetic/gamma" },
  }),
]

const projects = [
  {
    id: "p-alpha",
    canonical: directory,
    name: "Alpha Project",
    time: { created: now - 100_000, updated: now - 1_000 },
    sandboxes: [],
  },
  {
    id: "p-gamma",
    canonical: "/synthetic/gamma",
    name: "Gamma Project",
    time: { created: now - 100_000, updated: now - 1_000 },
    sandboxes: [],
  },
  {
    id: "p-location",
    canonical: "/synthetic/location",
    name: "Location Project",
    time: { created: now - 100_000, updated: now - 1_000 },
    sandboxes: [],
  },
] as unknown as OpenCodeController["projects"]

function log(kind: string, value?: string) {
  qaWindow.__qa.calls.push({ kind, value })
}

function useSyntheticNav(initialInspectorOpen = false) {
  const [activeSessionID, setActiveSessionID] = useState<string | null>("s-alpha")
  const [scope, setScope] = useState<OpenCodeController["scope"]>("all")
  const [inspectorOpen, setInspectorOpen] = useState(initialInspectorOpen)
  const [inspectorTab, setInspectorTab] = useState<
    "command" | "files" | "changes" | "activity" | "session"
  >("changes")
  const [changesScope, setChangesScope] = useState<"working" | "turn">("working")
  const [diffFocusPath, setDiffFocusPath] = useState<string | null>(null)

  const activeSession =
    sessions.find((entry) => entry.id === activeSessionID) ?? null

  const nav = {
    connection: "connected",
    connectionError: null,
    connectionStatus: "connected",
    scope,
    location: {
      directory,
      project: {
        id: "p-location",
        directory,
        canonical: directory,
      },
    },
    directory,
    directoryError: null,
    projects,
    projectsStatus: "ready",
    projectsError: null,
    projectError: null,
    projectBusy: false,
    serverVersion: "2.1.4",
    startupNotice: null,
    sessions,
    sessionsStatus: "ready",
    sessionsError: null,
    runningSessionIDs: { "s-beta": true },
    unreadSessionIDs: { "s-gamma": true },
    activeSessionID,
    activeSession,
    messages: [] as SessionMessageInfo[],
    historyStatus: "ready",
    streamStatus: "idle",
    historyError: null,
    hasOlder: false,
    loadingOlder: false,
    olderError: null,
    olderCursor: null,
    focusMessageID: null,
    pendingPermissions: [],
    pendingForms: [],
    models: [],
    agents: [
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        model: { providerID: "synthetic", id: "synthetic-model" },
      },
    ],
    configEntries: [],
    attachments: [],
    inspectorOpen,
    inspectorTab,
    changesScope,
    diffFocusPath,
    archivedSessions: [] as SessionInfo[],
    archivedStatus: "ready" as const,
    archivedError: null,
    inbox: [],
    inboxStatus: "ready" as const,
    inboxError: null,
    inboxBusy: {},
    composerRestore: null,
    selectProject: async (projectID: string) => {
      log("selectProject", projectID)
      setScope("project")
    },
    selectAllProjects: () => {
      log("selectAllProjects")
      setScope("all")
    },
    selectSession: (sessionID: string) => {
      log("selectSession", sessionID)
      setActiveSessionID(sessionID)
    },
    openSessionByID: async (sessionID: string) => {
      log("openSessionByID", sessionID)
      setActiveSessionID(sessionID)
      return null
    },
    openSession: (entry: SessionInfo) => {
      log("openSession", entry.id)
      setActiveSessionID(entry.id)
    },
    retryConnection: () => log("retryConnection"),
    retryProjects: () => log("retryProjects"),
    refreshSessions: () => log("refreshSessions"),
    dismissStartupNotice: () => log("dismissStartupNotice"),
    createSession: async () => {
      log("createSession")
      return true
    },
    checkProjectDirectory: async () => null,
    renameSession: async (sessionID: string, title: string) => {
      log("renameSession", `${sessionID}:${title}`)
      return null
    },
    deleteSession: async (sessionID: string) => {
      log("deleteSession", sessionID)
      return null
    },
    sendPrompt: async () => null,
    openInspector: (tab: "command" | "files" | "changes" | "activity" | "session") => {
      log("openInspector", tab)
      setInspectorTab(tab)
      setInspectorOpen(true)
    },
    openInspectorDiff: (path?: string | null) => {
      log("openInspectorDiff", path ?? undefined)
      setDiffFocusPath(path ?? null)
      setChangesScope("turn")
      setInspectorTab("changes")
      setInspectorOpen(true)
    },
    setChangesScope: (scope: "working" | "turn") => {
      log("setChangesScope", scope)
      setChangesScope(scope)
    },
    setSessionArchived: async (sessionID: string, archived: boolean) => {
      log("setSessionArchived", `${sessionID}:${archived}`)
      return null
    },
    loadArchivedSessions: async () => {
      log("loadArchivedSessions")
      return null
    },
    unarchiveSession: async (sessionID: string) => {
      log("unarchiveSession", sessionID)
      return null
    },
    loadInbox: async () => null,
    cancelInboxItem: async () => null,
    takeBackInboxItem: async () => null,
    steerInboxItem: async () => null,
    clearComposerRestore: () => undefined,
    loadTurnDiff: async () => ({ ok: false, reason: "Synthetic turn diff is unavailable." }),
    loadSessionContext: async () => null,
    loadSessionStats: async () => null,
    searchSessions: async () => ({ ok: true, sessions: [] }),
    closeInspector: () => {
      log("closeInspector")
      setInspectorOpen(false)
    },
    setInspectorTab: (tab: "command" | "files" | "changes" | "activity" | "session") => {
      log("setInspectorTab", tab)
      setInspectorTab(tab)
    },
    addAttachment: () => null,
    removeAttachment: () => undefined,
    attachProjectFile: async (path: string) => {
      log("attachProjectFile", path)
      return null
    },
    interruptSession: async () => null,
    switchAgent: async () => null,
    switchModel: async () => null,
    subscribeSessionListChanges: () => () => undefined,
    replyPermission: async () => null,
    replyForm: async () => null,
    cancelForm: async () => null,
    executeCommand: async () => null,
    reloadCommands: () => undefined,
    retryCatalogs: () => undefined,
    retryStream: () => undefined,
    retryHistory: () => undefined,
    loadOlderMessages: async () => undefined,
    forkSession: async () => null,
    compactSession: async () => null,
    stageRevert: async () => null,
    clearRevert: async () => null,
    moveSession: async () => null,
    revealMessage: async () => null,
    clearFocusMessage: () => undefined,
    clearSessionView: () => undefined,
    reloadConfiguration: async () => null,
  } as unknown as OpenCodeController

  return nav
}

function useComposerNav() {
  const nav = useSyntheticNav()
  return {
    ...nav,
    activeSession: nav.activeSession
      ? {
          ...nav.activeSession,
          model: {
            providerID: "commandcode",
            id: "deepseek-v4.1-flash",
            variant: "high",
          },
        }
      : null,
    models: [
      {
        id: "deepseek-v4.1-flash",
        modelID: "deepseek-v4.1-flash",
        providerID: "commandcode",
        name: "DeepSeek V4.1 Flash",
        variants: [{ id: "high" }, { id: "low" }],
        enabled: true,
        status: "active",
        capabilities: {},
        cost: [],
        limit: { context: 100000, output: 10000 },
        time: { released: now },
      },
    ] as unknown as OpenCodeController["models"],
    agents: [
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
      },
    ] as unknown as OpenCodeController["agents"],
    agentsStatus: "ready",
    modelsStatus: "ready",
    commands: [],
    commandsStatus: "ready",
    commandsError: null,
    commandsDirectory: null,
    draftPruneIds: [],
    interrupting: false,
    sending: false,
    switchAgent: async (agentID: string) => {
      log("switchAgent", agentID)
      return null
    },
    switchModel: async (model: {
      providerID: string
      id: string
      variant?: string
    }) => {
      log("switchModel", JSON.stringify(model))
      return null
    },
  } as unknown as OpenCodeController
}

const longText = (index: number) =>
  `Synthetic response ${index}. ` +
  "This paragraph exists only to create measurable virtualized height. ".repeat(5)

function syntheticMessages(longToolErrors = false): SessionMessageInfo[] {
  const messages: SessionMessageInfo[] = []
  for (let index = 0; index < 16; index += 1) {
    const created = now - (32 - index) * 1_000
    messages.push({
      type: "user",
      id: `u-${index}`,
      time: { created },
      text: `Synthetic question ${index}`,
    })
    messages.push({
      type: "assistant",
      id: `a-${index}`,
      agent: "build",
      model: { providerID: "synthetic", id: "model" },
      time: { created: created + 100, completed: created + 900 },
      content: [
        { type: "text", text: longText(index) },
        {
          type: "tool",
          id: `tool-${index}`,
          name: "read",
          state: longToolErrors
            ? { status: "error", input: {}, error: { type: "error", message: `Synthetic tool failure <script>bad()</script> ${"long detail ".repeat(30)}END-OF-ERROR` } }
            : { status: "completed", input: { filePath: `src/file-${index}.ts` }, content: [{ type: "text", text: `synthetic content ${index}` }] },
          time: { created: created + 200, completed: created + 300 },
        },
        { type: "text", text: `Closing synthetic text ${index}.` },
      ],
    })
  }
  return messages
}

function Providers({
  nav,
  children,
}: {
  nav: OpenCodeController
  children: ReactNode
}) {
  return (
    <AuthGateProvider>
      <AppDirection>
        <ThemeProvider>
          <TooltipProvider delay={0}>
            <WorkspaceProvider>
              <NotesProvider nav={nav}>{children}</NotesProvider>
            </WorkspaceProvider>
          </TooltipProvider>
        </ThemeProvider>
      </AppDirection>
    </AuthGateProvider>
  )
}

function NavFixture() {
  const nav = useSyntheticNav()
  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-h-0">
        <SessionSidebar nav={nav} />
        <div className="md:hidden">
          <SessionsSheet nav={nav} />
        </div>
        <main className="min-w-0 flex-1 p-4">
          <p className="text-sm" data-qa-active>
            Active: {nav.activeSessionID}
          </p>
          <button
            type="button"
            className="mt-2 min-h-11 rounded-lg border px-3 text-xs"
            onClick={() => void nav.selectProject("p-location")}
          >
            Set project scope
          </button>
          <p className="mt-2 text-xs">
            Synthetic navigation fixture. No engine or session is contacted.
          </p>
        </main>
      </div>
    </Providers>
  )
}

function CommandFixture() {
  const nav = useSyntheticNav()
  const [modelOpen, setModelOpen] = useState(false)
  return (
    <Providers nav={nav}>
      <div className="flex h-svh flex-col">
        <header className="flex items-center border-b border-border p-2">
          <span className="me-auto text-sm">Synthetic header</span>
          <CommandCenter
            nav={nav}
            closeNotes={() => log("closeNotes")}
            focusComposer={() => document.querySelector<HTMLElement>("[data-composer-input]")?.focus()}
            openModelSettings={() => setModelOpen(true)}
          />
        </header>
        <main className="flex-1 p-4">
          <textarea
            aria-label="Synthetic note field"
            className="h-24 w-full rounded-lg border p-2"
            defaultValue=""
          />
          <textarea aria-label="Message" data-composer-input className="h-24 w-full rounded-lg border p-2" />
          <div className="xterm" tabIndex={0} aria-label="Synthetic terminal">Terminal</div>
          <ModelSettingsDrawer nav={nav} open={modelOpen} onOpenChange={setModelOpen} />
        </main>
      </div>
    </Providers>
  )
}

function ComposerFixture() {
  const nav = useComposerNav()
  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-h-0">
        <SessionSidebar nav={nav} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader nav={nav} onOpenSettings={() => undefined} onOpenWorktrees={() => undefined} />
          <main className="flex min-h-0 flex-1 flex-col md:px-6 lg:px-8">
            <Composer nav={nav} />
          </main>
        </div>
      </div>
    </Providers>
  )
}

function ConversationFixture({ history = false, longToolErrors = false }: { history?: boolean; longToolErrors?: boolean }) {  const nav = useSyntheticNav()
  const [messages, setMessages] = useState(() => syntheticMessages(longToolErrors))
  const [hasOlder, setHasOlder] = useState(history)
  const [loadingOlder, setLoadingOlder] = useState(false)
  useEffect(() => {
    qaWindow.__qa.stream = (text) => liveRunStore.update((current) => ({
      ...current,
      "s-alpha": {
        status: "running", texts: { stream: { assistantMessageID: "live-fixture", ordinal: 0, text, ended: false, seq: 1 } },
        reasonings: {}, tools: {}, order: [{ kind: "text", key: "stream" }], pendingUsers: [], notices: [], error: null, seen: {}, startedAt: now, nextSeq: 2,
      },
    }))
    qaWindow.__qa.streamText = () => liveRunStore.getRun("s-alpha")?.texts.stream?.text ?? ""
    return () => {
      delete qaWindow.__qa.stream
      delete qaWindow.__qa.streamText
      liveRunStore.update((current) => {
        const next = { ...current }
        delete next["s-alpha"]
        return next
      })
    }
  }, [])
  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-h-0 flex-col">
        <div className="border-b border-border px-3 py-2 text-xs" data-qa-conversation>
          Synthetic conversation
        </div>
        <Conversation
          sessionKey="s-alpha"
          hasSession
          status="ready"
          error={null}
          messages={messages}
          streamStatus="idle"
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          olderError={null}
          serverVersion="fixture"
          revert={null}
          focusMessageID={null}
          onFocusMessageHandled={() => undefined}
          onRetry={() => undefined}
          onLoadOlder={async () => {
            setLoadingOlder(true)
            await new Promise((resolve) => setTimeout(resolve, 80))
            const older = syntheticMessages().slice(0, 8).map((message) => ({ ...message, id: `older-${message.id}` }))
            setMessages((current) => [...older, ...current])
            setHasOlder(false)
            setLoadingOlder(false)
          }}
        />
      </div>
    </Providers>
  )
}

function ChangesFixture() {
  const nav = useSyntheticNav()
  return (
    <Providers nav={nav}>
      <div className="h-svh overflow-y-auto p-4">
        <ChangesPanel
          nav={nav}
          session={sessions[0]}
          onOpenFile={(path) => {
            qaWindow.__qa.openedFiles.push(path)
            log("openFile", path)
          }}
        />
      </div>
    </Providers>
  )
}

function InspectorFixture() {
  const nav = useSyntheticNav(
    typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches
  )
  return (
    <Providers nav={nav}>
      <div className="flex h-svh">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-border p-2">
            <span className="text-sm">Synthetic inspector host</span>
            <SessionInspector nav={nav} onOpenSettings={() => undefined} onOpenWorktrees={() => undefined} />
          </header>
          <main className="p-4 text-xs">
            <p data-qa-active>Active: {nav.activeSessionID}</p>
            <p data-qa-inspector>
              Inspector: {nav.inspectorOpen ? nav.inspectorTab : "closed"}
            </p>
          </main>
        </div>
        <SessionInspectorPanel nav={nav} onOpenSettings={() => undefined} onOpenWorktrees={() => undefined} />
      </div>
    </Providers>
  )
}

function NotesFixture({ wide = false }: { wide?: boolean }) {
  const [directory, setDirectory] = useState("/synthetic/notes")
  const nav = {
    directory,
    activeSession: null,
    connection: "connected",
    streamStatus: "ready",
    projects: [],
  } as unknown as OpenCodeController
  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-h-0">
        <div className="hidden w-[350px] shrink-0 overflow-y-auto border-e px-3 md:block">
          <button
            type="button"
            data-qa-switch-project
            className="mt-2 min-h-11 w-full rounded-lg border px-3 text-xs"
            onClick={() =>
              setDirectory((current) =>
                current === "/synthetic/notes"
                  ? "/synthetic/alpha"
                  : "/synthetic/notes"
              )
            }
          >
            Switch project
          </button>
          <NotesSidebar />
        </div>
        <div
          className={`${wide ? "w-[680px]" : "w-full md:w-[360px]"} min-w-0 shrink-0 overflow-y-auto px-4 py-2`}
        >
          <NotesWorkspace />
        </div>
        <div className="hidden min-w-0 flex-1 px-4 py-2 text-xs text-muted-foreground md:block">
          Synthetic notes host. No engine is contacted.
        </div>
      </div>
    </Providers>
  )
}

// Mirrors the reported desktop bug: a question whose description contains a
// long unbreakable command token must not stretch the dialog's grid track.
const pendingQuestionForm = {
  id: "form-qa",
  sessionID: "s-alpha",
  title: "Questions",
  fields: [
    {
      key: "login-password-step",
      title: "Login password step",
      description:
        "To finish deployment I need your HealthVault login password hash in ~/.config/healthvault/auth.env. " +
        "Please run this in your own terminal (it reads the password silently and appends only the hash), then tell me when done: " +
        "read -rsp \"Password: \" | pw; echo; bun -e 'const c=require(\"node:crypto\");const s=c.randomBytes(16);" +
        "const h=c.scryptSync(process.argv[1],s,32,{N:16384,r:8,p:1});console.log(`HEALTHVAULT_PASSWORD_HASH=scrypt:16384:8:1:${s.toString(\"hex\")}:${h.toString(\"hex\")}`)' " +
        "`\"$pw\" >> ~/.config/healthvault/auth.env; unset pw How do you want to handle it?",
      type: "string",
      required: true,
    },
  ],
} as unknown as FormInfo

function PendingFixture() {
  const base = useSyntheticNav()
  const nav = {
    ...base,
    pendingForms: [pendingQuestionForm],
    formBusy: {},
    replyForm: async (formID: string) => {
      log("replyForm", formID)
      return null
    },
    cancelForm: async (formID: string) => {
      log("cancelForm", formID)
      return null
    },
  } as unknown as OpenCodeController
  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-h-0 flex-col p-4">
        <PendingInbox nav={nav} />
      </div>
    </Providers>
  )
}

// Long synthetic identifiers exercise the same min-content pressure as real
// provider slugs and markdown agent ids without reading any live catalog.
const settingsModels = [
  {
    id: "deepseek-v4.1-flash-extended-context-preview-2026-11-01",
    modelID: "deepseek-v4.1-flash-extended-context-preview-2026-11-01",
    providerID: "commandcode",
    name: "DeepSeek V4.1 Flash Extended Context Preview",
    variants: [{ id: "high" }, { id: "low" }],
    enabled: true,
    status: "active",
    capabilities: {},
    cost: [],
    limit: { context: 1000000, output: 64000 },
    time: { released: now },
  },
  {
    id: "claude-sonnet-4-5-20250929-thinking-extended-context",
    modelID: "claude-sonnet-4-5-20250929-thinking-extended-context",
    providerID: "anthropic",
    name: "Claude Sonnet 4.5 Thinking Extended Context",
    variants: [{ id: "high" }],
    enabled: true,
    status: "active",
    capabilities: {},
    cost: [],
    limit: { context: 200000, output: 64000 },
    time: { released: now },
  },
] as unknown as OpenCodeController["models"]

function useSettingsNav() {
  const nav = useSyntheticNav()
  return {
    ...nav,
    models: settingsModels,
    modelsStatus: "ready",
    modelsError: null,
    agents: [
      {
        id: "orchestrator-with-an-extremely-long-multi-word-identifier-for-mobile-layouts",
        name: "Orchestrator with an extremely long multi-word identifier for mobile layouts",
        mode: "primary",
        hidden: false,
      },
    ],
    agentsStatus: "ready",
    agentsError: null,
  } as unknown as OpenCodeController
}

function SettingsShell({ nav }: { nav: OpenCodeController }) {
  useAppViewportHeight()
  const settings = useSettingsWorkspace()
  useEffect(() => {
    settings.openSettings("agents")
    // Open once for this fixture; the workspace layout is the subject.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Render the shell only once Settings is the active pane; the header's
  // closed-state controls are covered by other fixtures.
  if (!settings.open) return null
  return (
    <div className="app-height app-viewport bg-background md:flex md:h-svh md:overflow-hidden">
      <div className="app-height flex min-w-0 flex-1 flex-col md:h-svh">
        <AppHeader nav={nav} onOpenSettings={() => undefined} onOpenWorktrees={() => undefined} />
        <main
          id="chat-main"
          tabIndex={-1}
          className="flex min-h-0 w-full min-w-0 flex-1 flex-col focus:outline-none"
        >
          {settings.open ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 md:px-6 lg:px-8">
              <SettingsWorkspace nav={nav} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}

function SettingsFixture() {
  const nav = useSettingsNav()
  return (
    <Providers nav={nav}>
      <SettingsProvider>
        <SettingsShell nav={nav} />
      </SettingsProvider>
    </Providers>
  )
}

function Fixture() {
  const fixture = new URLSearchParams(window.location.search).get("fixture")
  switch (fixture) {
    case "notes":
      return <NotesFixture />
    case "notes-wide":
      return <NotesFixture wide />
    case "command":
      return <CommandFixture />
    case "composer":
      return <ComposerFixture />
    case "conversation":
      return <ConversationFixture />
    case "conversation-history":
      return <ConversationFixture history />
    case "conversation-long-tool":
      return <ConversationFixture longToolErrors />
    case "changes":
      return <ChangesFixture />
    case "inspector":
      return <InspectorFixture />
    case "pending":
      return <PendingFixture />
    case "settings":
      return <SettingsFixture />
    case "nav":
    default:
      return <NavFixture />
  }
}

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root")
createRoot(root).render(
  <StrictMode>
    {/* The fixed app shell does not contribute height to this wrapper, but the
        browser runner waits for the fixture marker to be visible. */}
    <div
      data-fixture={new URLSearchParams(window.location.search).get("fixture") ?? "nav"}
      style={{ minHeight: "100svh" }}
    >
      <Fixture />
    </div>
  </StrictMode>
)
