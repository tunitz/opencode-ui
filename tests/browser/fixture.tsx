/**
 * Isolated browser fixture for synthetic interaction checks.
 *
 * This file is test-only. It mounts real product components against in-memory
 * controllers and synthetic data. It never contacts an engine: the temporary
 * static server in run.ts answers the handful of same-origin API routes that
 * the mounted panels request with fixed, synthetic JSON.
 */
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { StrictMode, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
import { SessionInspector, SessionInspectorPanel } from "@/components/session-inspector"
import { SessionSidebar, SessionsSheet } from "@/components/session-nav"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceProvider } from "@/components/workspace-context"
import type { FormInfo, SessionInfo, SessionInboxInfo, SessionMessageInfo } from "@/lib/opencode"
import type { ComposerAttachment } from "@/lib/attachments"
import type { OpenCodeController } from "@/lib/use-opencode"
import { liveRunStore } from "@/lib/live-run-store"
import { recordPerfMark, recordPerfRender } from "@/lib/perf-probe"
import { MessageFilesFixture } from "./message-files-fixture"

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
    sessionsHasMore: false,
    loadingMoreSessions: false,
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
    archivedHasMore: false,
    loadingMoreArchived: false,
    inbox: [],
    inboxStatus: "ready" as const,
    inboxError: null,
    inboxBusy: {},
    composerRestore: null,
    compactionNotice: null,
    clearCompactionNotice: () => undefined,
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
    loadMoreSessions: async () => {
      log("loadMoreSessions")
      return null
    },
    loadSubsessionPage: async (parentID: string, cursor?: string | null) => {
      log("loadSubsessionPage", `${parentID}:${cursor ?? "first"}`)
      return { ok: true as const, sessions: [], nextCursor: null }
    },
    loadPinnedSessions: async () => [],
    loadMoreArchivedSessions: async () => {
      log("loadMoreArchivedSessions")
      return null
    },
    dismissStartupNotice: () => log("dismissStartupNotice"),
    createSession: async (
      projectID: string,
      selection: {
        agentID: string | null
        model: { providerID: string; id: string; variant?: string }
      },
      directory?: string
    ) => {
      log("createSession", JSON.stringify({ projectID, selection, directory }))
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
    searchSessionPage: async () => ({ ok: true as const, sessions: [], nextCursor: null }),
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
        reasonings: {}, tools: {}, order: [{ kind: "text", key: "stream" }], pendingUsers: [], notices: [], error: null, seen: new Set<string>(), startedAt: now, nextSeq: 2,
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

/**
 * Inspector Activity queue interactions. This fixture drives the real panel,
 * composer, and inspector sheet against an in-memory controller so steer,
 * rejected actions, and returning a prompt to an existing draft are observable
 * without touching an engine.
 */
function InspectorQueueFixture() {
  const base = useComposerNav()
  const [inbox, setInbox] = useState<SessionInboxInfo[]>(() => [
    {
      id: "inbox-first",
      sessionID: "s-alpha",
      time: { created: now },
      type: "user",
      delivery: "queue",
      payload: {
        text: "Return this queued prompt",
        files: [
          {
            data: "cXVldWVk",
            mime: "text/plain",
            source: { type: "uri", uri: "file:///synthetic/queued.txt" },
            name: "queued.txt",
          },
        ],
      },
    },
    {
      id: "inbox-second",
      sessionID: "s-alpha",
      time: { created: now - 1_000 },
      type: "user",
      delivery: "queue",
      payload: { text: "Second queued prompt" },
    },
    {
      id: "inbox-third",
      sessionID: "s-alpha",
      time: { created: now - 2_000 },
      type: "user",
      delivery: "queue",
      payload: { text: "Third queued prompt" },
    },
  ] as unknown as SessionInboxInfo[])
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() => [
    {
      id: "existing-1",
      name: "existing.txt",
      mime: "text/plain",
      size: null,
      uri: "file:///synthetic/existing.txt",
      source: "uri",
    },
  ])
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [composerRestores, setComposerRestores] = useState<
    Record<string, NonNullable<OpenCodeController["composerRestore"]>[]>
  >({})
  const restoreNonceRef = useRef(0)
  const composerRestore = composerRestores["s-alpha"]?.[0] ?? null
  const inboxRef = useRef(inbox)
  const attachmentsRef = useRef(attachments)
  const rejectNextRef = useRef(false)
  useEffect(() => {
    inboxRef.current = inbox
    attachmentsRef.current = attachments
  }, [inbox, attachments])

  const nav = {
    ...base,
    inbox,
    inboxStatus: "ready",
    inboxError: null,
    inboxBusy: {},
    inspectorOpen,
    inspectorTab: "activity",
    attachments,
    composerRestore,
    closeInspector: () => {
      log("closeInspector")
      setInspectorOpen(false)
    },
    loadInbox: async () => {
      log("loadInbox")
      return null
    },
    steerInboxItem: async (inboxID: string) => {
      log("steerInboxItem", inboxID)
      if (rejectNextRef.current) {
        rejectNextRef.current = false
        return "The engine rejected the steer request."
      }
      setInbox((current) =>
        current.map((item) =>
          item.id === inboxID && item.type === "user"
            ? { ...item, delivery: "steer" }
            : item
        )
      )
      return null
    },
    takeBackInboxItem: async (inboxID: string) => {
      log("takeBackInboxItem", inboxID)
      const item = inboxRef.current.find((entry) => entry.id === inboxID)
      if (!item || item.type !== "user") return "That queued prompt is no longer waiting."
      setInbox((current) => current.filter((entry) => entry.id !== inboxID))
      restoreNonceRef.current += 1
      const restore = {
        sessionID: "s-alpha",
        text: item.payload.text,
        files: (item.payload.files ?? []).flatMap((file) =>
          file.source.type === "uri"
            ? [{ uri: file.source.uri, name: file.name ?? "attachment", mime: file.mime }]
            : []
        ),
        nonce: restoreNonceRef.current,
      }
      setComposerRestores((current) => ({
        ...current,
        "s-alpha": [...(current["s-alpha"] ?? []), restore],
      }))
      return null
    },
    cancelInboxItem: async (inboxID: string) => {
      log("cancelInboxItem", inboxID)
      if (rejectNextRef.current) {
        rejectNextRef.current = false
        return "The engine rejected the cancel request."
      }
      setInbox((current) => current.filter((entry) => entry.id !== inboxID))
      return null
    },
    clearComposerRestore: (consumed?: { sessionID: string; nonce: number }) => {
      const sessionID = consumed?.sessionID ?? "s-alpha"
      setComposerRestores((current) => {
        const list = current[sessionID]
        if (!list?.length) return current
        const head = list[0]
        if (
          consumed &&
          (head.sessionID !== consumed.sessionID || head.nonce !== consumed.nonce)
        ) {
          return current
        }
        const remaining = list.slice(1)
        const next = { ...current }
        if (remaining.length) next[sessionID] = remaining
        else delete next[sessionID]
        return next
      })
    },
    addAttachment: (attachment: ComposerAttachment) => {
      if (attachmentsRef.current.some((item) => item.uri === attachment.uri)) {
        return `${attachment.name} is already attached.`
      }
      attachmentsRef.current = [...attachmentsRef.current, attachment]
      setAttachments(attachmentsRef.current)
      return null
    },
    removeAttachment: (attachmentID: string) => {
      attachmentsRef.current = attachmentsRef.current.filter(
        (item) => item.id !== attachmentID
      )
      setAttachments(attachmentsRef.current)
    },
  } as unknown as OpenCodeController

  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-w-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-border p-2">
            <span className="text-sm">Queue fixture</span>
            <SessionInspector
              nav={nav}
              onOpenSettings={() => undefined}
              onOpenWorktrees={() => undefined}
            />
            <button
              type="button"
              data-qa-reject-next
              className="min-h-11 rounded-lg border px-2 text-xs"
              onClick={() => {
                rejectNextRef.current = true
                log("rejectNext")
              }}
            >
              Reject next action
            </button>
          </header>
          <main className="flex min-h-0 flex-1 flex-col px-3">
            <Composer nav={nav} />
          </main>
        </div>
        <SessionInspectorPanel
          nav={nav}
          onOpenSettings={() => undefined}
          onOpenWorktrees={() => undefined}
        />
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

/* -------------------------------------------------------------------------- *
 * Wave 0 performance fixtures.
 *
 * These are test-only, in-memory mirrors of the production row render sites.
 * They mount real Base UI primitives and the real Conversation component, but
 * instrument each row with recordPerfRender / data-perf-row so counts are
 * observable. No engine, provider, filesystem, or network is contacted.
 * -------------------------------------------------------------------------- */

type PerfOption = { value: string; label: string; detail?: string }

const PERF_TTL_MS = 60_000
const perfCatalogCache = new Map<string, number>()

type PerfNativeWindow = Window & { __perfNativeCalls?: Record<string, number> }

function perfLoadCatalog(kind: string) {
  const loadedAt = perfCatalogCache.get(kind)
  if (loadedAt !== undefined && performance.now() - loadedAt < PERF_TTL_MS) return
  const target = window as PerfNativeWindow
  const calls = (target.__perfNativeCalls ??= {})
  calls[kind] = (calls[kind] ?? 0) + 1
  recordPerfMark(`native:${kind}`)
  perfCatalogCache.set(kind, performance.now())
}

function perfMatches(option: PerfOption, query: string): boolean {
  const text = `${option.label} ${option.detail ?? ""} ${option.value}`.toLocaleLowerCase()
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

const PerfPickerRow = memo(function PerfPickerRow({
  option,
  favorite,
  showFavorite,
  onToggleFavorite,
}: {
  option: PerfOption
  favorite: boolean
  showFavorite: boolean
  onToggleFavorite?: (value: string) => void
}) {
  recordPerfRender("PickerSelectRow")
  return (
    <ComboboxPrimitive.Item
      value={option}
      data-perf-row="picker"
      data-perf-value={option.value}
      className="relative flex min-h-11 w-full cursor-default items-start gap-2 rounded-md py-2 ps-2 pe-14 text-sm outline-hidden select-none data-highlighted:bg-accent"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{option.label}</span>
        {option.detail ? (
          <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
            {option.detail}
          </span>
        ) : null}
      </span>
      {showFavorite ? (
        <button
          type="button"
          aria-label={favorite ? `Unfavorite ${option.label}` : `Favorite ${option.label}`}
          data-perf-favorite={option.value}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleFavorite?.(option.value)
          }}
          className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center"
        >
          {favorite ? "★" : "☆"}
        </button>
      ) : null}
    </ComboboxPrimitive.Item>
  )
})

