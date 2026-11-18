import { useCallback, useEffect, useRef, useState } from "react"

import {
  errorMessage,
  errorTag,
  openCode,
  type AgentInfo,
  type ConfigEntry,
  type CommandInfo,
  type FormAnswer,
  type FileDiffInfo,
  type FormInfo,
  type LocationPublicInfo,
  type ModelInfo,
  type ModelRef,
  type PermissionReply,
  type PermissionRequest,
  type Project,
  type PromptSkillAttachment,
  type SessionInfo,
  type SessionInboxCompaction,
  type SessionInboxInfo,
  type SessionMessageInfo,
  type SessionRevert,
  type SessionStatsInfo,
  type TokenUsageInfo,
} from "@/lib/opencode"
import { agentModelDefaults } from "@/lib/session-selection"
import { createStreamWatchdog } from "@/lib/stream-watchdog"
import { useShallowMemo } from "@/lib/use-shallow-memo"
import { recordPerfMark } from "@/lib/perf-probe"
import { prefetchTargetCatalog } from "@/lib/use-target-catalog"
import {
  applySessionTitle,
  descendantSessionIDs,
  fallbackSessionAfterRemoval,
  normalizeSessionTitle,
} from "@/lib/session-actions"
import {
  EMPTY_SESSION_ACTIVITY,
  forgetSessionActivity,
  markSessionUnread,
  readStoredSessionActivity,
  reconcileSessionActivity,
  sessionActivityStorageKey,
  writeStoredSessionActivity,
  type SessionActivityState,
} from "@/lib/session-activity"
import {
  applySessionEvent,
  emptyLiveRun,
  eventSessionID,
  runCoveredByMessages,
  type LiveRun,
} from "@/lib/session-events"
import { liveRunStore } from "@/lib/live-run-store"
import { removeDraft } from "@/lib/drafts"
import { isAbsoluteDirectory } from "@/lib/session-commands"
import { backoffDelay } from "@/lib/reconnect"
import { mergeOlderMessages } from "@/lib/message-history"
import {
  normalizeChangesScope,
  normalizeInspectorTab,
  readInspectorTab,
  writeInspectorTab,
  type ChangesScope,
  type InspectorTab,
} from "@/lib/inspector-tabs"
import { promptDelivery } from "@/lib/queue"
import {
  type ComposerAttachment,
  liveAttachmentFor,
  promptFileForAttachment,
  validateComposerAttachment,
} from "@/lib/attachments"
import {
  writeStoredLastOpened,
  type LastOpenedScope,
} from "@/lib/web-ui-preferences"
import {
  MAX_ATTACHMENT_BYTES,
  basename,
  fileUri,
  formatFileSize,
  inferMime,
  joinProjectPath,
  probeProjectFileSize,
} from "@/lib/files"
export type ConnectionStatus = "connecting" | "connected" | "offline"
export type LoadStatus = "idle" | "loading" | "ready" | "error"
export type StreamStatus = "idle" | "connecting" | "ready" | "lost"
export type ProjectScope = "project" | "all"
export type { ChangesScope, InspectorTab }

export type NewSessionSelection = {
  agentID: string | null
  model: ModelRef
}

export type RestoredPromptFile = { uri: string; name: string; mime: string }

export type ComposerRestore = {
  sessionID: string
  text: string
  files: RestoredPromptFile[]
  nonce: number
}

export type SessionDiffResult =
  | { ok: true; files: FileDiffInfo[] }
  | { ok: false; reason: string }

export type SessionSearchResult =
  | { ok: true; sessions: SessionInfo[] }
  | { ok: false; error: string }

export type SessionContextSnapshot = {
  messages: SessionMessageInfo[]
  tokens: TokenUsageInfo | null
}

type SessionQuery = {
  directory?: string | null
  projectID?: string | null
}

const SESSION_LIMIT = 50
const MESSAGE_LIMIT = 50
const DESKTOP_VIEWPORT_QUERY = "(min-width: 768px)"
const DESKTOP_INSPECTOR_COLLAPSED_KEY =
  "opencode-ui:desktop-inspector-collapsed:v2"

function isDesktopViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_VIEWPORT_QUERY).matches
  )
}

function readInspectorOpen(): boolean {
  if (!isDesktopViewport()) return false
  try {
    return window.localStorage.getItem(DESKTOP_INSPECTOR_COLLAPSED_KEY) !== "1"
  } catch {
    return true
  }
}

function persistInspectorOpen(open: boolean) {
  if (!isDesktopViewport()) return
  try {
    window.localStorage.setItem(
      DESKTOP_INSPECTOR_COLLAPSED_KEY,
      open ? "0" : "1"
    )
  } catch {
    // A blocked storage API must not affect the inspector state.
  }
}

export type OpenCodeState = {
  connection: ConnectionStatus
  connectionError: string | null
  scope: ProjectScope
  location: LocationPublicInfo | null
  projects: Project[]
  projectsStatus: LoadStatus
  projectsError: string | null
  directory: string
  directoryError: string | null
  serverVersion: string | null
  startupNotice: string | null
  lastOpened: LastOpenedScope | null
  projectBusy: boolean
  projectError: string | null
  sessions: SessionInfo[]
  sessionsStatus: LoadStatus
  sessionsError: string | null
  runningSessionIDs: Record<string, true>
  unreadSessionIDs: Record<string, true>
  activeSessionID: string | null
  messages: SessionMessageInfo[]
  historyStatus: LoadStatus
  historyError: string | null
  olderCursor: string | null
  hasOlder: boolean
  loadingOlder: boolean
  olderError: string | null
  creating: boolean
  createError: string | null
  streamStatus: StreamStatus
  streamError: string | null
  activeSession: SessionInfo | null
  sending: boolean
  interrupting: boolean
  agents: AgentInfo[]
  agentsStatus: LoadStatus
  agentsError: string | null
  configEntries: ConfigEntry[]
  models: ModelInfo[]
  modelsStatus: LoadStatus
  modelsError: string | null
  switchingAgent: boolean
  switchingModel: boolean
  commands: CommandInfo[]
  commandsStatus: LoadStatus
  commandsError: string | null
  commandsDirectory: string | null
  pendingPermissions: PermissionRequest[]
  pendingForms: FormInfo[]
  permissionBusy: Record<string, true>
  formBusy: Record<string, true>
  draftPruneIds: string[]
  attachments: ComposerAttachment[]
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  changesScope: ChangesScope
  diffFocusPath: string | null
  archivedSessions: SessionInfo[]
  archivedStatus: LoadStatus
  archivedError: string | null
  inbox: SessionInboxInfo[]
  inboxStatus: LoadStatus
  inboxError: string | null
  inboxBusy: Record<string, true>
  composerRestore: ComposerRestore | null
  focusMessageID: string | null
}

export type SessionListChange = { sessionID: string | null; parentID?: string }

export type OpenCodeController = OpenCodeState & {
  subscribeSessionListChanges: (listener: (change: SessionListChange) => void) => () => void
  selectProject: (projectID: string) => Promise<void>
  selectAllProjects: () => void
  selectSession: (sessionID: string) => void
  openSessionByID: (sessionID: string) => Promise<string | null>
  retryConnection: () => void
  retryProjects: () => void
  refreshSessions: () => void
  dismissStartupNotice: () => void
  createSession: (
    projectID: string,
    selection?: NewSessionSelection,
    directory?: string
  ) => Promise<boolean>
  checkProjectDirectory: (projectID: string) => Promise<string | null>
  renameSession: (sessionID: string, title: string) => Promise<string | null>
  deleteSession: (sessionID: string) => Promise<string | null>
  sendPrompt: (
    text: string,
    delivery?: "steer" | "queue" | null,
    skills?: readonly PromptSkillAttachment[]
  ) => Promise<string | null>
  openSession: (session: SessionInfo) => void
  openInspector: (tab: InspectorTab) => void
  closeInspector: () => void
  setInspectorTab: (tab: InspectorTab) => void
  setChangesScope: (scope: ChangesScope) => void
  openInspectorDiff: (path?: string | null) => void
  setSessionArchived: (sessionID: string, archived: boolean) => Promise<string | null>
  loadArchivedSessions: () => Promise<string | null>
  unarchiveSession: (sessionID: string) => Promise<string | null>
  loadInbox: (sessionID?: string) => Promise<string | null>
  cancelInboxItem: (inboxID: string) => Promise<string | null>
  takeBackInboxItem: (inboxID: string) => Promise<string | null>
  steerInboxItem: (inboxID: string) => Promise<string | null>
  clearComposerRestore: () => void
  loadTurnDiff: (sessionID: string, from?: string, to?: string) => Promise<SessionDiffResult>
  loadSessionContext: (sessionID: string) => Promise<SessionContextSnapshot | null>
  loadSessionStats: (sessionID: string) => Promise<SessionStatsInfo | null>
  searchSessions: (query: string, archived?: boolean) => Promise<SessionSearchResult>
  addAttachment: (
    attachment: ComposerAttachment,
    sessionID?: string
  ) => string | null
  removeAttachment: (attachmentID: string, sessionID?: string) => void
  attachProjectFile: (relativePath: string) => Promise<string | null>
  interruptSession: () => Promise<string | null>
  switchAgent: (agentID: string) => Promise<string | null>
  /** Switch agent and apply that agent's catalog model/variant when available. */
  switchAgentWithDefaults: (agentID: string) => Promise<string | null>
  switchModel: (model: ModelRef) => Promise<string | null>
  replyPermission: (
    requestID: string,
    decision: PermissionReply
  ) => Promise<string | null>
  replyForm: (formID: string, answer: FormAnswer) => Promise<string | null>
  cancelForm: (formID: string) => Promise<string | null>
  executeCommand: (
    name: string,
    text: string,
    attachments: readonly ComposerAttachment[]
  ) => Promise<string | null>
  reloadCommands: () => void
  retryCatalogs: () => void
  retryStream: () => void
  retryHistory: () => void
  loadOlderMessages: () => Promise<void>
  forkSession: (before?: string) => Promise<string | null>
  compactSession: () => Promise<string | null>
  stageRevert: (messageID: string) => Promise<string | null>
  clearRevert: () => Promise<string | null>
  moveSession: (targetDirectory: string) => Promise<string | null>
  revealMessage: (messageID: string) => Promise<string | null>
  clearFocusMessage: () => void
  clearSessionView: () => void
  reloadConfiguration: () => Promise<string | null>
}

/**
 * Keep an authoritative session snapshot in the current list. A notification
 * click may target a session outside the loaded page/project or one that was
 * moved since the list was fetched; replace the stale row in place and never
 * duplicate it. The surrounding project scope is deliberately untouched.
 */
export function withSessionSnapshot(
  current: SessionInfo[],
  session: SessionInfo
): SessionInfo[] {
  const index = current.findIndex((entry) => entry.id === session.id)
  if (index === -1) return [session, ...current]
  if (current[index] === session) return current
  const next = current.slice()
  next[index] = session
  return next
}

