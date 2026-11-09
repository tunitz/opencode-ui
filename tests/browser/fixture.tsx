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
import { CommandCenter } from "@/components/command-center"
import { Conversation } from "@/components/conversation"
import { ChangesPanel } from "@/components/files-panel"
import { ModelSettingsDrawer } from "@/components/model-settings"
import { NotesProvider } from "@/components/notes-sidebar"
import { SessionInspector, SessionInspectorPanel } from "@/components/session-inspector"
import { SessionSidebar, SessionsSheet } from "@/components/session-nav"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { SessionInfo, SessionMessageInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"
import { liveRunStore } from "@/lib/live-run-store"

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

const now = Date.now()
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
  session("s-gamma", "Gamma", now - 26 * 60 * 60 * 1000, {
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
] as unknown as OpenCodeController["projects"]

function log(kind: string, value?: string) {
  qaWindow.__qa.calls.push({ kind, value })
}

function useSyntheticNav(initialInspectorOpen = false) {
  const [activeSessionID, setActiveSessionID] = useState<string | null>("s-alpha")
  const [scope, setScope] = useState<OpenCodeController["scope"]>("all")
  const [inspectorOpen, setInspectorOpen] = useState(initialInspectorOpen)
  const [inspectorTab, setInspectorTab] = useState<"files" | "changes">("changes")

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
    agents: [],
    configEntries: [],
    attachments: [],
    inspectorOpen,
    inspectorTab,
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
    openInspector: (tab: "files" | "changes") => {
      log("openInspector", tab)
      setInspectorTab(tab)
      setInspectorOpen(true)
    },
    closeInspector: () => {
      log("closeInspector")
      setInspectorOpen(false)
    },
    setInspectorTab: (tab: "files" | "changes") => {
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
    <AppDirection>
      <ThemeProvider>
        <TooltipProvider delay={0}>
          <NotesProvider nav={nav}>{children}</NotesProvider>
        </TooltipProvider>
      </ThemeProvider>
    </AppDirection>
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

function ConversationFixture({ history = false, longToolErrors = false }: { history?: boolean; longToolErrors?: boolean }) {
  const nav = useSyntheticNav()
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
            <SessionInspector nav={nav} />
          </header>
          <main className="p-4 text-xs">
            <p data-qa-active>Active: {nav.activeSessionID}</p>
            <p data-qa-inspector>
              Inspector: {nav.inspectorOpen ? nav.inspectorTab : "closed"}
            </p>
          </main>
        </div>
        <SessionInspectorPanel nav={nav} />
      </div>
    </Providers>
  )
}

function Fixture() {
  const fixture = new URLSearchParams(window.location.search).get("fixture")
  switch (fixture) {
    case "command":
      return <CommandFixture />
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
    case "nav":
    default:
      return <NavFixture />
  }
}

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root")
createRoot(root).render(
  <StrictMode>
    <div data-fixture={new URLSearchParams(window.location.search).get("fixture") ?? "nav"}>
      <Fixture />
    </div>
  </StrictMode>
)