function PerfPicker({
  label,
  options,
  favorites,
  onToggleFavorite,
  catalogKind,
}: {
  label: string
  options: PerfOption[]
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (value: string) => void
  catalogKind?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(
    () => (query.trim() ? options.filter((option) => perfMatches(option, query)) : options),
    [options, query]
  )
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next && catalogKind) perfLoadCatalog(catalogKind)
      setOpen(next)
      if (!next) setQuery("")
    },
    [catalogKind]
  )
  return (
    <ComboboxPrimitive.Root
      items={filtered}
      value={null}
      open={open}
      onOpenChange={handleOpenChange}
      onValueChange={() => undefined}
      autoHighlight={false}
      filter={() => true}
    >
      <ComboboxPrimitive.Trigger
        type="button"
        aria-label={label}
        data-perf-trigger={label}
        className="flex h-11 w-full items-center justify-between rounded-lg border px-3 text-sm"
      >
        <span>{open ? "Open" : `Choose ${label}`}</span>
        <ComboboxPrimitive.Icon>▾</ComboboxPrimitive.Icon>
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner side="bottom" align="start" sideOffset={6}>
          <ComboboxPrimitive.Popup
            aria-label={label}
            data-perf-popup={label}
            className="flex max-h-[24rem] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
          >
            <ComboboxPrimitive.Input
              aria-label={`Search ${label}`}
              data-perf-search={label}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label}`}
              className="h-11 w-full rounded-lg border px-3 text-sm"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ComboboxPrimitive.List data-perf-list={label} className="outline-0">
                {(option: PerfOption) => (
                  <PerfPickerRow
                    key={option.value}
                    option={option}
                    favorite={favorites?.has(option.value) ?? false}
                    showFavorite={Boolean(onToggleFavorite)}
                    onToggleFavorite={onToggleFavorite}
                  />
                )}
              </ComboboxPrimitive.List>
            </div>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

function perfModelOptions(count: number): PerfOption[] {
  return Array.from({ length: count }, (_, index) => {
    const value = `provider-${index % 12}/model-${index}`
    return { value, label: `Synthetic Model ${index}`, detail: value }
  })
}

function perfAgentOptions(count: number): PerfOption[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `agent-${index}`,
    label: `Synthetic Agent ${index}`,
    detail: `synthetic/agent-${index}`,
  }))
}

function PerfModelsFixture() {
  const options = useMemo(() => perfModelOptions(2_000), [])
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => new Set<string>(["provider-0/model-0"])
  )
  const toggle = useCallback((value: string) => {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }, [])
  return (
    <div className="p-4" style={{ width: 480 }}>
      <PerfPicker
        label="Model"
        options={options}
        favorites={favorites}
        onToggleFavorite={toggle}
        catalogKind="models"
      />
    </div>
  )
}

function PerfAgentsFixture() {
  const options = useMemo(() => perfAgentOptions(200), [])
  return (
    <div className="p-4" style={{ width: 480 }}>
      <PerfPicker label="Agent" options={options} catalogKind="agents" />
    </div>
  )
}

const PerfNoteRow = memo(function PerfNoteRow({ title }: { title: string }) {
  recordPerfRender("NotesRow")
  return <li data-perf-row="note">{title}</li>
})

function PerfNotesFixture() {
  const notes = useMemo(
    () => Array.from({ length: 1_000 }, (_, index) => ({ id: `n-${index}`, title: `Synthetic note ${index}` })),
    []
  )
  const [query, setQuery] = useState("")
  const filtered = useMemo(
    () => (query.trim() ? notes.filter((note) => note.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : notes),
    [notes, query]
  )
  return (
    <div className="p-4">
      <input
        aria-label="Filter notes"
        data-perf-filter="notes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-11 w-full rounded-lg border px-3 text-sm"
      />
      <ul data-perf-list="notes" className="mt-2">
        {filtered.map((note) => (
          <PerfNoteRow key={note.id} title={note.title} />
        ))}
      </ul>
    </div>
  )
}

const PerfWorktreeRow = memo(function PerfWorktreeRow({ directory }: { directory: string }) {
  recordPerfRender("WorktreeRow")
  return <li data-perf-row="worktree">{directory}</li>
})

function PerfWorktreesFixture() {
  const directories = useMemo(
    () => Array.from({ length: 1_500 }, (_, index) => `/synthetic/worktrees/wt-${String(index).padStart(4, "0")}`),
    []
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(
    () => (query.trim() ? directories.filter((directory) => directory.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : directories),
    [directories, query]
  )
  return (
    <div className="p-4">
      <button
        type="button"
        aria-label="Browse directories"
        data-perf-browse
        onClick={() => setOpen(true)}
        className="h-11 rounded-lg border px-3 text-sm"
      >
        Browse directories
      </button>
      {open ? (
        <>
          <input
            aria-label="Filter directories"
            data-perf-filter="worktrees"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-2 h-11 w-full rounded-lg border px-3 text-sm"
          />
          <ul data-perf-list="worktrees" className="mt-2">
            {filtered.map((directory) => (
              <PerfWorktreeRow key={directory} directory={directory} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

function perfSyntheticMessages(count: number): SessionMessageInfo[] {
  const messages: SessionMessageInfo[] = []
  for (let index = 0; index < count; index += 1) {
    const created = now - (count - index) * 1_000
    if (index % 2 === 0) {
      messages.push({
        type: "user",
        id: `perf-u-${index}`,
        time: { created },
        text: `Synthetic performance question ${index}`,
      })
    } else {
      messages.push({
        type: "assistant",
        id: `perf-a-${index}`,
        agent: "build",
        model: { providerID: "synthetic", id: "model" },
        time: { created, completed: created + 500 },
        content: [{ type: "text", text: `Synthetic performance response ${index}.` }],
      })
    }
  }
  return messages
}

function PerfMessagesFixture() {
  const nav = useSyntheticNav()
  const messages = useMemo(() => perfSyntheticMessages(1_000), [])
  return (
    <Providers nav={nav}>
      <div className="flex h-svh min-h-0 flex-col">
        <Conversation
          sessionKey="s-alpha"
          hasSession
          status="ready"
          error={null}
          messages={messages}
          streamStatus="idle"
          hasOlder={false}
          loadingOlder={false}
          olderError={null}
          serverVersion="fixture"
          revert={null}
          focusMessageID={null}
          onFocusMessageHandled={() => undefined}
          onRetry={() => undefined}
          onLoadOlder={async () => undefined}
        />
      </div>
    </Providers>
  )
}

const fixtureName = new URLSearchParams(window.location.search).get("fixture") ?? "nav"

function Fixture() {
  const fixture = fixtureName
  switch (fixture) {
    case "message-files-three":
      return <MessageFilesFixture testCase="three" />
    case "message-files-many":
      return <MessageFilesFixture testCase="many" />
    case "message-files-binary":
      return <MessageFilesFixture testCase="binary" />
    case "sidebar":
      return <NavFixture />
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
    case "inspector-queue":
      return <InspectorQueueFixture />
    case "pending":
      return <PendingFixture />
    case "perf-models":
      return <PerfModelsFixture />
    case "perf-agents":
      return <PerfAgentsFixture />
    case "perf-notes":
      return <PerfNotesFixture />
    case "perf-worktrees":
      return <PerfWorktreesFixture />
    case "perf-messages":
      return <PerfMessagesFixture />
    case "nav":
    default:
      return <NavFixture />
  }
}

// The runner normally installs this global in an init script. Install a local
// copy as well so a perf fixture also works when opened directly in a browser.
if (
  new URLSearchParams(window.location.search).get("fixture")?.startsWith("perf-") &&
  !window.__opencodePerf
) {
  window.__opencodePerf = { enabled: true, counts: {}, longtasks: [], marks: [] }
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