export function useOpenCode(): OpenCodeController {
  const sessionListListeners = useRef(new Set<(change: SessionListChange) => void>())
  const pendingSessionLookup = useRef<{ sessionID: string; changed: boolean } | null>(null)
  const subscribeSessionListChanges = useCallback((listener: (change: SessionListChange) => void) => {
    sessionListListeners.current.add(listener)
    return () => { sessionListListeners.current.delete(listener) }
  }, [])
  const notifySessionListChange = useCallback((change: SessionListChange) => {
    const pending = pendingSessionLookup.current
    if (pending && (change.sessionID === null || change.sessionID === pending.sessionID)) pending.changed = true
    for (const listener of sessionListListeners.current) listener(change)
  }, [])
  const [connection, setConnection] = useState<ConnectionStatus>("connecting")
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [scope, setScopeState] = useState<ProjectScope>("all")
  const [location, setLocation] = useState<LocationPublicInfo | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsStatus, setProjectsStatus] = useState<LoadStatus>("idle")
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [directory, setDirectory] = useState("")
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const [startupNotice, setStartupNotice] = useState<string | null>(null)
  const [lastOpened, setLastOpened] = useState<LastOpenedScope | null>(null)
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsStatus, setSessionsStatus] = useState<LoadStatus>("idle")
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [runningSessionIDs, setRunningSessionIDs] = useState<
    Record<string, true>
  >({})
  const [sessionActivity, setSessionActivity] = useState<SessionActivityState>(
    EMPTY_SESSION_ACTIVITY
  )
  const activityStorageKey =
    serverVersion && typeof window !== "undefined"
      ? sessionActivityStorageKey(window.location.origin, serverVersion)
      : null
  const [loadedActivityKey, setLoadedActivityKey] = useState<string | null>(
    null
  )
  const [activeSessionID, setActiveSessionID] = useState<string | null>(null)
  const [messages, setMessages] = useState<SessionMessageInfo[]>([])
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>("idle")
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle")
  const [streamError, setStreamError] = useState<string | null>(null)
  const [streamKey, setStreamKey] = useState(0)
  const [sendingSessions, setSendingSessions] = useState<Record<string, true>>(
    {}
  )
  const [interrupting, setInterrupting] = useState(false)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [agentsStatus, setAgentsStatus] = useState<LoadStatus>("idle")
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [configEntries, setConfigEntries] = useState<ConfigEntry[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsStatus, setModelsStatus] = useState<LoadStatus>("idle")
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [switchingAgent, setSwitchingAgent] = useState(false)
  const [switchingModel, setSwitchingModel] = useState(false)
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [commandsStatus, setCommandsStatus] = useState<LoadStatus>("idle")
  const [commandsError, setCommandsError] = useState<string | null>(null)
  const [commandsDirectory, setCommandsDirectory] = useState<string | null>(null)
  const [commandsReloadKey, setCommandsReloadKey] = useState(0)
  const [pendingPermissions, setPendingPermissions] = useState<
    PermissionRequest[]
  >([])
  const [pendingForms, setPendingForms] = useState<FormInfo[]>([])
  const [permissionBusy, setPermissionBusy] = useState<Record<string, true>>({})
  const [formBusy, setFormBusy] = useState<Record<string, true>>({})
  const [wakeKey, setWakeKey] = useState(0)
  const [draftPruneIds, setDraftPruneIds] = useState<string[]>([])
  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<string, ComposerAttachment[]>
  >({})
  const [inspectorOpen, setInspectorOpen] = useState(readInspectorOpen)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("command")
  const [changesScope, setChangesScopeState] = useState<ChangesScope>("working")
  const [diffFocusPath, setDiffFocusPath] = useState<string | null>(null)
  const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([])
  const [archivedStatus, setArchivedStatus] = useState<LoadStatus>("idle")
  const [archivedError, setArchivedError] = useState<string | null>(null)
  const [inbox, setInbox] = useState<SessionInboxInfo[]>([])
  const [inboxStatus, setInboxStatus] = useState<LoadStatus>("idle")
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [inboxBusy, setInboxBusy] = useState<Record<string, true>>({})
  const [composerRestore, setComposerRestore] = useState<ComposerRestore | null>(null)
  const [focusMessageID, setFocusMessageID] = useState<string | null>(null)
  const archivedRequest = useRef(0)
  const inboxRequest = useRef(0)
  const restoreSequence = useRef(0)
  const inspectorSessionRef = useRef<string | null>(null)
  const inspectorTabRef = useRef<InspectorTab>("command")
  const attachmentSequence = useRef(0)
  const attachmentsRef = useRef<Record<string, ComposerAttachment[]>>({})
  const messagesRef = useRef<SessionMessageInfo[]>([])
  const sessionsRef = useRef<SessionInfo[]>([])
  const inboxRef = useRef<SessionInboxInfo[]>([])
  const inboxBusyRef = useRef<Record<string, true>>({})
  const inboxSessionRef = useRef<string | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    inboxRef.current = inbox
  }, [inbox])

  // Restore unread metadata only after the backend version is known, because
  // the key is scoped to this origin and backend build. Storage failure or
  // corrupt data yields empty state; unread still works in memory.
  useEffect(() => {
    if (!activityStorageKey || !serverVersion) return

    let storage: Storage | null = null
    try {
      storage = window.localStorage
    } catch {
      // Private/denied storage: keep unread for this page session only.
    }

    const stored = readStoredSessionActivity(
      storage,
      window.location.origin,
      serverVersion
    )
    let cancelled = false

    // Yield before writing so this never synchronously cascades inside the
    // effect; the reconcile below waits for the same loaded key.
    void Promise.resolve().then(() => {
      if (cancelled) return

      setSessionActivity(stored)
      setLoadedActivityKey(activityStorageKey)
    })

    return () => {
      cancelled = true
    }
  }, [activityStorageKey, serverVersion])

  // Unread is derived from durable session timestamps, not from transient
  // stream frames, so a reconnect recovers missed activity from the backend
  // and initial load/scope changes baseline without flagging every row. Yield
  // before writing so this never synchronously cascades inside the effect.
  useEffect(() => {
    if (!activityStorageKey || loadedActivityKey !== activityStorageKey) {
      return
    }

    let cancelled = false

    void Promise.resolve().then(() => {
      if (cancelled) return

      setSessionActivity((current) =>
        reconcileSessionActivity(current, sessions, activeSessionID)
      )
    })

    return () => {
      cancelled = true
    }
  }, [activeSessionID, activityStorageKey, loadedActivityKey, sessions])

  // Persist IDs and last-seen timestamps only. Writes are best-effort: denied
  // or full storage must never affect selection or live session state.
  useEffect(() => {
    if (!activityStorageKey || !serverVersion) return
    if (loadedActivityKey !== activityStorageKey) return

    let storage: Storage
    try {
      storage = window.localStorage
    } catch {
      return
    }

    writeStoredSessionActivity(
      storage,
      window.location.origin,
      serverVersion,
      sessionActivity
    )
  }, [activityStorageKey, loadedActivityKey, serverVersion, sessionActivity])

  const locationRef = useRef<LocationPublicInfo | null>(null)
  const directoryRef = useRef("")
  const scopeRef = useRef<ProjectScope>("all")
  const activeSessionRef = useRef<string | null>(null)
  const sessionsRequest = useRef(0)
  const deletedSessionsRef = useRef(new Set<string>())
  const historyRequest = useRef(0)
  const olderCursorRef = useRef<string | null>(null)
  const olderAbortRef = useRef<AbortController | null>(null)
  const loadingOlderRef = useRef(false)
  const streamReadyRef = useRef(false)
  const admissionsRef = useRef<Record<string, true>>({})
  const promptSeqRef = useRef(0)
  const interruptingRef = useRef(false)
  const switchingAgentRef = useRef(false)
  const switchingModelRef = useRef(false)
  const pendingRequest = useRef(0)
  const catalogRequest = useRef(0)
  const catalogDirectoryRef = useRef<string | null>(null)
  const commandRequest = useRef(0)
  const commandsDirectoryRef = useRef<string | null>(null)
  const permissionBusyRef = useRef<Record<string, true>>({})
  const formBusyRef = useRef<Record<string, true>>({})
  const streamStatusRef = useRef<StreamStatus>("idle")
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstReadyRef = useRef(false)
  const activeSessionsRequest = useRef(0)
  const openSessionRequest = useRef(0)
  const selectingFromListRef = useRef(false)

  const setScope = useCallback((next: ProjectScope) => {
    scopeRef.current = next
    setScopeState(next)
  }, [])

  // Live runs live in a session-keyed external store: the stream can write
  // many deltas per second, and only the conversation (plus status-only
  // consumers) should re-render for them — never the app shell.
  const updateLiveRuns = liveRunStore.update

  const setStream = useCallback(
    (next: StreamStatus, error: string | null = null) => {
      streamReadyRef.current = next === "ready"
      streamStatusRef.current = next
      setStreamStatus(next)
      setStreamError(error)
    },
    []
  )

  const markSessionRunning = useCallback(
    (sessionID: string, running: boolean) => {
      setRunningSessionIDs((current) => {
        if (running === Boolean(current[sessionID])) {
          return current
        }

        const next = { ...current }
        if (running) {
          next[sessionID] = true
        } else {
          delete next[sessionID]
        }
        return next
      })
    },
    []
  )

  // The volatile stream is the fast path; `session.active()` is the honest
  // snapshot used on every fresh connection/reconnect. It replaces the whole
  // running set so a session that settled while disconnected cannot leave a
  // stale spinner behind.
  const refreshActiveSessions = useCallback(async () => {
    const request = ++activeSessionsRequest.current

    try {
      const active = await openCode.session.active()

      if (
        request !== activeSessionsRequest.current ||
        streamStatusRef.current !== "ready"
      ) {
        return
      }

      const next: Record<string, true> = {}
      for (const sessionID of Object.keys(active)) {
        next[sessionID] = true
      }
      setRunningSessionIDs(next)
    } catch {
      // Best effort: without the snapshot the sidebar shows no running
      // indicators rather than asserting a stale one.
    }
  }, [])

  // Stream loss makes the in-memory running set unknowable. Clear it instead
  // of showing stale spinners; the next server.connected snapshot repopulates.
  // The write is deferred so the effect never synchronously cascades.
  useEffect(() => {
    if (streamStatus === "ready") return

    activeSessionsRequest.current += 1
    let cancelled = false

    void Promise.resolve().then(() => {
      if (cancelled) return

      setRunningSessionIDs((current) =>
        Object.keys(current).length === 0 ? current : {}
      )
    })

    return () => {
      cancelled = true
    }
  }, [streamStatus])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(
    (immediate: boolean) => {
      clearReconnectTimer()
      const attempt = reconnectAttemptRef.current
      const delayMs = immediate ? 0 : backoffDelay(attempt)
      reconnectAttemptRef.current = attempt + 1
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        setStream("connecting")
        setStreamKey((current) => current + 1)
      }, delayMs)
    },
    [clearReconnectTimer, setStream]
  )

  const selectSession = useCallback((sessionID: string) => {
    // Any newer explicit selection supersedes an in-flight notification
    // lookup, so a slow response cannot steal focus back. Automatic list
    // reconciliation must not invalidate it while a list refresh is settling.
    if (!selectingFromListRef.current) {
      openSessionRequest.current += 1
    }
    if (activeSessionRef.current === sessionID) {
      return
    }

    // A stale older-page request belongs to the previous session.
    olderAbortRef.current?.abort()
    activeSessionRef.current = sessionID
    setActiveSessionID(sessionID)
    setFocusMessageID(null)
    setHistoryStatus("loading")
    setHistoryError(null)
  }, [])

  /**
   * Resolve a session through the native API before selecting it. Notification
   * clicks can arrive after a cold start, for a session outside the loaded
   * page or project, or for one that has moved; the list is only a cache and
   * `session.get` is authoritative. The project/scope selection is not changed.
   */
  const openSessionByID = useCallback(
    async (sessionID: string): Promise<string | null> => {
      const target = sessionID.trim()
      if (!target) return "The notification did not include a session."
      const request = ++openSessionRequest.current

      const lookup = { sessionID: target, changed: false }
      pendingSessionLookup.current = lookup
      let session: SessionInfo
      try {
        session = await openCode.session.get({ sessionID: target })
      } catch (error) {
        return request === openSessionRequest.current
          ? errorMessage(error)
          : null
      } finally {
        if (pendingSessionLookup.current === lookup) pendingSessionLookup.current = null
      }

      // A newer tap/selection won while this lookup was in flight.
      if (request !== openSessionRequest.current) return null
      if (lookup.changed) return "Session changed while opening. Try again."

      setSessions((current) => withSessionSnapshot(current, session))
      selectSession(target)
      return null
    },
    [selectSession]
  )

  const setSessionAttachments = useCallback(
    (
      sessionID: string,
      updater: (current: ComposerAttachment[]) => ComposerAttachment[]
    ) => {
      setAttachmentsBySession((current) => {
        const nextForSession = updater(current[sessionID] ?? [])
        const next = { ...current }
        if (nextForSession.length === 0) {
          delete next[sessionID]
        } else {
          next[sessionID] = nextForSession
        }
        attachmentsRef.current = next
        return next
      })
    },
    []
  )

  const addAttachment = useCallback(
    (
      attachment: ComposerAttachment,
      targetSessionID?: string
    ): string | null => {
      const sessionID = targetSessionID ?? activeSessionRef.current
      if (!sessionID) return "Select a session before attaching files."
      if (targetSessionID && activeSessionRef.current !== targetSessionID) {
        return "The active session changed before the attachment was added."
      }
      const session = sessions.find((candidate) => candidate.id === sessionID)
      if (!session) return "Select a session before attaching files."

      const existing = attachmentsRef.current[sessionID] ?? []
      if (existing.some((item) => item.uri === attachment.uri)) {
        return `${attachment.name} is already attached.`
      }

      const failure = validateComposerAttachment(
        attachment,
        session.model
          ? models.find(
              (model) =>
                model.providerID === session.model?.providerID &&
                model.id === session.model.id
            ) ?? null
          : null,
        existing
      )
      if (failure) return failure

      setSessionAttachments(sessionID, (current) => [...current, attachment])
      return null
    },
    [models, sessions, setSessionAttachments]
  )

  const removeAttachment = useCallback(
    (attachmentID: string, sessionID?: string) => {
      const target = sessionID ?? activeSessionRef.current
      if (!target) return
      setSessionAttachments(target, (current) =>
        current.filter((item) => item.id !== attachmentID)
      )
    },
    [setSessionAttachments]
  )

  const attachProjectFile = useCallback(
    async (relativePath: string): Promise<string | null> => {
      const sessionID = activeSessionRef.current
      if (!sessionID) return "Select a session before attaching files."
      const session = sessions.find((candidate) => candidate.id === sessionID)
      if (!session) return "Select a session before attaching files."
      const directory = session.location?.directory
      if (!directory) return "This session has no project directory."
      const absolute = joinProjectPath(directory, relativePath)
      const uri = fileUri(directory, relativePath)
      if (!absolute || !uri) return "That path is outside the session project."

      let size: number | null
      try {
        size = await probeProjectFileSize(directory, relativePath)
      } catch (error) {
        return errorMessage(error)
      }

      if (activeSessionRef.current !== sessionID) {
        return "The active session changed before the file was attached."
      }

      if (size !== null && size > MAX_ATTACHMENT_BYTES) {
        return `${basename(relativePath)} is ${formatFileSize(size)}; the attachment limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`
      }

      attachmentSequence.current += 1
      return addAttachment({
        id: `project-${attachmentSequence.current}`,
        name: basename(relativePath),
        mime: inferMime(relativePath),
        size,
        uri,
        source: "uri",
        projectPath: relativePath,
      })
    },
    [addAttachment, sessions]
  )

  const setInspectorTabSafe = useCallback((tab: InspectorTab) => {
    const next = normalizeInspectorTab(tab)
    inspectorTabRef.current = next
    setInspectorTab(next)
    const sessionID = activeSessionRef.current
    if (sessionID) writeInspectorTab(sessionID, next)
  }, [])

  const openInspector = useCallback(
    (tab: InspectorTab) => {
      setInspectorTabSafe(tab)
      setInspectorOpen(true)
      persistInspectorOpen(true)
    },
    [setInspectorTabSafe]
  )

  const closeInspector = useCallback(() => {
    setInspectorOpen(false)
    persistInspectorOpen(false)
  }, [])

  const setChangesScope = useCallback((scope: ChangesScope) => {
    setChangesScopeState(normalizeChangesScope(scope))
  }, [])

  const openInspectorDiff = useCallback(
    (path?: string | null) => {
      setChangesScopeState("turn")
      setDiffFocusPath(path ?? null)
      openInspector("changes")
    },
    [openInspector]
  )

  // Restore the per-session selected tab when the selection changes. This is a
  // view preference only; it never substitutes for engine state.
  useEffect(() => {
    const sessionID = activeSessionID
    if (sessionID === inspectorSessionRef.current) return
    inspectorSessionRef.current = sessionID
    void Promise.resolve().then(() => {
      if (inspectorSessionRef.current !== sessionID) return
      const stored = sessionID ? readInspectorTab(sessionID) : "command"
      inspectorTabRef.current = stored
      setInspectorTab(stored)
    })
  }, [activeSessionID])

  const loadSessions = useCallback(
    async (
      { directory: nextDirectory, projectID: nextProjectID }: SessionQuery,
      selectSessionID?: string,
      createdSession?: SessionInfo
    ) => {
      const request = ++sessionsRequest.current
      setSessionsStatus("loading")
      setSessionsError(null)

      try {
        const data: SessionInfo[] = []
        let cursor: string | undefined
        const seenCursors = new Set<string>()
        do {
          const response = await openCode.session.list({
            limit: SESSION_LIMIT,
            order: "desc",
            archived: false,
            ...(cursor ? { cursor } : {}),
            ...(nextProjectID ? { project: nextProjectID } : {}),
            ...(nextDirectory ? { directory: nextDirectory } : {}),
          })
          data.push(...response.data)
          cursor = response.cursor?.next ?? undefined
          if (cursor && seenCursors.has(cursor)) throw new Error("Session pagination did not advance.")
          if (cursor) seenCursors.add(cursor)
        } while (cursor && request === sessionsRequest.current)

        if (request !== sessionsRequest.current) {
          return
        }

        // The list endpoint can lag the create response by a moment; keep the
        // just-created session selectable rather than dropping the selection.
        let rows =
          createdSession &&
          !data.some((session) => session.id === createdSession.id)
            ? [createdSession, ...data]
            : data

        const current = selectSessionID ?? activeSessionRef.current

        // A child selected from the subagent tree may be outside the scoped
        // first page. Resolve that active session directly instead of dropping
        // it when the list refreshes.
        if (current && !rows.some((session) => session.id === current)) {
          try {
            const direct = await openCode.session.get({ sessionID: current })
            rows = [direct, ...rows]
          } catch {
            // It may genuinely have been deleted; fall through to fallback.
          }
        }

        if (request !== sessionsRequest.current) return

        // An explicit notification/deep-link selection can land while this
        // list request is in flight. Keep that selection authoritative instead
        // of replacing it with the first row of this page.
        const selected = selectSessionID ?? activeSessionRef.current
        if (selected && selected !== current) {
          let nextRows = rows
          if (!nextRows.some((session) => session.id === selected)) {
            try {
              const direct = await openCode.session.get({ sessionID: selected })
              nextRows = [direct, ...nextRows]
            } catch {
              // The newer selection may have been deleted; keep the fresh list.
            }
          }
          if (request !== sessionsRequest.current) return
          setSessions((previous) => {
            const latest = previous.find((session) => session.id === activeSessionRef.current)
            return latest && !nextRows.some((session) => session.id === latest.id)
              ? [latest, ...nextRows]
              : nextRows
          })
          setSessionsStatus("ready")
          return
        }

        setSessions((previous) => {
          const latest = previous.find((session) => session.id === activeSessionRef.current)
          return latest && !rows.some((session) => session.id === latest.id)
            ? [latest, ...rows]
            : rows
        })
        setSessionsStatus("ready")

        const next =
          current && rows.some((session) => session.id === current)
            ? current
            : (rows[0]?.id ?? null)

        if (next) {
          selectingFromListRef.current = true
          try {
            selectSession(next)
          } finally {
            selectingFromListRef.current = false
          }
        } else {
          const hadSession = activeSessionRef.current !== null
          activeSessionRef.current = null
          setActiveSessionID(null)
          if (hadSession) {
            setMessages([])
            setHistoryStatus("idle")
          }
        }
      } catch (error) {
        if (request !== sessionsRequest.current) {
          return
        }

        setSessionsStatus("error")
        setSessionsError(errorMessage(error))
      }
    },
    [selectSession]
  )

  const commitLocation = useCallback((next: LocationPublicInfo) => {
    locationRef.current = next
    setLocation(next)
    setDirectory(next.directory)
    directoryRef.current = next.directory
  }, [])

  const loadProjects = useCallback(async (): Promise<Project[] | null> => {
    setProjectsStatus("loading")
    setProjectsError(null)

    try {
      const list = await openCode.project.list()
      setProjects(list)
      setProjectsStatus("ready")
      return list
    } catch (error) {
      setProjectsStatus("error")
      setProjectsError(errorMessage(error))
      return null
    }
  }, [])

  const rememberLastOpened = useCallback(
    (scope: LastOpenedScope, version: string) => {
      setLastOpened(scope)
      if (typeof window === "undefined") return
      try {
        writeStoredLastOpened(
          window.localStorage,
          window.location.origin,
          version,
          scope
        )
      } catch {
        // Last-opened is recovery metadata; storage denial must never block scope changes.
      }
    },
    []
  )

  const dismissStartupNotice = useCallback(() => {
    setStartupNotice(null)
  }, [])

  const loadCatalogs = useCallback(async (targetDirectory?: string) => {
    const directory = targetDirectory ?? directoryRef.current
    const location = directory
      ? { location: { directory } }
      : undefined
    const request = ++catalogRequest.current
    const changedDirectory = catalogDirectoryRef.current !== directory
    catalogDirectoryRef.current = directory

    if (changedDirectory) {
      setAgents([])
      setModels([])
      setConfigEntries([])
    }

    setAgentsStatus((current) => (!changedDirectory && current === "ready" ? current : "loading"))
    setAgentsError(null)
    setModelsStatus((current) => (!changedDirectory && current === "ready" ? current : "loading"))
    setModelsError(null)

    const [agentsResult, modelsResult, configResult] = await Promise.allSettled([
      openCode.agent.list(location),
      openCode.model.list(location),
      openCode.config.get(location),
    ])

    // A location switch can finish older requests later; only the newest
    // catalog/config response may update default-agent resolution.
    if (request !== catalogRequest.current) {
      return
    }

    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value.data)
      setAgentsStatus("ready")
    } else {
      setAgentsStatus("error")
      setAgentsError(errorMessage(agentsResult.reason))
    }

    if (modelsResult.status === "fulfilled") {
      setModels(modelsResult.value.data)
      setModelsStatus("ready")
    } else {
      setModelsStatus("error")
      setModelsError(errorMessage(modelsResult.reason))
    }

    // Config is advisory for default display; failures fall back to the
    // backend's default-first agent order and never block the app.
    setConfigEntries(
      configResult.status === "fulfilled" ? configResult.value : []
    )
  }, [])

  const loadPending = useCallback(async (sessionID: string) => {
    const request = ++pendingRequest.current
    // Yield first so the state writes below are never synchronous within the
    // effect that invokes this (mirrors the other loader callbacks).
    await Promise.resolve()

    if (request !== pendingRequest.current) {
      return
    }

    // Permissions and question forms are separate from the removed Activity
    // queue/tree surface and remain required by the pending-inbox modal.
    setPendingPermissions([])
    setPendingForms([])

    const [permissions, forms] = await Promise.allSettled([
      openCode.permission.list({ sessionID }),
      openCode.session.form.list({ sessionID }),
    ])

    if (request !== pendingRequest.current) {
      return
    }

    setPendingPermissions(
      permissions.status === "fulfilled" ? permissions.value : []
    )
    setPendingForms(forms.status === "fulfilled" ? forms.value : [])
  }, [])

  const loadInboxFor = useCallback(async (sessionID: string) => {
    const request = ++inboxRequest.current
    if (inboxSessionRef.current !== sessionID) {
      inboxSessionRef.current = sessionID
      setInbox([])
      setInboxBusy({})
      inboxBusyRef.current = {}
    }
    setInboxStatus("loading")
    setInboxError(null)
    try {
      const items = await openCode.session.inbox.list({ sessionID })
      if (request !== inboxRequest.current || activeSessionRef.current !== sessionID) {
        return null
      }
      setInbox(items)
      setInboxStatus("ready")
      return null
    } catch (error) {
      if (request !== inboxRequest.current || activeSessionRef.current !== sessionID) {
        return null
      }
      setInboxStatus("error")
      setInboxError(errorMessage(error))
      return errorMessage(error)
    }
  }, [])

  const loadInbox = useCallback(
    async (sessionID?: string) => {
      const target = sessionID ?? activeSessionRef.current
      if (!target) {
        setInbox([])
        setInboxStatus("idle")
        setInboxError(null)
        return "Select a session first."
      }
      return loadInboxFor(target)
    },
    [loadInboxFor]
  )

  const loadCommands = useCallback(async (targetDirectory: string) => {
    const request = ++commandRequest.current
    await Promise.resolve()
    if (request !== commandRequest.current) return

    const changedDirectory = commandsDirectoryRef.current !== targetDirectory
    if (changedDirectory) {
      commandsDirectoryRef.current = targetDirectory
      setCommandsDirectory(targetDirectory)
      setCommands([])
      setCommandsStatus("loading")
    } else {
      setCommandsStatus((current) => (current === "ready" ? current : "loading"))
    }
    setCommandsError(null)

    try {
      const response = await openCode.command.list({
        location: { directory: targetDirectory },
      })
      if (request !== commandRequest.current) return
      setCommands(response.data)
      setCommandsStatus("ready")
    } catch (error) {
      if (request !== commandRequest.current) return
      // Keep a valid same-directory snapshot while showing the failure.
      setCommandsStatus("error")
      setCommandsError(errorMessage(error))
    }
  }, [])

  const reloadCommands = useCallback(() => {
    setCommandsReloadKey((current) => current + 1)
  }, [])

  const openSession = useCallback((session: SessionInfo) => {
    openSessionRequest.current += 1
    if (activeSessionRef.current === session.id) {
      return
    }
    setSessions((current) =>
      current.some((entry) => entry.id === session.id)
        ? current
        : [session, ...current]
    )
    activeSessionRef.current = session.id
    setActiveSessionID(session.id)
    setFocusMessageID(null)
    setHistoryStatus("loading")
    setHistoryError(null)
  }, [])

  const connect = useCallback(
    async (requestedDirectory?: string) => {
      let version: string | null
      try {
        const info = await openCode.server.info()
        version = info.version
        setServerVersion(info.version)
        setConnection("connected")
        setConnectionError(null)
        setStream("connecting")
      } catch (error) {
        setConnection("offline")
        setConnectionError(errorMessage(error))
        setStream("idle")
        setSessionsStatus("idle")
        return
      }

      await loadProjects()

      try {
        const next = requestedDirectory
          ? await openCode.location.get({
              location: { directory: requestedDirectory },
            })
          : await openCode.location.get()

        setDirectoryError(null)
        commitLocation(next)

        setScope("all")
        activeSessionRef.current = null
        setActiveSessionID(null)
        setMessages([])
        setHistoryStatus("idle")
        setHistoryError(null)
        setSessions([])
        setSessionsStatus("loading")
        setSessionsError(null)
        await loadSessions({})
        if (version) rememberLastOpened({ kind: "all" }, version)
        // Reconcile durable state (history/pending/active/sessions) after a
        // manual reconnect; harmless on the initial connect.
        setWakeKey((current) => current + 1)
      } catch (error) {
        setDirectoryError(errorMessage(error))
        setScope("all")
        await loadSessions({})
      }
    },
    [
      commitLocation,
      loadProjects,
      loadSessions,
      rememberLastOpened,
      setScope,
      setStream,
    ]
  )

  useEffect(() => {
    void Promise.resolve().then(() => connect())

    return () => {
      sessionsRequest.current += 1
      historyRequest.current += 1
    }
  }, [connect])

  useEffect(() => {
    if (connection !== "connected") {
      return
    }

    const controller = new AbortController()
    let cancelled = false

    // The engine stream has no application heartbeat. A half-open connection
    // can stay "connected" forever without delivering frames, so force a
    // reconnect and a durable refetch when nothing arrives for a while.
    const watchdog = createStreamWatchdog(() => {
      if (cancelled) return
      setStream("lost", "Event stream stalled.")
      setWakeKey((current) => current + 1)
      scheduleReconnect(true)
      controller.abort()
    })

    void (async () => {
      try {
        watchdog.arm()
        for await (const event of openCode.event.subscribe({
          signal: controller.signal,
        })) {
          if (cancelled) {
            return
          }
          watchdog.arm()

          if (event.type === "server.connected") {
            notifySessionListChange({ sessionID: null })
            setStream("ready")
            reconnectAttemptRef.current = 0
            clearReconnectTimer()
            void refreshActiveSessions()

            // The first readiness frame is the initial connect; every later one
            // is a reconnect. On reconnect, refetch durable state so events
            // that happened while the volatile stream was down are recovered
            // from the backend rather than lost or duplicated.
            if (firstReadyRef.current) {
              setWakeKey((current) => current + 1)
            }

            firstReadyRef.current = true
            continue
          }

          if (
            event.type === "command.updated" ||
            event.type === "config.updated"
          ) {
            setCommandsReloadKey((current) => current + 1)
            continue
          }

          if (event.type === "session.created") {
            notifySessionListChange({ sessionID: event.data.sessionID, parentID: event.data.parentID })
          } else if (
            event.type === "session.renamed" || event.type === "session.agent.selected" ||
            event.type === "session.model.selected" || event.type === "session.moved" ||
            event.type === "session.archived" || event.type === "session.unarchived" ||
            event.type === "session.deleted"
          ) {
            notifySessionListChange({ sessionID: event.data.sessionID })
          }

          // Archive is native, so the active list must follow durable archive
          // events even when another client performed the change.
          if (event.type === "session.archived") {
            const archivedID = event.data.sessionID
            setSessions((current) => current.filter((session) => session.id !== archivedID))
            if (activeSessionRef.current === archivedID) {
              activeSessionRef.current = null
              setActiveSessionID(null)
              setMessages([])
              setHistoryStatus("idle")
              setHistoryError(null)
            }
          } else if (event.type === "session.unarchived") {
            const unarchivedID = event.data.sessionID
            setArchivedSessions((current) =>
              current.filter((session) => session.id !== unarchivedID)
            )
            // Unarchiving from another client must make the session visible in
            // the active navigator without a manual refresh.
            void openCode.session
              .get({ sessionID: unarchivedID })
              .then((session) => {
                setSessions((current) => withSessionSnapshot(current, session))
              })
              .catch(() => {
                // The session may have been removed again.
              })
          }

          // Reconcile the native inbox from durable events; pending order is
          // never reordered locally, only additions/removals/delivery flags.
          if (
            event.type === "session.inbox.enqueued" &&
            event.data.sessionID === activeSessionRef.current
          ) {
            const item = event.data.item
            setInbox((current) =>
              current.some((entry) => entry.id === event.data.inboxID)
                ? current
                : [...current, { ...item, id: event.data.inboxID } as SessionInboxInfo]
            )
            setInboxStatus("ready")
          } else if (
            event.type === "session.inbox.delivered" ||
            event.type === "session.inbox.cancelled"
          ) {
            if (event.data.sessionID === activeSessionRef.current) {
              const inboxID = event.data.inboxID
              setInbox((current) => current.filter((item) => item.id !== inboxID))
              setInboxBusy((current) => {
                const next = { ...current }
                delete next[inboxID]
                return next
              })
            }
          } else if (event.type === "session.inbox.delivery.changed") {
            if (event.data.sessionID === activeSessionRef.current) {
              const { inboxID, delivery } = event.data
              setInbox((current) =>
                current.map((item) =>
                  item.type === "user" && item.id === inboxID
                    ? { ...item, delivery }
                    : item
                )
              )
            }
          }

          const sessionID = eventSessionID(event)

          if (!sessionID) {
            continue
          }

          // Live execution status keeps the sidebar honest between the
          // reconnect snapshots. Terminal frames clear it; `session.active()`
          // remains the authority after any stream gap.
          const reportsRunning =
            event.type === "session.execution.started" ||
            event.type === "session.retry.scheduled" ||
            (event.type === "session.status" &&
              event.data.status.type !== "idle")
          const reportsIdle =
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" ||
            event.type === "session.idle" ||
            (event.type === "session.status" &&
              event.data.status.type === "idle")

          if (reportsRunning) {
            markSessionRunning(sessionID, true)
          } else if (reportsIdle) {
            markSessionRunning(sessionID, false)
          }

          // Terminal outcomes and permission/form requests are activity the
          // user has not seen if another session is selected. Durable timestamp
          // reconciliation recovers the same signal after a reconnect; these
          // frames make it immediate while the stream is live.
          const reportsUnread =
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" ||
            event.type === "permission.asked" ||
            event.type === "form.created"

          if (sessionID !== activeSessionRef.current && reportsUnread) {
            setSessionActivity((current) =>
              markSessionUnread(current, sessionID)
            )
          }

          // Refresh durable activity timestamps rather than inferring them from
          // streamed text, so the sidebar can move active sessions between groups.
          if (
            event.type === "session.created" ||
            event.type === "session.inbox.enqueued" ||
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted"
          ) {
            void openCode.session.get({ sessionID }).then((updated) => {
              setSessions((current) => {
                if (deletedSessionsRef.current.has(updated.id)) return current
                if (updated.parentID && deletedSessionsRef.current.has(updated.parentID)) {
                  return current
                }
                const existing = current.find((session) => session.id === updated.id)
                if (existing && existing.time.updated > updated.time.updated) return current
                return existing
                  ? current.map((session) => session.id === updated.id ? updated : session)
                  : [updated, ...current]
              })
            }).catch(() => {
              // The session may have been deleted before the refresh completed.
            })
          }

          // Durable selection changes must reconcile the session list too, so
          // the active session's agent/model stay authoritative after reload.
          if (event.type === "session.agent.selected") {
            const agent = event.data.agent
            setSessions((current) =>
              current.map((session) =>
                session.id === sessionID ? { ...session, agent } : session
              )
            )
          } else if (event.type === "session.model.selected") {
            const model = event.data.model
            setSessions((current) =>
              current.map((session) =>
                session.id === sessionID ? { ...session, model } : session
              )
            )
          }

          // Pending permissions/forms are keyed to the active session only;
          // another session's items never leak into this surface.
          if (sessionID === activeSessionRef.current) {
            if (event.type === "permission.asked") {
              const request = event.data as PermissionRequest
              setPendingPermissions((current) =>
                current.some((item) => item.id === request.id)
                  ? current
                  : [...current, request]
              )
            } else if (event.type === "permission.replied") {
              const requestID = event.data.requestID
              setPendingPermissions((current) =>
                current.filter((item) => item.id !== requestID)
              )
              setPermissionBusy((current) => {
                const next = { ...current }
                delete next[requestID]
                return next
              })
            } else if (event.type === "form.created") {
              const form = event.data.form as FormInfo
              setPendingForms((current) =>
                current.some((item) => item.id === form.id)
                  ? current
                  : [...current, form]
              )
            } else if (
              event.type === "form.replied" ||
              event.type === "form.cancelled"
            ) {
              const formID = event.data.id
              setPendingForms((current) =>
                current.filter((item) => item.id !== formID)
              )
              setFormBusy((current) => {
                const next = { ...current }
                delete next[formID]
                return next
              })
            }
          }

          updateLiveRuns((current) => {
            const next = applySessionEvent(current[sessionID], event)

            if (!next) {
              return current
            }

            return { ...current, [sessionID]: next }
          })

          const terminal =
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" ||
            event.type === "session.idle"

          if (terminal && activeSessionRef.current === sessionID) {
            setHistoryReloadKey((current) => current + 1)
          }
        }

        if (!cancelled && !controller.signal.aborted) {
          setStream("lost", "Event stream ended.")
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setStream("lost", errorMessage(error))
        }
      }
    })()

    return () => {
      cancelled = true
      watchdog.dispose()
      controller.abort()
    }
  }, [
    clearReconnectTimer,
    connection,
    markSessionRunning,
    scheduleReconnect,
    notifySessionListChange,
    refreshActiveSessions,
    setStream,
    streamKey,
    updateLiveRuns,
  ])

  // Bounded backoff reconnect. A lost stream (the backend's global SSE is
  // volatile and never replays) is retried with exponential backoff + jitter,
  // capped, and immediately on `online`/`visibilitychange`. The manual
  // `retryStream` path bypasses the delay.
  useEffect(() => {
    if (connection !== "connected" || streamStatus !== "lost") {
      return
    }

    scheduleReconnect(false)
    return clearReconnectTimer
  }, [clearReconnectTimer, connection, scheduleReconnect, streamStatus])

  useEffect(() => {
    if (connection !== "connected") {
      return
    }

    const retry = () => {
      if (streamStatusRef.current === "lost") {
        scheduleReconnect(true)
      }
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        return
      }

      // Refetch durable state on tab wake; the volatile stream never replays.
      setWakeKey((current) => current + 1)
      retry()
    }

    const onPageShow = (event: PageTransitionEvent) => {
      // bfcache restore (Safari/WebKit "close the browser then reopen"): the
      // stream died while the page was frozen. Force a fresh subscription and
      // reconcile durable state; never replay a prompt.
      if (!event.persisted) {
        return
      }

      reconnectAttemptRef.current = 0
      setWakeKey((current) => current + 1)
      scheduleReconnect(true)
    }

    window.addEventListener("online", retry)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", onPageShow)

    return () => {
      window.removeEventListener("online", retry)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [connection, scheduleReconnect])

  useEffect(() => {
    if (!activeSessionID) {
      historyRequest.current += 1
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const request = ++historyRequest.current

    void (async () => {
      try {
        const response = await openCode.message.list(
          {
            sessionID: activeSessionID,
            limit: MESSAGE_LIMIT,
            order: "desc",
          },
          { signal: controller.signal }
        )

        if (cancelled || request !== historyRequest.current) {
          return
        }

        // The first page is newest-first; render it oldest-first.
        const nextCursor = response.cursor.next ?? null
        olderCursorRef.current = nextCursor
        setOlderCursor(nextCursor)
        setHasOlder(nextCursor !== null)
        setOlderError(null)
        setMessages(response.data.toReversed())
        setHistoryStatus("ready")
        updateLiveRuns((current) => {
          const run = current[activeSessionID]

          if (!run || !runCoveredByMessages(run, response.data)) {
            return current
          }

          const next = { ...current }
          delete next[activeSessionID]
          return next
        })
      } catch (error) {
        if (cancelled || request !== historyRequest.current) {
          return
        }

        setMessages([])
        setHistoryStatus("error")
        setHistoryError(errorMessage(error))
      }
    })()

    return () => {
      cancelled = true
      // The session changed (or history is being refetched): cancel the stale
      // page instead of downloading and parsing it only to discard the result.
      controller.abort()
      olderAbortRef.current?.abort()
    }
  }, [activeSessionID, historyReloadKey, updateLiveRuns, wakeKey])

  // Native active-execution loading: if the selected session is already running
  // when this page opens (e.g. after a reload), surface an honest running state
  // so Stop is available. No content is replayed; the durable history plus a
  // running status is all that is shown until live frames arrive.
  useEffect(() => {
    if (!activeSessionID || connection !== "connected") {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const active = await openCode.session.active()

        if (cancelled || activeSessionRef.current !== activeSessionID) {
          return
        }

        if (!active[activeSessionID]) {
          // The backend reports the session is no longer running: any live
          // "running" overlay is stale (the execution settled while the stream
          // was down). Drop it so the refetched durable history renders the
          // real outcome instead of a stuck Stop.
          updateLiveRuns((current) => {
            const run = current[activeSessionID]

            if (
              !run ||
              (run.status !== "running" && run.status !== "submitting")
            ) {
              return current
            }

            const next = { ...current }
            delete next[activeSessionID]
            return next
          })
          return
        }

        updateLiveRuns((current) => {
          const run = current[activeSessionID]

          if (!run) {
            return {
              ...current,
              [activeSessionID]: {
                ...emptyLiveRun("running"),
                notices: ["This session is already running."],
              },
            }
          }

          const terminal =
            run.status === "completed" ||
            run.status === "failed" ||
            run.status === "interrupted"

          // A terminal frame that arrived after this active() snapshot is
          // newer and authoritative; never resurrect a stale Responding/Stop.
          if (terminal || run.status === "running") {
            return current
          }

          // submitting or notice -> the backend reports the session running.
          return {
            ...current,
            [activeSessionID]: { ...run, status: "running" },
          }
        })
      } catch {
        // Best effort: active() is optional and never blocks selection.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeSessionID, connection, updateLiveRuns, wakeKey])

  // Pending permissions/forms are durable: refetch them from GET on selection
  // instead of relying only on the volatile SSE stream, so a session that had
  // pending items before this page opened still surfaces them.
  useEffect(() => {
    if (!activeSessionID) {
      pendingRequest.current += 1
      void Promise.resolve().then(() => {
        setPendingPermissions([])
        setPendingForms([])
      })
      return
    }

    void Promise.resolve().then(() => loadPending(activeSessionID))
  }, [activeSessionID, loadPending, wakeKey])

  // The native inbox is the queue of the current session. It is refetched on
  // selection and wake, then reconciled from inbox events.
  useEffect(() => {
    if (!activeSessionID) {
      inboxRequest.current += 1
      inboxSessionRef.current = null
      void Promise.resolve().then(() => {
        setInbox([])
        setInboxStatus("idle")
        setInboxError(null)
      })
      return
    }

    void Promise.resolve().then(() => loadInboxFor(activeSessionID))
  }, [activeSessionID, loadInboxFor, wakeKey])

  // Native project/plugin command catalog follows the selected session
  // directory. Connection, wake, config and command.updated events refetch it.
  const commandDirectory =
    (sessions.find((session) => session.id === activeSessionID)?.location
      ?.directory ??
      directory) ||
    null

  useEffect(() => {
    if (!commandDirectory || connection !== "connected") return
    void Promise.resolve().then(() => loadCatalogs(commandDirectory))
  }, [commandDirectory, connection, loadCatalogs])

  useEffect(() => {
    if (!commandDirectory || connection !== "connected") {
      commandRequest.current += 1
      commandsDirectoryRef.current = null
      void Promise.resolve().then(() => {
        setCommands([])
        setCommandsDirectory(null)
        setCommandsStatus("idle")
        setCommandsError(null)
      })
      return
    }

    void Promise.resolve().then(() => loadCommands(commandDirectory))
  }, [commandDirectory, commandsReloadKey, connection, loadCommands])

  const retryConnection = useCallback(() => {
    setConnection("connecting")
    setConnectionError(null)
    void connect(directoryRef.current || undefined)
  }, [connect])

  const retryProjects = useCallback(() => {
    void loadProjects()
  }, [loadProjects])

  const refreshSessions = useCallback(() => {
    if (scopeRef.current === "all") {
      void loadSessions({})
      return
    }

    const currentProjectID = locationRef.current?.project.id ?? null

    if (!currentProjectID) {
      void connect()
      return
    }

    void loadSessions({
      directory: directoryRef.current || null,
      projectID: currentProjectID,
    })
  }, [connect, loadSessions])

  // On reconnect, refresh the authoritative session list so the active
  // session's model/agent/metadata stay current after the volatile stream gap.
  useEffect(() => {
    if (wakeKey === 0 || connection !== "connected") {
      return
    }

    void refreshSessions()
  }, [connection, refreshSessions, wakeKey])

  const selectAllProjects = useCallback(() => {
    if (scopeRef.current === "all") {
      return
    }

    // A pending notification lookup must not re-select a session after the
    // user intentionally changes project scope.
    openSessionRequest.current += 1
    setStartupNotice(null)
    setScope("all")
    setProjectError(null)
    setDirectoryError(null)
    setCreateError(null)

    // Cross-project browsing cannot keep a project-scoped selection.
    activeSessionRef.current = null
    setActiveSessionID(null)
    setMessages([])
    setHistoryStatus("idle")
    setHistoryError(null)
    setSessions([])
    setSessionsStatus("loading")
    setSessionsError(null)

    void loadSessions({})
    if (serverVersion) rememberLastOpened({ kind: "all" }, serverVersion)
  }, [loadSessions, rememberLastOpened, serverVersion, setScope])

  const selectProject = useCallback(
    async (projectID: string) => {
      if (
        projectID === locationRef.current?.project.id &&
        scopeRef.current === "project"
      ) {
        return
      }

      const project = projects.find((candidate) => candidate.id === projectID)

      if (!project) {
        return
      }

      // A pending notification lookup must not re-select a session after the
      // user intentionally changes project scope.
      openSessionRequest.current += 1
      setScope("project")
      setProjectBusy(true)
      setProjectError(null)
      setDirectoryError(null)
      setCreateError(null)
      setStartupNotice(null)

      // The previous project's selection/history must not survive the switch.
      activeSessionRef.current = null
      setActiveSessionID(null)
      setMessages([])
      setHistoryStatus("idle")
      setSessions([])
      setSessionsStatus("loading")
      setSessionsError(null)

      try {
        const resolvedPromise = openCode.location.get({
          location: { directory: project.canonical },
        })
        prefetchTargetCatalog(project.canonical)
        const resolved = await resolvedPromise
        commitLocation(resolved)
        await Promise.all([
          loadSessions({
            directory: resolved.directory,
            projectID: resolved.project.id,
          }),
          loadCatalogs(resolved.directory),
        ])
        if (serverVersion) {
          rememberLastOpened(
            {
              kind: "project",
              projectID: resolved.project.id,
              directory: resolved.directory,
            },
            serverVersion
          )
        }
      } catch {
        // The project's canonical directory is gone: keep the project selectable
        // and list its sessions project-wide, but no directory can create sessions.
        const fallback: LocationPublicInfo = {
          directory: project.canonical,
          project: {
            id: project.id,
            directory: project.canonical,
            canonical: project.canonical,
          },
        }
        locationRef.current = fallback
        setLocation(fallback)
        setDirectory("")
        directoryRef.current = ""
        setProjectError(
          "Project folder is unavailable. Sessions are read-only."
        )
        await loadSessions({ projectID: project.id })
        void loadCatalogs(undefined)
      } finally {
        setProjectBusy(false)
      }
    },
    [
      commitLocation,
      loadCatalogs,
      loadSessions,
      projects,
      rememberLastOpened,
      serverVersion,
      setScope,
    ]
  )

  const checkProjectDirectory = useCallback(
    async (projectID: string): Promise<string | null> => {
      if (projectID === locationRef.current?.project.id && directoryRef.current) {
        return directoryRef.current
      }

      const project = projects.find((candidate) => candidate.id === projectID)

      if (!project) {
        return null
      }

      try {
        const resolved = await openCode.location.get({
          location: { directory: project.canonical },
        })

        return resolved.directory || null
      } catch {
        return null
      }
    },
    [projects]
  )

  const createSession = useCallback(
    async (
      projectID: string,
      selection?: NewSessionSelection,
      directory?: string
    ) => {
      setCreating(true)
      setCreateError(null)

      try {
        const resolved = directory
          ? await openCode.location.get({
              location: { directory },
            })
          : await openCode.location.get()
        const targetDirectory = resolved.directory

        if (resolved.project.id !== projectID) {
          setCreateError("The selected folder's project changed. Select the folder again.")
          return false
        }

        if (!targetDirectory) {
          setCreateError("The selected session folder is unavailable.")
          return false
        }

        // The New session dialog always resolves and supplies the model. Never
        // substitute a different model here: saved defaults that are missing
        // from the target catalog must block creation instead of silently
        // falling back to the free model.
        const selectedModel = selection?.model ?? null

        if (!selectedModel) {
          setCreateError("Choose an available model for the new session.")
          return false
        }

        const created = await openCode.session.create({
          location: { directory: targetDirectory },
          ...(selection?.agentID ? { agent: selection.agentID } : {}),
          model: selectedModel,
        })

        // Switch the active project only after the POST succeeds, so a failed
        // create never leaves a half-switched sidebar. Cross-project browsing
        // stays global and simply selects the new session in the global list.
        setScope("all")
        commitLocation(resolved)
        // The new session's directory can carry a different default_agent and
        // catalog; resolve them for its location before the composer is used.
        void loadCatalogs(targetDirectory)

        openSessionRequest.current += 1
        activeSessionRef.current = created.id
        setActiveSessionID(created.id)
        setMessages([])
        setHistoryStatus("loading")
        await loadSessions(
          {},
          created.id,
          created
        )
        return true
      } catch (error) {
        setCreateError(errorMessage(error))
        return false
      } finally {
        setCreating(false)
      }
    },
    [
      commitLocation,
      loadCatalogs,
      loadSessions,
      setScope,
    ]
  )

  const renameSession = useCallback(
    async (sessionID: string, rawTitle: string) => {
      const title = normalizeSessionTitle(rawTitle)

      if (!title) {
        return "Session name cannot be empty."
      }

      try {
        await openCode.session.update({ sessionID, title })
        setSessions((current) => applySessionTitle(current, sessionID, title))
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    []
  )

  const loadArchivedSessions = useCallback(async () => {
    const request = ++archivedRequest.current
    setArchivedStatus("loading")
    setArchivedError(null)
    try {
      const projectID =
        scopeRef.current === "project" ? locationRef.current?.project.id : undefined
      const directory =
        scopeRef.current === "project" ? directoryRef.current || undefined : undefined
      const data: SessionInfo[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const response = await openCode.session.list({
          limit: SESSION_LIMIT,
          order: "desc",
          archived: true,
          ...(cursor ? { cursor } : {}),
          ...(projectID ? { project: projectID } : {}),
          ...(directory ? { directory } : {}),
        })
        data.push(...response.data)
        cursor = response.cursor?.next ?? undefined
        if (cursor && seen.has(cursor)) throw new Error("Archive pagination did not advance.")
        if (cursor) seen.add(cursor)
      } while (cursor && request === archivedRequest.current)

      if (request !== archivedRequest.current) return null
      setArchivedSessions(data)
      setArchivedStatus("ready")
      return null
    } catch (error) {
      if (request !== archivedRequest.current) return null
      setArchivedStatus("error")
      setArchivedError(errorMessage(error))
      return errorMessage(error)
    }
  }, [])

  const setSessionArchived = useCallback(
    async (sessionID: string, archived: boolean) => {
      try {
        await openCode.session.update({ sessionID, archived })
        setSessions((current) => current.filter((session) => session.id !== sessionID))
        setArchivedSessions((current) =>
          current.filter((session) => session.id !== sessionID)
        )
        if (!archived) {
          refreshSessions()
          return null
        }
        if (activeSessionRef.current === sessionID) {
          activeSessionRef.current = null
          setActiveSessionID(null)
          setMessages([])
          setHistoryStatus("idle")
          setHistoryError(null)
        }
        refreshSessions()
        void loadArchivedSessions()
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    [loadArchivedSessions, refreshSessions]
  )

  const unarchiveSession = useCallback(
    (sessionID: string) => setSessionArchived(sessionID, false),
    [setSessionArchived]
  )

  const cancelInboxItem = useCallback(async (inboxID: string) => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."
    if (inboxBusyRef.current[inboxID]) {
      return "That queued message is already being delivered."
    }
    inboxBusyRef.current[inboxID] = true
    setInboxBusy((current) => ({ ...current, [inboxID]: true }))
    try {
      await openCode.session.inbox.cancel({ sessionID, inboxID })
      setInbox((current) => current.filter((item) => item.id !== inboxID))
      return null
    } catch (error) {
      const tag = errorTag(error)
      if (tag === "InboxNotFoundError" || tag === "NotFoundError") {
        setInbox((current) => current.filter((item) => item.id !== inboxID))
        return "That queued message is no longer waiting; it may already be delivered."
      }
      return errorMessage(error)
    } finally {
      delete inboxBusyRef.current[inboxID]
      setInboxBusy((current) => {
        const next = { ...current }
        delete next[inboxID]
        return next
      })
    }
  }, [])

  const steerInboxItem = useCallback(async (inboxID: string) => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."
    if (inboxBusyRef.current[inboxID]) {
      return "That queued message is already being delivered."
    }
    inboxBusyRef.current[inboxID] = true
    setInboxBusy((current) => ({ ...current, [inboxID]: true }))
    try {
      await openCode.session.inbox.update({ sessionID, inboxID, delivery: "steer" })
      setInbox((current) =>
        current.map((item) =>
          item.id === inboxID && item.type === "user"
            ? { ...item, delivery: "steer" }
            : item
        )
      )
      return null
    } catch (error) {
      return errorMessage(error)
    } finally {
      delete inboxBusyRef.current[inboxID]
      setInboxBusy((current) => {
        const next = { ...current }
        delete next[inboxID]
        return next
      })
    }
  }, [])

  const takeBackInboxItem = useCallback(async (inboxID: string) => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."
    const item = inboxRef.current.find((entry) => entry.id === inboxID)
    if (!item) return "That queued message is no longer waiting."
    if (item.type !== "user") {
      return "Only user prompts can be taken back into the composer."
    }
    const failure = await cancelInboxItem(inboxID)
    if (failure) return failure
    const files: RestoredPromptFile[] = (item.payload.files ?? []).flatMap((file) => {
      const name = file.name ?? "attachment"
      if (file.source.type === "uri") {
        return [{ uri: file.source.uri, name, mime: file.mime }]
      }
      return file.data
        ? [{ uri: `data:${file.mime};base64,${file.data}`, name, mime: file.mime }]
        : []
    })
    restoreSequence.current += 1
    setComposerRestore({
      sessionID,
      text: item.payload.text,
      files,
      nonce: restoreSequence.current,
    })
    return null
  }, [cancelInboxItem])

  const clearComposerRestore = useCallback(() => setComposerRestore(null), [])

  const loadTurnDiff = useCallback(
    async (sessionID: string, from?: string, to?: string): Promise<SessionDiffResult> => {
      try {
        const files = await openCode.session.diff({
          sessionID,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        })
        return { ok: true, files }
      } catch (error) {
        return { ok: false, reason: errorMessage(error) }
      }
    },
    []
  )

  const loadSessionContext = useCallback(
    async (sessionID: string): Promise<SessionContextSnapshot | null> => {
      try {
        const messages = await openCode.session.context({ sessionID })
        const session =
          sessionsRef.current.find((entry) => entry.id === sessionID) ??
          (await openCode.session.get({ sessionID }))
        return { messages, tokens: session.tokens ?? null }
      } catch {
        return null
      }
    },
    []
  )

  const loadSessionStats = useCallback(
    async (sessionID: string): Promise<SessionStatsInfo | null> => {
      try {
        return await openCode.session.stats({})
      } catch {
        // Session stats are aggregate; the session detail still renders.
        void sessionID
        return null
      }
    },
    []
  )

  const searchSessions = useCallback(
    async (query: string, archived = false): Promise<SessionSearchResult> => {
      const text = query.trim()
      if (!text) return { ok: true, sessions: [] }
      try {
        const projectID =
          scopeRef.current === "project" ? locationRef.current?.project.id : undefined
        const directory =
          scopeRef.current === "project" ? directoryRef.current || undefined : undefined
        const response = await openCode.session.list({
          search: text,
          archived,
          limit: SESSION_LIMIT,
          order: "desc",
          ...(projectID ? { project: projectID } : {}),
          ...(directory ? { directory } : {}),
        })
        return { ok: true, sessions: response.data }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
    []
  )

  const forkSession = useCallback(
    async (before?: string) => {
      const sessionID = activeSessionRef.current
      if (!sessionID) return "Select a session first."

      try {
        const forked = await openCode.session.fork({
          sessionID,
          ...(before ? { before } : {}),
        })
        setSessions((current) => [
          forked,
          ...current.filter((session) => session.id !== forked.id),
        ])
        openSession(forked)
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    [openSession]
  )

  const compactSession = useCallback(async () => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."
    try {
      const compaction: SessionInboxCompaction = await openCode.session.compact({
        sessionID,
      })
      return compaction.delivery === "queue"
        ? "Compaction queued at the next prompt boundary."
        : "Compaction queued at the next step boundary."
    } catch (error) {
      return errorMessage(error)
    }
  }, [])

  const stageRevert = useCallback(async (messageID: string) => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."
    try {
      const revert: SessionRevert = await openCode.session.revert.stage({
        sessionID,
        messageID,
      })
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionID ? { ...session, revert } : session
        )
      )
      setHistoryReloadKey((current) => current + 1)
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }, [])

  const clearRevert = useCallback(async () => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."
    try {
      await openCode.session.revert.clear({ sessionID })
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== sessionID) return session
          const next = { ...session }
          delete next.revert
          return next
        })
      )
      setHistoryReloadKey((current) => current + 1)
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }, [])

  const moveSession = useCallback(
    async (targetDirectory: string) => {
      const sessionID = activeSessionRef.current
      if (!sessionID) return "Select a session first."
      const requested = targetDirectory.trim()
      if (!isAbsoluteDirectory(requested)) {
        return "Enter an absolute existing directory path."
      }

      try {
        const resolved = await openCode.location.get({
          location: { directory: requested },
        })
        if (resolved.directory === sessions.find((session) => session.id === sessionID)?.location.directory) {
          return "The session is already in that directory."
        }
        await openCode.session.move({
          sessionID,
          directory: resolved.directory,
        })
        const updated = await openCode.session.get({ sessionID })
        commitLocation(resolved)
        await loadSessions(
          {},
          sessionID,
          updated
        )
        void loadCatalogs(resolved.directory)
        if (serverVersion) {
          rememberLastOpened(
            {
              kind: "project",
              projectID: resolved.project.id,
              directory: resolved.directory,
            },
            serverVersion
          )
        }
        return null
      } catch (error) {
        return errorMessage(error)
      }
    },
    [
      commitLocation,
      loadCatalogs,
      loadSessions,
      rememberLastOpened,
      serverVersion,
      sessions,
    ]
  )

  const deleteSession = useCallback(
    async (sessionID: string) => {
      try {
        await openCode.session.remove({ sessionID })
      } catch (error) {
        return errorMessage(error)
      }

      // The API deletes child sessions with their parent.
      const removed = descendantSessionIDs(sessions, sessionID)
      for (const id of removed) deletedSessionsRef.current.add(id)
      sessionsRequest.current += 1

      // Clear the deleted sessions' persisted drafts so no stale draft survives.
      for (const id of removed) {
        removeDraft(id)
      }

      setAttachmentsBySession((current) => {
        let changed = false
        const next: Record<string, ComposerAttachment[]> = {}
        for (const [id, attachments] of Object.entries(current)) {
          if (removed.has(id)) {
            changed = true
          } else {
            next[id] = attachments
          }
        }
        if (changed) attachmentsRef.current = next
        return changed ? next : current
      })

      const rows = sessions.filter((session) => !removed.has(session.id))
      const next = fallbackSessionAfterRemoval(
        sessions,
        removed,
        activeSessionRef.current
      )
      const activeRemoved =
        activeSessionRef.current !== null &&
        removed.has(activeSessionRef.current)

      setSessions(rows)
      setSessionsStatus((current) => current === "loading" ? "ready" : current)

      // Tell the composer to drop these sessions' in-memory drafts too, so a
      // later full-map write cannot resurrect a deleted session's draft.
      setDraftPruneIds((current) => [...current, ...removed])
      setSessionActivity((current) =>
        forgetSessionActivity(current, removed)
      )
      setRunningSessionIDs((current) => {
        let changed = false
        const next = { ...current }
        for (const sessionID of removed) {
          if (next[sessionID]) {
            delete next[sessionID]
            changed = true
          }
        }
        return changed ? next : current
      })

      if (activeRemoved) {
        setMessages([])
        setHistoryError(null)

        if (next) {
          setHistoryStatus("loading")
          selectSession(next.id)
        } else {
          activeSessionRef.current = null
          setActiveSessionID(null)
          setHistoryStatus("idle")
        }
      }

      return null
    },
    [selectSession, sessions]
  )

  const sendPrompt = useCallback(
    async (
      text: string,
      delivery?: "steer" | "queue" | null,
      skills: readonly PromptSkillAttachment[] = []
    ) => {
      const sessionID = activeSessionRef.current

      if (!sessionID) {
        return "Select a session first."
      }

      const trimmed = text.trim()
      const submittedAttachments = attachmentsRef.current[sessionID] ?? []
      const submittedAttachmentIDs = new Set(
        submittedAttachments.map((attachment) => attachment.id)
      )

      if (!trimmed && submittedAttachments.length === 0) {
        return "Write a message or attach a file first."
      }

      if (admissionsRef.current[sessionID]) {
        return "An admission is already pending for this session."
      }

      const session = sessions.find((candidate) => candidate.id === sessionID)

      if (!session) {
        return "Select a session first."
      }

      // With real selection, any model the session actually uses is admissible;
      // only a session with no model at all is blocked.
      if (!session.model) {
        return "This session has no model selected."
      }

      const existing = liveRunStore.getRun(sessionID)
      // Only an actively running turn accepts an explicit delivery. Terminal or
      // absent runs are ordinary admissions with no delivery field; this keeps
      // first/idle prompts ordinary regardless of the trailing transport mode.
      const running = existing?.status === "running"
      const requestedDelivery = promptDelivery(running, delivery)
      const steer = requestedDelivery === "steer"
      const key = `local-${(promptSeqRef.current += 1)}`
      const pendingUser = {
        key,
        seq: running ? (existing as LiveRun).nextSeq : 0,
        id: null,
        text,
        delivery: requestedDelivery,
        requestedSteer: steer,
        requestedDelivery,
        files: submittedAttachments.map(liveAttachmentFor),
        status: "sending" as const,
      }

      admissionsRef.current[sessionID] = true
      setSendingSessions((current) => ({ ...current, [sessionID]: true }))

      updateLiveRuns((current) => {
        const run = current[sessionID]

        if (running && run) {
          return {
            ...current,
            [sessionID]: {
              ...run,
              pendingUsers: [...run.pendingUsers, pendingUser],
              nextSeq: run.nextSeq + 1,
            },
          }
        }

        return {
          ...current,
          [sessionID]: {
            ...emptyLiveRun("submitting"),
            pendingUsers: [pendingUser],
            nextSeq: 1,
          },
        }
      })

      if (!streamReadyRef.current) {
        updateLiveRuns((current) => {
          const run = current[sessionID]
          if (!run) return current
          const notice = "Event stream is connecting; the reply appears once connected."
          if (run.notices.includes(notice)) return current
          return {
            ...current,
            [sessionID]: { ...run, notices: [...run.notices, notice] },
          }
        })
      }

      recordPerfMark("prompt:admission-start", { sessionID })
      try {
        const inbox = await openCode.session.prompt({
          sessionID,
          text,
          ...(submittedAttachments.length > 0
            ? {
                files: submittedAttachments.map(promptFileForAttachment),
              }
            : {}),
          ...(skills.length > 0
            ? { skills: skills.map((skill) => ({ id: skill.id })) }
            : {}),
          ...(requestedDelivery ? { delivery: requestedDelivery } : {}),
        })

        recordPerfMark("prompt:admitted", { sessionID, inboxID: inbox.id })

        // Clear only the exact attachment ids admitted here. A newer selection
        // made while this request was in flight is never discarded.
        setSessionAttachments(sessionID, (current) =>
          current.filter((attachment) => !submittedAttachmentIDs.has(attachment.id))
        )

        updateLiveRuns((current) => {
          const run = current[sessionID] ?? emptyLiveRun("running")
          const delivery = inbox.delivery ?? requestedDelivery
          const mismatch =
            requestedDelivery !== null && delivery !== requestedDelivery
          const mismatchNotice = mismatch
            ? `${requestedDelivery === "steer" ? "Steer" : "Queue"} requested, but the backend reported ${delivery ?? "no delivery"}.`
            : null

          return {
            ...current,
            [sessionID]: {
              ...run,
              pendingUsers: run.pendingUsers.map((user) =>
                user.key === key
                  ? {
                      ...user,
                      id: inbox.id,
                      delivery,
                      status: "sent" as const,
                    }
                  : user
              ),
              status: running ? run.status : "running",
              notices: mismatchNotice
                ? [...run.notices.filter((notice) => !notice.startsWith("Steer requested") && !notice.startsWith("Queue requested")), mismatchNotice]
                : run.notices,
            },
          }
        })
        return null
      } catch (error) {
        updateLiveRuns((current) => {
          const run = current[sessionID]

          if (!run) {
            return current
          }

          const pendingUsers = run.pendingUsers.filter(
            (user) => user.key !== key
          )

          if (
            !running &&
            pendingUsers.length === 0 &&
            run.order.length === 0
          ) {
            const next = { ...current }
            delete next[sessionID]
            return next
          }

          return {
            ...current,
            [sessionID]: { ...run, pendingUsers },
          }
        })
        return errorMessage(error)
      } finally {
        delete admissionsRef.current[sessionID]
        setSendingSessions((current) => {
          const next = { ...current }
          delete next[sessionID]
          return next
        })
      }
    },
    [sessions, setSessionAttachments, updateLiveRuns]
  )

  const executeCommand = useCallback(
    async (
      name: string,
      text: string,
      submittedAttachments: readonly ComposerAttachment[]
    ): Promise<string | null> => {
      const sessionID = activeSessionRef.current
      if (!sessionID) return "Select a session first."
      if (admissionsRef.current[sessionID]) {
        return "An admission is already pending for this session."
      }
      if (!streamReadyRef.current) {
        return "Waiting for the event stream. Commands are paused."
      }
      const session = sessions.find((candidate) => candidate.id === sessionID)
      if (!session) return "Select a session first."
      if (!session.model) return "This session has no model selected."

      const running = liveRunStore.getRun(sessionID)?.status === "running"
      admissionsRef.current[sessionID] = true
      setSendingSessions((current) => ({ ...current, [sessionID]: true }))

      try {
        await openCode.session.command({
          sessionID,
          name,
          text,
          ...(submittedAttachments.length > 0
            ? {
                files: submittedAttachments.map(promptFileForAttachment),
              }
            : {}),
          ...(running ? { delivery: "steer" as const } : {}),
        })
        const submittedIDs = new Set(submittedAttachments.map((attachment) => attachment.id))
        setSessionAttachments(sessionID, (current) =>
          current.filter((attachment) => !submittedIDs.has(attachment.id))
        )
        return null
      } catch (error) {
        return errorMessage(error)
      } finally {
        delete admissionsRef.current[sessionID]
        setSendingSessions((current) => {
          const next = { ...current }
          delete next[sessionID]
          return next
        })
      }
    },
    [sessions, setSessionAttachments]
  )

  const interruptSession = useCallback(async () => {
    const sessionID = activeSessionRef.current

    if (!sessionID) {
      return "Select a session first."
    }

    if (interruptingRef.current) {
      return null
    }

    interruptingRef.current = true
    setInterrupting(true)

    try {
      // `resume: false` stops the active execution and keeps queued prompts
      // parked. The engine returns interrupted=false for the idle no-op; an
      // interrupted=true result is reconciled from the live
      // `session.execution.interrupted` frame, never optimistically marked idle.
      const result = await openCode.session.interrupt({
        sessionID,
        resume: false,
      })

      if (!result.interrupted) {
        // Harmless race: the execution already settled before this Stop. The
        // backend reports the idle no-op; reconcile the authoritative active
        // snapshot plus durable history/pending so a stale "Responding…"/Stop
        // is removed, without surfacing a red fatal error.
        setWakeKey((current) => current + 1)
        return null
      }

      return null
    } catch (error) {
      return errorMessage(error)
    } finally {
      interruptingRef.current = false
      setInterrupting(false)
    }
  }, [])

  const switchAgent = useCallback(async (agentID: string) => {
    const sessionID = activeSessionRef.current

    if (!sessionID) {
      return "Select a session first."
    }

    if (switchingAgentRef.current) {
      return null
    }

    switchingAgentRef.current = true
    setSwitchingAgent(true)

    try {
      await openCode.session.switchAgent({ sessionID, agent: agentID })
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionID ? { ...session, agent: agentID } : session
        )
      )
      return null
    } catch (error) {
      return errorMessage(error)
    } finally {
      switchingAgentRef.current = false
      setSwitchingAgent(false)
    }
  }, [])

  const switchModel = useCallback(async (model: ModelRef) => {
    const sessionID = activeSessionRef.current

    if (!sessionID) {
      return "Select a session first."
    }

    if (switchingModelRef.current) {
      return null
    }

    switchingModelRef.current = true
    setSwitchingModel(true)

    try {
      await openCode.session.switchModel({ sessionID, model })
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionID ? { ...session, model } : session
        )
      )
      return null
    } catch (error) {
      return errorMessage(error)
    } finally {
      switchingModelRef.current = false
      setSwitchingModel(false)
    }
  }, [])

  const switchAgentWithDefaults = useCallback(
    async (agentID: string): Promise<string | null> => {
      const failure = await switchAgent(agentID)
      if (failure) return failure
      const agent = agents.find((candidate) => candidate.id === agentID) ?? null
      const model = agentModelDefaults(agent, models)
      if (!model) return null
      return switchModel(model)
    },
    [agents, models, switchAgent, switchModel]
  )

  const replyPermission = useCallback(
    async (requestID: string, decision: PermissionReply) => {
      const sessionID = activeSessionRef.current

      if (!sessionID) {
        return "Select a session first."
      }

      if (permissionBusyRef.current[requestID]) {
        return null
      }

      permissionBusyRef.current[requestID] = true
      setPermissionBusy((current) => ({ ...current, [requestID]: true }))

      try {
        await openCode.permission.reply({ sessionID, requestID, decision })
        setPendingPermissions((current) =>
          current.filter((request) => request.id !== requestID)
        )
        return null
      } catch (error) {
        // Already resolved by another client (or removed): settle honestly.
        if (errorTag(error) === "PermissionNotFoundError") {
          setPendingPermissions((current) =>
            current.filter((request) => request.id !== requestID)
          )
          return null
        }

        return errorMessage(error)
      } finally {
        delete permissionBusyRef.current[requestID]
        setPermissionBusy((current) => {
          const next = { ...current }
          delete next[requestID]
          return next
        })
      }
    },
    []
  )

  const replyForm = useCallback(
    async (formID: string, answer: FormAnswer) => {
      const sessionID = activeSessionRef.current

      if (!sessionID) {
        return "Select a session first."
      }

      if (formBusyRef.current[formID]) {
        return null
      }

      formBusyRef.current[formID] = true
      setFormBusy((current) => ({ ...current, [formID]: true }))

      try {
        await openCode.session.form.reply({ sessionID, formID, answer })
        setPendingForms((current) =>
          current.filter((form) => form.id !== formID)
        )
        return null
      } catch (error) {
        const tag = errorTag(error)

        if (tag === "FormAlreadySettledError" || tag === "FormNotFoundError") {
          setPendingForms((current) =>
            current.filter((form) => form.id !== formID)
          )
          return null
        }

        return errorMessage(error)
      } finally {
        delete formBusyRef.current[formID]
        setFormBusy((current) => {
          const next = { ...current }
          delete next[formID]
          return next
        })
      }
    },
    []
  )

  const cancelForm = useCallback(async (formID: string) => {
    const sessionID = activeSessionRef.current

    if (!sessionID) {
      return "Select a session first."
    }

    if (formBusyRef.current[formID]) {
      return null
    }

    formBusyRef.current[formID] = true
    setFormBusy((current) => ({ ...current, [formID]: true }))

    try {
      await openCode.session.form.cancel({ sessionID, formID })
      setPendingForms((current) => current.filter((form) => form.id !== formID))
      return null
    } catch (error) {
      const tag = errorTag(error)

      if (tag === "FormAlreadySettledError" || tag === "FormNotFoundError") {
        setPendingForms((current) =>
          current.filter((form) => form.id !== formID)
        )
        return null
      }

      return errorMessage(error)
    } finally {
      delete formBusyRef.current[formID]
      setFormBusy((current) => {
        const next = { ...current }
        delete next[formID]
        return next
      })
    }
  }, [])

  const retryStream = useCallback(() => {
    reconnectAttemptRef.current = 0
    clearReconnectTimer()
    setStream("connecting")
    setStreamKey((current) => current + 1)
  }, [clearReconnectTimer, setStream])

  const retryHistory = useCallback(() => {
    setHistoryStatus("loading")
    setHistoryError(null)
    setHistoryReloadKey((current) => current + 1)
  }, [])

  const loadOlderMessages = useCallback(async () => {
    const sessionID = activeSessionRef.current
    const cursor = olderCursorRef.current

    if (!sessionID || !cursor || loadingOlderRef.current) {
      return
    }

    olderAbortRef.current?.abort()
    const controller = new AbortController()
    olderAbortRef.current = controller
    loadingOlderRef.current = true
    setLoadingOlder(true)
    setOlderError(null)

    try {
      // The cursor page keeps the requested (desc) order, so it is reversed
      // before being prepended to the oldest-first list.
      const response = await openCode.message.list(
        {
          sessionID,
          cursor,
          limit: MESSAGE_LIMIT,
        },
        { signal: controller.signal }
      )

      if (controller.signal.aborted || activeSessionRef.current !== sessionID) {
        return
      }

      const nextCursor = response.cursor.next ?? null
      olderCursorRef.current = nextCursor
      setOlderCursor(nextCursor)
      setHasOlder(nextCursor !== null)
      setMessages((current) =>
        mergeOlderMessages(current, response.data.toReversed())
      )
    } catch (error) {
      if (
        !controller.signal.aborted &&
        activeSessionRef.current === sessionID
      ) {
        setOlderError(errorMessage(error))
      }
    } finally {
      if (olderAbortRef.current === controller) {
        olderAbortRef.current = null
      }
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [])

  const revealMessage = useCallback(async (messageID: string) => {
    const sessionID = activeSessionRef.current
    if (!sessionID) return "Select a session first."

    let loaded = messagesRef.current
    if (loaded.some((message) => message.id === messageID)) {
      setFocusMessageID(messageID)
      return null
    }

    let cursor = olderCursorRef.current
    let pageCount = 0
    try {
      while (cursor && pageCount < 30) {
        const response = await openCode.message.list({
          sessionID,
          cursor,
          limit: MESSAGE_LIMIT,
        })
        if (activeSessionRef.current !== sessionID) {
          return "The active session changed."
        }
        loaded = mergeOlderMessages(loaded, response.data.toReversed())
        cursor = response.cursor.next ?? null
        pageCount += 1
        if (loaded.some((message) => message.id === messageID)) break
      }

      if (!loaded.some((message) => message.id === messageID)) {
        return "That message is no longer available in the loaded history."
      }

      olderCursorRef.current = cursor
      setOlderCursor(cursor)
      setHasOlder(cursor !== null)
      setMessages(loaded)
      setFocusMessageID(messageID)
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }, [])

  const clearFocusMessage = useCallback(() => {
    setFocusMessageID(null)
  }, [])

  const clearSessionView = useCallback(() => {
    openSessionRequest.current += 1
    olderAbortRef.current?.abort()
    activeSessionRef.current = null
    setActiveSessionID(null)
    setFocusMessageID(null)
    setMessages([])
    setHistoryStatus("idle")
    setHistoryError(null)
  }, [])

  const reloadConfiguration = useCallback(async () => {
    try {
      await openCode.location.reload()
      setCommandsReloadKey((current) => current + 1)
      await loadCatalogs(commandDirectory || undefined)
      refreshSessions()
      return null
    } catch (error) {
      return errorMessage(error)
    }
  }, [commandDirectory, loadCatalogs, refreshSessions])

  const retryCatalogs = useCallback(() => {
    void loadCatalogs(commandDirectory || undefined)
  }, [commandDirectory, loadCatalogs])

  const activeSession =
    sessions.find((session) => session.id === activeSessionID) ?? null
  const sending = activeSessionID
    ? Boolean(sendingSessions[activeSessionID])
    : false
  const attachments = activeSessionID
    ? (attachmentsBySession[activeSessionID] ?? [])
    : []

  const state = useShallowMemo<OpenCodeState>({
    connection,
    connectionError,
    scope,
    location,
    projects,
    projectsStatus,
    projectsError,
    directory,
    directoryError,
    serverVersion,
    startupNotice,
    lastOpened,
    projectBusy,
    projectError,
    sessions,
    sessionsStatus,
    sessionsError,
    runningSessionIDs,
    unreadSessionIDs: sessionActivity.unread,
    activeSessionID,
    messages,
    historyStatus,
    historyError,
    olderCursor,
    hasOlder,
    loadingOlder,
    olderError,
    creating,
    createError,
    streamStatus,
    streamError,
    activeSession,
    sending,
    interrupting,
    agents,
    agentsStatus,
    agentsError,
    configEntries,
    models,
    modelsStatus,
    modelsError,
    switchingAgent,
    switchingModel,
    commands,
    commandsStatus,
    commandsError,
    commandsDirectory,
    pendingPermissions,
    pendingForms,
    permissionBusy,
    formBusy,
    draftPruneIds,
    attachments,
    inspectorOpen,
    inspectorTab,
    changesScope,
    diffFocusPath,
    archivedSessions,
    archivedStatus,
    archivedError,
    inbox,
    inboxStatus,
    inboxError,
    inboxBusy,
    composerRestore,
    focusMessageID,
  })

  const controller = useShallowMemo<OpenCodeController>({
    ...state,
    selectProject,
    selectAllProjects,
    selectSession,
    openSessionByID,
    subscribeSessionListChanges,
    retryConnection,
    retryProjects,
    refreshSessions,
    dismissStartupNotice,
    createSession,
    checkProjectDirectory,
    renameSession,
    deleteSession,
    sendPrompt,
    interruptSession,
    switchAgent,
    switchAgentWithDefaults,
    switchModel,
    replyPermission,
    replyForm,
    cancelForm,
    executeCommand,
    reloadCommands,
    openSession,
    openInspector,
    closeInspector,
    setInspectorTab: setInspectorTabSafe,
    setChangesScope,
    openInspectorDiff,
    setSessionArchived,
    loadArchivedSessions,
    unarchiveSession,
    loadInbox,
    cancelInboxItem,
    takeBackInboxItem,
    steerInboxItem,
    clearComposerRestore,
    loadTurnDiff,
    loadSessionContext,
    loadSessionStats,
    searchSessions,
    addAttachment,
    removeAttachment,
    attachProjectFile,
    retryCatalogs,
    retryStream,
    retryHistory,
    loadOlderMessages,
    forkSession,
    compactSession,
    stageRevert,
    clearRevert,
    moveSession,
    revealMessage,
    clearFocusMessage,
    clearSessionView,
    reloadConfiguration,
  })
  return controller
}
