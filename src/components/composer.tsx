import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import {
  ArrowUpIcon,
  FileTextIcon,
  FolderOpenIcon,
  ListEndIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { Dictation } from "@/components/dictation"
import { BtwDialog } from "@/components/btw-dialog"
import { FilesPanel } from "@/components/files-panel"
import { Dialog, DialogTitle } from "@/components/ui/dialog"
import { ModelSettingsDrawer, ModelSettingsInline } from "@/components/model-settings"
import {
  SessionCommandDialogs,
  type SessionCommandDialogKind,
} from "@/components/session-command-dialogs"
import {
  IntegrationCommandDialogs,
  type IntegrationCommandDialogKind,
} from "@/components/integration-command-dialogs"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
} from "@/components/ui/input-group"
import { canSendPrompt, createSessionSubmissionLock, createSessionCompositionState } from "@/lib/composer-state"
import {
  filterSlashCommands,
  findSlashCommand,
  latestAssistantText,
  mergeSlashCommands,
  parseSlashInput,
  slashQuery,
  type SlashCommand,
} from "@/lib/commands"
import {
  attachmentFromBrowserFile,
  type ComposerAttachment,
} from "@/lib/attachments"
import {
  MAX_ATTACHMENT_COUNT,
  formatFileSize,
  inferMime,
  isSafeImageMime,
} from "@/lib/files"
import { readDraft, readDrafts, updateDraft } from "@/lib/drafts"
import { fileQueryRange, fileReference } from "@/lib/file-references"
import { ComposerEditor, type ComposerEditorHandle } from "@/components/composer-editor"
import { fsFindUrl, type ProjectEntry } from "@/lib/files"
import { recordPerfRender } from "@/lib/perf-probe"
import { useLiveRunStatus } from "@/lib/use-live-run"
import { useIsDesktop } from "@/lib/use-is-desktop"
import type { OpenCodeController } from "@/lib/use-opencode"
import type { PromptSkillAttachment } from "@/lib/opencode"

type SelectedSkill = PromptSkillAttachment & { key: string }

function AttachmentPreview({
  attachment,
}: {
  attachment: ComposerAttachment
}) {
  if (
    attachment.previewDataUrl &&
    isSafeImageMime(attachment.mime) &&
    attachment.previewDataUrl.startsWith("data:image/") &&
    !attachment.previewDataUrl.toLowerCase().startsWith("data:image/svg")
  ) {
    return (
      <img
        src={attachment.previewDataUrl}
        alt=""
        className="size-9 shrink-0 rounded-lg object-cover"
      />
    )
  }

  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
      {attachment.source === "uri" ? (
        <FolderOpenIcon aria-hidden="true" className="size-4" />
      ) : (
        <FileTextIcon aria-hidden="true" className="size-4" />
      )}
    </span>
  )
}

export function Composer({ nav, modelSettingsOpen, onModelSettingsOpenChange }: { nav: OpenCodeController; modelSettingsOpen?: boolean; onModelSettingsOpenChange?: (open: boolean) => void }) {
  recordPerfRender("Composer")
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    readDrafts()
  )
  const [error, setError] = useState<string | null>(null)
  const [interruptError, setInterruptError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState(false)
  const [storageConflictKey, setStorageConflictKey] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dictationError, setDictationError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [skillsBySession, setSkillsBySession] = useState<
    Record<string, SelectedSkill[]>
  >({})
  const [pendingDelivery, setPendingDelivery] = useState<Record<string, "steer" | "queue" | null>>({})
  const [commandIndex, setCommandIndex] = useState(0)
  const [fileQuery, setFileQuery] = useState<{ query: string; start: number; end: number; sessionID: string } | null>(null)
  const [fileResults, setFileResults] = useState<ProjectEntry[]>([])
  const [fileStatus, setFileStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [fileIndex, setFileIndex] = useState(0)
  const [preview, setPreview] = useState<{ sessionID: string; path: string } | null>(null)
  const [commandPickerDismissed, setCommandPickerDismissed] = useState(false)
  const [commandFeedback, setCommandFeedback] = useState<{
    tone: "status" | "error"
    text: string
  } | null>(null)
  const [executingCommand, setExecutingCommand] = useState<Record<string, string>>({})
  const [sessionDialog, setSessionDialog] =
    useState<SessionCommandDialogKind | null>(null)
  const [sessionDialogText, setSessionDialogText] = useState("")
  const [integrationDialog, setIntegrationDialog] =
    useState<IntegrationCommandDialogKind | null>(null)
  const [btwQuestion, setBtwQuestion] = useState<string | null>(null)
  const composingRef = useRef(createSessionCompositionState())
  const activeDraftKeyRef = useRef<string | null>(null)
  const submittingRef = useRef(createSessionSubmissionLock())
  const serverCommandOverrideRef = useRef<string | null>(null)
  const lastPlainDraftRef = useRef<Record<string, string>>({})
  const draftRevisionsRef = useRef<Record<string, number>>({})
  const persistedDraftsRef = useRef<Record<string, string> | null>(null)
  if (persistedDraftsRef.current === null) persistedDraftsRef.current = { ...drafts }
  const draftsRef = useRef(drafts)
  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])
  const pickerId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)
  const attachmentSequenceRef = useRef(0)
  const skillSequenceRef = useRef(0)
  const formRef = useRef<HTMLFormElement>(null)
  const [composerWidth, setComposerWidth] = useState(0)
  const isDesktop = useIsDesktop()
  const inlineModelSettings = isDesktop && composerWidth >= 760

  useLayoutEffect(() => {
    const element = formRef.current
    if (!element) return
    const measure = () => setComposerWidth(element.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setComposerWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // A touch interaction selects virtual-keyboard behavior; a mouse or pen
  // interaction selects hardware-keyboard behavior on hybrid devices.
  const touchInputRef = useRef(typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)

  const activeSession = nav.activeSession
  const draftKey = nav.activeSessionID ?? "__none__"
  const [feedbackSession, setFeedbackSession] = useState(draftKey)
  if (feedbackSession !== draftKey) {
    setFeedbackSession(draftKey)
    setError(null)
    setInterruptError(null)
    setAttachmentError(null)
    setDictationError(null)
    setSettingsError(null)
    setCommandFeedback(null)
  }
  useLayoutEffect(() => {
    activeDraftKeyRef.current = draftKey
    composingRef.current.switchTo(draftKey)
  }, [draftKey])
  const draft = drafts[draftKey] ?? ""
  function persistDraft(key: string, value: string) {
    const baseline = persistedDraftsRef.current!
    const result = updateDraft(key, value, baseline[key] ?? "")
    if (result === "saved") {
      baseline[key] = value
      setStorageConflictKey((current) => (current === key ? null : current))
    } else if (result === "conflict") {
      setStorageConflictKey(key)
    }
    setStorageWarning(result === "unavailable")
  }
  const setDraft = (value: string) => {
    draftRevisionsRef.current[draftKey] = (draftRevisionsRef.current[draftKey] ?? 0) + 1
    if (!value.startsWith("/")) lastPlainDraftRef.current[draftKey] = value
    setCommandIndex(0)
    setCommandPickerDismissed(false)
    setCommandFeedback(null)
    persistDraft(draftKey, value)
    setDrafts((current) => ({ ...current, [draftKey]: value }))
  }

  function updateFileQuery(value: string, start: number, end: number) {
    const range = fileQueryRange(value, start, end)
    setFileQuery(range ? { ...range, sessionID: draftKey } : null)
    setFileResults([])
    setFileStatus("idle")
    setFileIndex(0)
  }

  function insertReference(path: string, range?: { start: number; end: number }) {
    const selection = editorRef.current?.selection()
    const start = range?.start ?? selection?.start ?? draft.length
    const end = range?.end ?? selection?.end ?? start
    const reference = fileReference(path)
    const prefix = start > 0 && !/\s/.test(draft[start - 1]) ? " " : ""
    const suffix = end < draft.length && /\s/.test(draft[end]) ? "" : " "
    setDraft(draft.slice(0, start) + prefix + reference + suffix + draft.slice(end))
    setFileQuery(null)
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      const caret = start + prefix.length + reference.length + suffix.length
      editorRef.current?.setCaret(caret)
    })
  }

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionID: string; path: string }>).detail
      if (!composingRef.current.isComposing(draftKey) && detail?.sessionID === nav.activeSessionID && typeof detail.path === "string") insertReference(detail.path)
    }
    window.addEventListener("composer-insert-project-reference", listener)
    return () => window.removeEventListener("composer-insert-project-reference", listener)
  })

  useEffect(() => {
    const directory = activeSession?.location?.directory
    if (!fileQuery || fileQuery.sessionID !== draftKey || !directory || !fileQuery.query.trim()) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setFileStatus("loading")
      fetch(fsFindUrl(directory, fileQuery.query), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Search failed")
          return await response.json() as { data: ProjectEntry[] }
        })
        .then((body) => { if (!controller.signal.aborted) { setFileResults((body.data ?? []).filter((entry) => entry.type === "file")); setFileStatus("ready") } })
        .catch(() => { if (!controller.signal.aborted) setFileStatus("error") })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [fileQuery, activeSession?.location?.directory, draftKey])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setFileQuery(null)
        setPreview(null)
      }
    })
    return () => { cancelled = true }
  }, [draftKey])

  const slashCommands = useMemo(
    () => mergeSlashCommands(nav.commands),
    [nav.commands]
  )
  const pickerQuery = slashQuery(draft)
  const filteredCommands = useMemo(
    () => filterSlashCommands(slashCommands, pickerQuery ?? ""),
    [pickerQuery, slashCommands]
  )
  const pickerOpen = pickerQuery !== null && !commandPickerDismissed
  const activeCommandIndex =
    filteredCommands.length > 0
      ? Math.min(commandIndex, filteredCommands.length - 1)
      : -1
  const slashDraft = parseSlashInput(draft)
  const unknownSlash = slashDraft !== null && !findSlashCommand(slashCommands, slashDraft.name)
  const slashText = draft.startsWith("/")
  const selectedSkills = skillsBySession[draftKey] ?? []

  useEffect(() => {
    if (draft && !draft.startsWith("/") && lastPlainDraftRef.current[draftKey] === undefined) {
      lastPlainDraftRef.current[draftKey] = draft
    }
  }, [draftKey, draft])

  useEffect(() => {
    if (!pickerOpen || activeCommandIndex < 0) return
    document.getElementById(`${pickerId}-option-${activeCommandIndex}`)?.scrollIntoView({ block: "nearest" })
  }, [pickerOpen, activeCommandIndex, pickerId])

  // Re-hydrate a session draft that is not yet in memory (e.g. written by
  // another tab); storage remains authoritative and is never overwritten here.
  useEffect(() => {
    if (draftKey === "__none__") {
      return
    }

    void Promise.resolve().then(() => {
      setDrafts((current) => {
        if (Object.prototype.hasOwnProperty.call(current, draftKey)) {
          return current
        }

        const stored = readDraft(draftKey)
        persistedDraftsRef.current![draftKey] = stored
        return stored ? { ...current, [draftKey]: stored } : current
      })
    })
  }, [draftKey])

  // A session's absence from a scoped/paginated list is not proof of deletion,
  // so drafts are only dropped when the controller reports a *confirmed*
  // deletion (and its removed child sessions) via this list.
  useEffect(() => {
    if (nav.draftPruneIds.length === 0) {
      return
    }

    const removed = new Set(nav.draftPruneIds)

    void Promise.resolve().then(() => {
      setDrafts((current) => {
        let changed = false
        const next: Record<string, string> = {}

        for (const [key, value] of Object.entries(current)) {
          if (removed.has(key)) {
            changed = true
          } else {
            next[key] = value
          }
        }

        return changed ? next : current
      })
    })
  }, [nav.draftPruneIds])

  const runStatus = useLiveRunStatus(nav.activeSessionID)
  const responding = runStatus === "running"
  const streamReady = nav.streamStatus === "ready"

  // Real selection: a session is promptable whenever it has a model; the
  // verified-free gate was a testing-only restriction and is no longer applied.
  const modelReady = Boolean(activeSession?.model)
  const canSend = canSendPrompt({
    hasSession: Boolean(activeSession),
    connected: nav.connection === "connected",
    streamReady,
    modelReady,
    admissionPending: nav.sending,
    hasText: draft.trim().length > 0,
    hasFiles: nav.attachments.length > 0,
  }) && !attaching
  const canQueue = responding && canSend && !slashText

  const blockedReason = !activeSession
    ? null
    : nav.connection !== "connected"
      ? "Offline. Reconnect to prompt."
      : nav.streamStatus === "lost"
        ? "Event stream disconnected. Prompts are paused."
        : nav.streamStatus !== "ready"
          ? "Connecting to the event stream…"
          : !modelReady
            ? `This session has no model selected. Choose one in the model settings.`
            : null

  const visibleError =
    error ??
    interruptError ??
    dictationError ??
    attachmentError ??
    settingsError ??
    (commandFeedback?.tone === "error" ? commandFeedback.text : null)
  const statusText =
    visibleError ??
    (attaching ? "Attaching files…" : null) ??
    blockedReason ??
    (nav.sending
      ? executingCommand[draftKey]
        ? `Running /${executingCommand[draftKey]}…`
        : pendingDelivery[draftKey] === "queue"
          ? "Queueing message…"
          : responding
            ? "Sending steer…"
            : "Sending message…"
      : commandFeedback?.tone === "status"
        ? commandFeedback.text
        : null)

  function focusComposer() {
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  function isVisible(element: HTMLElement) {
    const style = getComputedStyle(element)
    return (
      element.getClientRects().length > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    )
  }

  function clickVisible(selector: string) {
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (candidate) =>
        isVisible(candidate) &&
        !candidate.hasAttribute("disabled") &&
        candidate.getAttribute("aria-disabled") !== "true"
    )
    if (!element) return false
    element.click()
    return true
  }

  function clickVisibleText(text: string) {
    const element = [...document.querySelectorAll<HTMLElement>("button")].find(
      (candidate) =>
        isVisible(candidate) &&
        !candidate.hasAttribute("disabled") &&
        candidate.textContent?.includes(text)
    )
    if (!element) return false
    element.click()
    return true
  }

  const waitForUi = () => new Promise((resolve) => setTimeout(resolve, 220))

  async function openSessionsUi() {
    if (clickVisible('button[aria-label="Open sessions"]')) {
      await waitForUi()
      return true
    }
    const firstSession = [
      ...document.querySelectorAll<HTMLElement>(
        'aside nav[aria-label="Sessions"] button[title^="ses_"]'
      ),
    ].find(isVisible)
    firstSession?.focus()
    return Boolean(firstSession)
  }

  async function openNewSessionUi() {
    if (clickVisibleText("New session")) return true
    if (!(await openSessionsUi())) return false
    await waitForUi()
    return clickVisibleText("New session")
  }

  async function openSettingsUi() {
    if (clickVisible('button[aria-label="Settings"]')) return true
    if (!(await openSessionsUi())) return false
    await waitForUi()
    return clickVisible('button[aria-label="Settings"]')
  }

  async function openThemesUi() {
    if (clickVisible('button[aria-label^="Theme:"]')) return true
    if (!(await openSessionsUi())) return false
    await waitForUi()
    return clickVisible('button[aria-label^="Theme:"]')
  }

  function clearExactDraft(sessionKey: string, submitted: string, revision: number) {
    if (draftsRef.current[sessionKey] !== submitted) return
    if ((draftRevisionsRef.current[sessionKey] ?? 0) !== revision) return
    persistDraft(sessionKey, "")
    setDrafts((current) => {
      if (current[sessionKey] !== submitted) return current
      return { ...current, [sessionKey]: "" }
    })
  }

  function applySkills(skills: readonly { id: string; name: string }[]) {
    setSkillsBySession((current) => {
      const existing = current[draftKey] ?? []
      const existingById = new Map(existing.map((skill) => [skill.id, skill]))
      const next = skills.map((skill) => {
        const prior = existingById.get(skill.id)
        if (prior) return prior
        skillSequenceRef.current += 1
        return {
          id: skill.id,
          name: skill.name,
          key: `skill-${skillSequenceRef.current}`,
        }
      })
      return { ...current, [draftKey]: next }
    })
  }

  function removeSkill(key: string) {
    setSkillsBySession((current) => {
      const existing = current[draftKey] ?? []
      const next = existing.filter((skill) => skill.key !== key)
      return { ...current, [draftKey]: next }
    })
  }

  function clearExactSkills(
    sessionKey: string,
    submitted: readonly SelectedSkill[]
  ) {
    if (submitted.length === 0) return
    const keys = new Set(submitted.map((skill) => skill.key))
    setSkillsBySession((current) => {
      const existing = current[sessionKey]
      if (!existing) return current
      const next = existing.filter((skill) => !keys.has(skill.key))
      return { ...current, [sessionKey]: next }
    })
  }

  function openSessionDialog(
    kind: SessionCommandDialogKind,
    text = ""
  ) {
    // Let the nonmodal picker unmount before opening the modal dialog.
    window.setTimeout(() => {
      setSessionDialogText(text)
      setSessionDialog(kind)
    }, 160)
  }

  function openIntegrationDialog(kind: IntegrationCommandDialogKind) {
    window.setTimeout(() => setIntegrationDialog(kind), 160)
  }

  function openBtw(question: string) {
    window.setTimeout(() => setBtwQuestion(question), 160)
  }

  async function runNativeCommand(
    command: SlashCommand,
    argumentsText: string
  ): Promise<{
    ok: boolean
    message?: string
    keepDraft?: boolean
    focus?: boolean
  }> {
    const native = command.native
    if (!native) return { ok: false, message: "Not a native command." }

    switch (native.action) {
      case "help":
        setDraft("/")
        setCommandPickerDismissed(false)
        setCommandIndex(0)
        focusComposer()
        return {
          ok: true,
          keepDraft: true,
          focus: true,
          message:
            "Type / to search commands. Use ↑/↓, Enter or Tab to select, Escape to close.",
        }
      case "sessions":
      case "open": {
        const opened = await openSessionsUi()
        return opened
          ? { ok: true, message: "Opened the session navigator." }
          : { ok: false, message: "The session navigator is unavailable." }
      }
      case "new": {
        const opened = await openNewSessionUi()
        return opened
          ? { ok: true, message: "Opened New session." }
          : { ok: false, message: "New session is unavailable right now." }
      }
      case "models":
      case "agents":
      case "thinking": {
        if (inlineModelSettings) {
          onModelSettingsOpenChange?.(true)
          return {
            ok: true,
            message: "Opened the current session's model settings.",
          }
        }
        const opened = clickVisible('button[aria-label^="Active model"]')
        return opened
          ? {
              ok: true,
              message: "Opened the current session's model settings.",
            }
          : { ok: false, message: "Model settings are unavailable." }
      }
      case "settings": {
        const opened = await openSettingsUi()
        return opened
          ? { ok: true, message: "Opened Preferences." }
          : { ok: false, message: "Preferences are unavailable right now." }
      }
      case "themes": {
        const opened = await openThemesUi()
        return opened
          ? { ok: true, message: "Opened the theme picker." }
          : { ok: false, message: "The theme picker is unavailable." }
      }
      case "diff": {
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session to inspect changes." }
        }
        nav.openInspector("changes")
        return { ok: true, message: "Opened Changes." }
      }
      case "copy": {
        const text = latestAssistantText(nav.messages)
        if (!text) {
          return { ok: false, message: "No assistant message text to copy." }
        }
        try {
          if (!navigator.clipboard?.writeText) {
            throw new Error("Clipboard API is unavailable in this browser context.")
          }
          await navigator.clipboard.writeText(text)
          return { ok: true, message: "Copied the last assistant message." }
        } catch (failure) {
          return {
            ok: false,
            message:
              failure instanceof Error
                ? failure.message
                : "Could not copy the message.",
          }
        }
      }
      case "mcps":
        openIntegrationDialog("mcps")
        return { ok: true, message: "Opened MCP status and resources." }
      case "connect":
        openIntegrationDialog("connect")
        return {
          ok: true,
          message: "Opened the read-only provider/integration catalog.",
        }
      case "worktrees":
        if (!nav.location?.project.id && !nav.activeSession?.projectID) {
          return { ok: false, message: "Select a project or session first." }
        }
        openIntegrationDialog("worktrees")
        return { ok: true, message: "Opened the project worktree manager." }
      case "plugins":
        openIntegrationDialog("plugins")
        return { ok: true, message: "Opened native plugin metadata." }
      case "stats":
        openIntegrationDialog("stats")
        return { ok: true, message: "Gathering native usage statistics." }
      case "reload":
        openIntegrationDialog("reload")
        return { ok: true, message: "Opened configuration reload confirmation." }
      case "debug":
        openIntegrationDialog("debug")
        return { ok: true, message: "Opened sanitized client diagnostics." }
      case "btw":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openBtw(argumentsText)
        return {
          ok: true,
          message: "Opened the side-question panel. Press Ask to make the model request.",
        }
      case "status": {
        const session = nav.activeSession
        const project =
          nav.scope === "all"
            ? "All projects"
            : (nav.location?.project.canonical ?? "No project")
        return {
          ok: true,
          message: [
            `Connection: ${nav.connection}`,
            `stream: ${nav.streamStatus}`,
            `project: ${project}`,
            session ? `session: ${session.id}` : "no selected session",
            session?.model
              ? `model: ${session.model.providerID}/${session.model.id}${session.model.variant ? ` · ${session.model.variant}` : ""}`
              : "model: none",
          ].join(" · "),
        }
      }
      case "rename": {
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        const title = argumentsText.trim()
        if (!title) {
          openSessionDialog("rename")
          return { ok: true, message: "Opened the session rename dialog." }
        }
        const failure = await nav.renameSession(nav.activeSession.id, title)
        return failure
          ? { ok: false, message: failure }
          : { ok: true, message: "Session renamed." }
      }
      case "timeline":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("timeline")
        return { ok: true, message: "Opened the native message timeline." }
      case "export":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("export")
        return { ok: true, message: "Preparing the native session export." }
      case "fork":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("fork")
        return { ok: true, message: "Opened the fork boundary picker." }
      case "compact":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("compact")
        return { ok: true, message: "Opened compaction confirmation." }
      case "undo":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("undo")
        return { ok: true, message: "Opened the native undo preview." }
      case "redo":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("redo")
        return { ok: true, message: "Opened the native redo confirmation." }
      case "cd":
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("cd", argumentsText.trim())
        return { ok: true, message: "Opened the change-directory dialog." }
      case "skills": {
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("skills")
        return { ok: true, message: "Opened the native skill catalog." }
      }
      case "editor": {
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        openSessionDialog("editor", lastPlainDraftRef.current[draftKey] ?? (draft.startsWith("/") ? "" : draft))
        return { ok: true, message: "Opened the web draft editor." }
      }
      case "clear": {
        if (!nav.activeSession) {
          return { ok: false, message: "Select a session first." }
        }
        nav.closeInspector()
        nav.clearSessionView()
        return {
          ok: true,
          message:
            "Cleared the conversation view. The session, draft, and background work remain.",
        }
      }
      case "unsupported":
      default:
        return {
          ok: false,
          message:
            command.reason ??
            native.reason ??
            "This native command is not available in the browser yet.",
        }
    }
  }

  async function executeServerCommand(
    command: SlashCommand,
    argumentsText: string
  ) {
    const session = nav.activeSession
    const directory = session?.location?.directory
    if (!session || !directory) {
      setCommandFeedback({
        tone: "error",
        text: "Select a session to run project commands.",
      })
      return
    }
    if (
      nav.commandsDirectory !== directory ||
      !nav.commands.some((candidate) => candidate.name === command.name)
    ) {
      nav.reloadCommands()
      setCommandFeedback({
        tone: "error",
        text: "The project command catalog changed. Reopen / and choose the command again.",
      })
      return
    }

    const submitted = draft
    const sessionKey = draftKey
    const revision = draftRevisionsRef.current[sessionKey] ?? 0
    const attachments = nav.attachments
    if (!submittingRef.current.acquire(sessionKey)) return
    setExecutingCommand((current) => ({ ...current, [sessionKey]: command.name }))
    setError(null)
    try {
      const failure = await nav.executeCommand(
        command.name,
        argumentsText,
        attachments
      )
      if (failure) {
        if (activeDraftKeyRef.current === sessionKey) setError(failure)
        return
      }
      clearExactDraft(sessionKey, submitted, revision)
      if (activeDraftKeyRef.current === sessionKey) {
        serverCommandOverrideRef.current = null
        setCommandFeedback({
          tone: "status",
          text: `/${command.name} accepted by the backend.`,
        })
      }
    } catch (failure) {
      if (activeDraftKeyRef.current === sessionKey) setError(failure instanceof Error ? failure.message : "Could not run the command.")
    } finally {
      submittingRef.current.release(sessionKey)
      setExecutingCommand((current) => { const next = { ...current }; delete next[sessionKey]; return next })
    }
  }

  async function activateSlashCommand(command: SlashCommand) {
    setCommandFeedback(null)
    setError(null)

    if (command.source === "server" || command.arguments === "required") {
      serverCommandOverrideRef.current =
        command.source === "server" ? command.name : null
      setDraft(`/${command.name} `)
      setCommandPickerDismissed(true)
      focusComposer()
      return
    }

    serverCommandOverrideRef.current = null
    const submitted = draft
    const sessionKey = draftKey
    const revision = draftRevisionsRef.current[sessionKey] ?? 0
    let result: Awaited<ReturnType<typeof runNativeCommand>>
    try {
      result = await runNativeCommand(command, "")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not run the command.")
      return
    }
    setCommandPickerDismissed(!result.keepDraft)
    if (result.ok && !result.keepDraft) {
      clearExactDraft(sessionKey, submitted, revision)
    }
    if (result.message) {
      setCommandFeedback({
        tone: result.ok ? "status" : "error",
        text: result.message,
      })
    }
    if (result.focus) focusComposer()
  }

  async function submitSlashDraft(): Promise<boolean> {
    const parsed = parseSlashInput(draft)
    if (!parsed) return false
    const explicitlySelectedServer =
      serverCommandOverrideRef.current === parsed.name
        ? (slashCommands.find(
            (candidate) =>
              candidate.source === "server" && candidate.name === parsed.name
          ) ?? null)
        : null
    const command =
      explicitlySelectedServer ?? findSlashCommand(slashCommands, parsed.name)
    if (!command) {
      serverCommandOverrideRef.current = null
      setCommandFeedback({
        tone: "error",
        text: `Unknown command /${parsed.name}. Choose a command or send this as a literal message.`,
      })
      setCommandPickerDismissed(true)
      return true
    }

    const argumentsText = parsed.argumentsText
    if (command.arguments === "required" && !argumentsText.trim()) {
      setCommandFeedback({
        tone: "error",
        text: `/${command.name} requires arguments.`,
      })
      return true
    }
    if (command.arguments === "none" && argumentsText.trim()) {
      setCommandFeedback({
        tone: "error",
        text: `/${command.name} does not take arguments.`,
      })
      return true
    }
    if (command.status === "unsupported") {
      setCommandPickerDismissed(true)
      setCommandFeedback({
        tone: "error",
        text:
          command.reason ??
          `/${command.name} is not available in the browser yet.`,
      })
      return true
    }

    if (command.source === "server") {
      await executeServerCommand(command, argumentsText)
      return true
    }

    serverCommandOverrideRef.current = null
    const submitted = draft
    const sessionKey = draftKey
    const revision = draftRevisionsRef.current[sessionKey] ?? 0
    let result: Awaited<ReturnType<typeof runNativeCommand>>
    try {
      result = await runNativeCommand(command, argumentsText)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not run the command.")
      return true
    }
    if (result.ok && !result.keepDraft) clearExactDraft(sessionKey, submitted, revision)
    setCommandPickerDismissed(true)
    if (result.message) {
      setCommandFeedback({
        tone: result.ok ? "status" : "error",
        text: result.message,
      })
    }
    if (result.focus) focusComposer()
    return true
  }

  async function addFiles(
    files: File[],
    targetSessionID: string | null,
    source: "picker" | "paste"
  ) {
    if (!targetSessionID || targetSessionID !== nav.activeSessionID) {
      return
    }
    if (files.length === 0) {
      if (source === "picker" && fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      return
    }

    setAttachmentError(null)
    const remaining = MAX_ATTACHMENT_COUNT - nav.attachments.length
    if (remaining <= 0) {
      setAttachmentError(
        `You can attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`
      )
      if (source === "picker" && fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      return
    }

    setAttaching(true)
    const failures: string[] = []
    const knownUris = new Set(nav.attachments.map((item) => item.uri))

    for (const [index, file] of files.slice(0, remaining).entries()) {
      try {
        attachmentSequenceRef.current += 1
        const extension = mimeExtension(file)
        const fallbackName =
          source === "paste"
            ? `${isImageClipboardFile(file) ? "clipboard-image" : "clipboard-file"}-${index + 1}${extension ? `.${extension}` : ""}`
            : `attachment-${index + 1}`
        const attachment = await attachmentFromBrowserFile(
          file,
          `${source}-${attachmentSequenceRef.current}`,
          fallbackName
        )
        if (knownUris.has(attachment.uri)) continue
        const failure = nav.addAttachment(attachment, targetSessionID)
        if (failure) {
          failures.push(failure)
        } else {
          knownUris.add(attachment.uri)
        }
      } catch (failure) {
        failures.push(failure instanceof Error ? failure.message : String(failure))
      }
    }

    if (files.length > remaining) {
      failures.push(
        `Only ${remaining} more file${remaining === 1 ? "" : "s"} can be attached.`
      )
    }

    setAttaching(false)
    if (activeDraftKeyRef.current === targetSessionID) {
      setAttachmentError(failures.length > 0 ? failures.join(" ") : null)
    }
    if (source === "picker" && fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  function mimeExtension(file: File): string {
    const type = file.type.toLowerCase()
    if (type === "image/jpeg" || type === "image/jpg") return "jpg"
    const fromMime = type.split("/")[1]?.split("+")[0]
    if (fromMime && /^[a-z0-9]+$/i.test(fromMime)) return fromMime
    const fromName = inferMime(file.name).split("/")[1]
    return fromName && /^[a-z0-9]+$/i.test(fromName) ? fromName : ""
  }

  function isImageClipboardFile(file: File): boolean {
    return (
      file.type.toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|avif|svg|heic|heif|tiff?)$/i.test(file.name)
    )
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const clipboard = event.clipboardData
    if (!clipboard) return

    // Snapshot the native File objects and text presence before any await; a
    // React synthetic event's clipboardData is not retained asynchronously.
    const itemFiles = [...clipboard.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    const files = itemFiles.length > 0 ? itemFiles : [...clipboard.files]
    const plainText = clipboard.getData("text/plain")
    const hasText = Boolean(
      plainText || clipboard.getData("text/html")
    )
    // File pastes are handled as attachments, including files whose type and
    // name do not identify them; the attachment reader sniffs safe image
    // signatures. A mixed paste keeps the browser's ordinary text insertion
    // and adds the file too.
    if (files.length > 0) {
      if (!hasText) event.preventDefault()
      void addFiles(files, nav.activeSessionID, "paste")
    }
    // Lexical's normal paste path normalizes CRLF. Insert the clipboard's
    // literal plain text instead so drafts and prompt bytes remain unchanged.
    if (plainText.includes("\r")) {
      event.preventDefault()
      event.stopPropagation()
      editorRef.current?.insertPlainText(plainText)
    }
  }

  async function submit(delivery: "steer" | "queue" | null = responding ? "steer" : null) {
    if (!canSend) {
      return
    }
    if (delivery === "queue" && (!responding || slashText)) {
      if (slashText) {
        setCommandFeedback({
          tone: "error",
          text: "Slash commands cannot be queued as a prompt.",
        })
      }
      return
    }

    const submitted = draft
    const sessionKey = draftKey
    const revision = draftRevisionsRef.current[sessionKey] ?? 0
    const submittedSkills = selectedSkills
    if (!submittingRef.current.acquire(sessionKey)) return
    setError(null)
    setPendingDelivery((current) => ({ ...current, [sessionKey]: delivery }))

    try {
      const failure = await nav.sendPrompt(submitted, delivery, submittedSkills)

      if (failure) {
        if (activeDraftKeyRef.current === sessionKey) setError(failure)
        return
      }

      if (activeDraftKeyRef.current === sessionKey) setAttachmentError(null)
      clearExactSkills(sessionKey, submittedSkills)

      // Never discard edits made while admission was in flight.
      clearExactDraft(sessionKey, submitted, revision)
    } catch (failure) {
      if (activeDraftKeyRef.current === sessionKey) setError(failure instanceof Error ? failure.message : "Could not send the message.")
    } finally {
      submittingRef.current.release(sessionKey)
      setPendingDelivery((current) => { const next = { ...current }; delete next[sessionKey]; return next })
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (composingRef.current.isComposing(draftKey)) return
    if (slashDraft) {
      void submitSlashDraft()
      return
    }
    if (pickerQuery !== null) {
      setCommandFeedback({
        tone: "error",
        text: "Choose a command or continue typing.",
      })
      return
    }
    void submit(responding ? "steer" : null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const native = event.nativeEvent
    if (composingRef.current.isComposing(draftKey) || native.isComposing || native.keyCode === 229) {
      return
    }

    if (fileQuery?.sessionID === draftKey) {
      if (event.key === "Escape") { event.preventDefault(); setFileQuery(null); return }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (fileResults.length) {
          event.preventDefault()
          setFileIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + fileResults.length) % fileResults.length)
        }
        return
      }
      if (event.key === "Enter" && !touchInputRef.current && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && fileResults[fileIndex]) {
        event.preventDefault()
        insertReference(fileResults[fileIndex].path, fileQuery)
        return
      }
    }

    if (pickerOpen) {
      if (event.key === "Escape") {
        event.preventDefault()
        setCommandPickerDismissed(true)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        if (filteredCommands.length === 0) return
        const direction = event.key === "ArrowDown" ? 1 : -1
        setCommandIndex(
          (activeCommandIndex + direction + filteredCommands.length) %
            filteredCommands.length
        )
        return
      }
      if (event.key === "Enter" && !touchInputRef.current && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && filteredCommands.length > 0) {
        event.preventDefault()
        const command = filteredCommands[activeCommandIndex]
        if (command) void activateSlashCommand(command)
        return
      }
    }

    if (event.key !== "Enter") {
      return
    }

    // Virtual keyboards insert a newline; only Send/command-item activation submits.
    if (touchInputRef.current) {
      return
    }

    if (
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !canSend
    ) {
      return
    }

    event.preventDefault()
    if (slashDraft) {
      void submitSlashDraft()
      return
    }
    void submit()
  }

  async function handleInterrupt() {
    setInterruptError(null)
    const failure = await nav.interruptSession()
    setInterruptError(failure)
  }

  return (
    <div className="safe-horizontal shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))] md:px-0 md:pb-6">
      <Popover
        open={pickerOpen}
        onOpenChange={(next) => {
          if (!next) setCommandPickerDismissed(true)
        }}
        modal={false}
      >
      <form ref={formRef} className="shrink-0" onSubmit={handleSubmit}>
      {activeSession && preview?.sessionID === draftKey ? (
        <Dialog open onOpenChange={(open) => { if (!open) setPreview(null) }}>
          <ResponsiveDialogContent className="max-h-[85svh] overflow-auto sm:max-w-2xl md:max-w-3xl">
            <DialogTitle>Project file preview</DialogTitle>
            <FilesPanel key={`${preview.sessionID}:${preview.path}`} nav={nav} session={activeSession} initialPath={preview.path} />
          </ResponsiveDialogContent>
        </Dialog>
      ) : null}
      {fileQuery?.sessionID === draftKey ? (
        <div className="mb-1 max-h-48 overflow-auto rounded-lg border bg-popover p-2 text-sm" aria-label="Project file suggestions">
          {!activeSession?.location?.directory ? <p role="status">This session has no project directory.</p> : !fileQuery.query.trim() ? <p role="status">Type a file name to search.</p> : fileStatus === "error" ? <p role="alert">Project file search failed.</p> : fileStatus !== "ready" ? <p role="status">Searching project files…</p> : fileResults.length === 0 ? <p role="status">No matching files.</p> : (
            <><p className="sr-only" role="status">{fileResults.length} results. Selected {fileResults[fileIndex]?.path}.</p><ul id={`${pickerId}-files-list`} role="listbox" aria-label="Project file suggestions">{fileResults.map((entry, index) => <li key={entry.path} role="presentation"><Button id={`${pickerId}-file-${index}`} role="option" aria-selected={index === fileIndex} type="button" variant={index === fileIndex ? "secondary" : "ghost"} className="min-h-11 w-full justify-start" onMouseDown={(event) => event.preventDefault()} onClick={() => insertReference(entry.path, fileQuery)}><span className="truncate" dir="ltr">{entry.path}</span></Button></li>)}</ul></>
          )}
        </div>
      ) : null}
      <p
        id="composer-status"
        className={
          statusText
            ? visibleError
              ? "mb-1.5 px-4 text-xs break-words text-destructive"
              : "mb-1.5 px-4 text-xs break-words text-muted-foreground"
            : "sr-only"
        }
        role={visibleError ? "alert" : "status"}
      >
        {statusText ??
          (activeSession ? "Prompt composer ready." : "Select a session to prompt.")}
      </p>
      {nav.connection === "connected" && nav.streamStatus === "lost" ? (
        <div className="mb-1.5 px-4">
          <Button
            type="button"
            variant="outline"
            onClick={nav.retryStream}
            className="h-11 px-3 text-xs"
          >
            Retry event stream
          </Button>
        </div>
      ) : null}
      {storageWarning ? (
        <p
          role="status"
          className="mb-1.5 px-4 text-xs break-words text-muted-foreground"
        >
          Draft not saved — browser storage is unavailable.
        </p>
      ) : null}
      {storageConflictKey === draftKey ? (
        <p role="alert" className="mb-1.5 px-4 text-xs break-words text-destructive">
          Draft not saved: this session changed in another tab. Copy your text before switching or reloading.
        </p>
      ) : null}
      {unknownSlash ? (
        <div className="mb-1.5 px-4">
          <Button type="button" variant="outline" className="min-h-11" disabled={!canSend} onClick={() => void submit(responding ? "steer" : null)}>
            Send as literal message{responding ? " (steer)" : ""}
          </Button>
        </div>
      ) : null}
      {selectedSkills.length > 0 ? (
        <div className="mb-1.5 px-4">
          <ul aria-label="Selected skills" className="flex gap-1.5 overflow-x-auto pb-0.5">
            {selectedSkills.map((skill) => (
              <li
                key={skill.key}
                className="flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 py-0.5 ps-3 pe-0.5"
              >
                <span className="max-w-48 truncate text-xs font-medium">
                  {skill.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove skill ${skill.name}`}
                  onClick={() => removeSkill(skill.key)}
                  className="size-11 shrink-0 rounded-full text-muted-foreground"
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <p role="status" className="text-[11px] text-muted-foreground">
            Skills are sent only with your next explicit Send.
          </p>
        </div>
      ) : null}
      {nav.attachments.length > 0 ? (
        <div className="mb-1.5 space-y-1 px-4">
          <ul aria-label="Pending attachments" className="flex gap-2 overflow-x-auto pb-0.5">
            {nav.attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex min-h-11 max-w-[18rem] shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-background/70 p-1.5"
              >
                <AttachmentPreview attachment={attachment} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {attachment.name}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {attachment.mime}
                    {attachment.size !== null
                      ? ` · ${formatFileSize(attachment.size)}`
                      : ""}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove attachment ${attachment.name}`}
                  onClick={() => nav.removeAttachment(attachment.id)}
                  className="size-11 shrink-0 rounded-full text-muted-foreground"
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <p role="status" className="text-[11px] break-words text-muted-foreground">
            Files stay in this tab and are not saved with drafts.
          </p>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Choose files to attach"
        onChange={(event) =>
          void addFiles(
            [...(event.target.files ?? [])],
            nav.activeSessionID,
            "picker"
          )
        }
      />
      <InputGroup data-composer-surface className="relative h-auto min-h-0 flex-col items-stretch gap-0 rounded-[26px] border-transparent bg-secondary px-0 py-0 shadow-xs md:rounded-[28px]">
        <PopoverTrigger
          nativeButton={false}
          render={
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            />
          }
        />
        <ComposerEditor
          key={draftKey}
          ref={editorRef}
          sessionKey={draftKey}
          value={draft}
          onChange={(value, start, end) => { setDraft(value); if (!composingRef.current.isComposing(draftKey)) updateFileQuery(value, start, end) }}
          onSelection={(value, start, end) => { if (!composingRef.current.isComposing(draftKey)) updateFileQuery(value, start, end) }}
          onPreview={(path) => { if (activeSession) { setFileQuery(null); setPreview({ sessionID: draftKey, path }) } }}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => { touchInputRef.current = event.pointerType === "touch" }}
          onPaste={handlePaste}
          onCompositionStart={() => { composingRef.current.start(draftKey) }}
          onCompositionEnd={() => { composingRef.current.end(draftKey) }}
          controls={fileQuery?.sessionID === draftKey && fileStatus === "ready" && fileResults.length > 0 ? `${pickerId}-files-list` : pickerOpen && filteredCommands.length > 0 ? `${pickerId}-list` : undefined}
          activeDescendant={fileQuery?.sessionID === draftKey && fileStatus === "ready" && fileResults[fileIndex] ? `${pickerId}-file-${fileIndex}` : pickerOpen && activeCommandIndex >= 0 ? `${pickerId}-option-${activeCommandIndex}` : undefined}
        />

        <div data-composer-footer className="flex w-full min-w-0 items-center gap-1 px-2 pb-2">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={
                    activeSession
                      ? "Attach files"
                      : "Select a session to attach files"
                  }
                  aria-busy={attaching}
                  disabled={!activeSession || attaching}
                  className="size-11 shrink-0 rounded-full text-foreground"
                />
              }
            >
              {attaching ? (
                <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin" />
              ) : (
                <PlusIcon aria-hidden="true" className="size-5" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-56">
              <DropdownMenuItem
                className="min-h-11"
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon aria-hidden="true" className="size-4" />
                Attach files
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11"
                onClick={() => nav.openInspector("files")}
              >
                <FolderOpenIcon aria-hidden="true" className="size-4" />
                Project files
              </DropdownMenuItem>
              {responding ? (
                <DropdownMenuItem
                  className="min-h-11"
                  disabled={!canQueue}
                  onClick={() => void submit("queue")}
                >
                  <ListEndIcon aria-hidden="true" className="size-4" />
                  Queue message
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <Dictation
            key={draftKey}
            enabled={Boolean(activeSession)}
            onError={setDictationError}
            onText={(text) => {
              if (activeDraftKeyRef.current !== draftKey) return
              if (composingRef.current.isComposing(draftKey)) {
                setError("Dictation text was not inserted during text composition. Please try again.")
                return
              }
              editorRef.current?.insertPlainText(text)
            }}
          />

          {inlineModelSettings ? (
            <ModelSettingsInline
              nav={nav}
              open={modelSettingsOpen}
              onOpenChange={onModelSettingsOpenChange}
              onError={setSettingsError}
            />
          ) : null}

          <div className="min-w-0 flex-1" aria-hidden="true" />

          {inlineModelSettings ? null : (
            <ModelSettingsDrawer nav={nav} open={modelSettingsOpen} onOpenChange={onModelSettingsOpenChange} />
          )}

          {responding ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Stop response"
              aria-busy={nav.interrupting}
              onClick={() => void handleInterrupt()}
              disabled={nav.interrupting}
              className="size-11 shrink-0 rounded-full bg-transparent text-foreground hover:bg-transparent focus-visible:text-foreground focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:text-muted-foreground disabled:opacity-40 disabled:aria-busy:opacity-100 disabled:aria-busy:text-foreground"
            >
              {nav.interrupting ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="size-5 animate-spin"
                />
              ) : (
                <SquareIcon aria-hidden="true" className="size-4" />
              )}
            </Button>
          ) : null}

          <Button
            type="submit"
            size="icon-lg"
            aria-label={responding ? "Send message (steer)" : "Send message"}
            aria-describedby="composer-status"
            aria-busy={nav.sending}
            disabled={!canSend}
            className="size-11 shrink-0 rounded-full bg-[var(--composer-send)] text-[var(--composer-send-foreground)] shadow-none hover:bg-[var(--composer-send-hover)] focus-visible:text-[var(--composer-send-foreground)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:hover:bg-muted"
          >
            {nav.sending ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-5 animate-spin"
              />
            ) : (
              <ArrowUpIcon aria-hidden="true" className="size-5" />
            )}
          </Button>
        </div>
      </InputGroup>
      </form>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        initialFocus={false}
        finalFocus={false}
        className="max-h-80 w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] overflow-y-auto p-1"
      >
        <div className="flex items-center justify-between px-2 pb-1 text-[11px] text-muted-foreground">
          <span>Commands</span>
          <span className="tabular-nums">{filteredCommands.length}</span>
        </div>
        {nav.commandsStatus === "loading" ? (
          <p role="status" className="px-2 py-1 text-[11px] text-muted-foreground">
            Loading project commands…
          </p>
        ) : null}
        {nav.commandsError ? (
          <div role="alert" className="mx-1 mb-1 rounded-md border border-destructive/40 px-2 py-1.5 text-[11px] text-destructive">
            <p className="break-words">
              Project commands unavailable: {nav.commandsError}
            </p>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-[11px]"
              onClick={nav.reloadCommands}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {filteredCommands.length > 0 ? (
          <div
            id={`${pickerId}-list`}
            role="listbox"
            aria-label="Slash commands"
            className="space-y-0.5"
          >
            {filteredCommands.map((command, index) => (
              <Button
                key={command.id}
                id={`${pickerId}-option-${index}`}
                type="button"
                variant="ghost"
                role="option"
                tabIndex={-1}
                aria-selected={index === activeCommandIndex}
                onMouseEnter={() => setCommandIndex(index)}
                onClick={() => void activateSlashCommand(command)}
                className={
                  index === activeCommandIndex
                    ? "h-auto min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-md bg-muted px-2 py-1.5 text-start font-normal"
                    : "h-auto min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-md px-2 py-1.5 text-start font-normal"
                }
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[12px] font-medium">
                    /{command.name}
                  </span>
                  {command.aliases.length > 0 ? (
                    <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                      {command.aliases.map((alias) => `/${alias}`).join(" ")}
                    </span>
                  ) : null}
                  <span className="ms-auto shrink-0 text-[10px] text-muted-foreground">
                    {command.source === "server"
                      ? command.category
                      : command.status === "supported"
                        ? command.category
                        : command.status === "partial"
                          ? "Partial"
                          : "Unavailable"}
                  </span>
                </span>
                <span className="w-full truncate text-[12px] font-medium">
                  {command.title}
                </span>
                <span className="line-clamp-2 w-full text-[11px] text-muted-foreground">
                  {command.description}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="space-y-1 px-2 py-1">
            <p className="text-[12px] text-muted-foreground">
              No matching command.
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full justify-start text-left text-[12px]"
              onClick={() => {
                setCommandPickerDismissed(true)
                focusComposer()
                void submit(responding ? "steer" : null)
              }}
            >
              Send “{draft}” as a literal message
            </Button>
          </div>
        )}
        <p className="px-2 pt-1 text-[10px] text-muted-foreground">
          ↑/↓ navigate · Enter/Tab select · Esc close · mobile: activate item or Send
        </p>
      </PopoverContent>
      </Popover>
      <SessionCommandDialogs
        kind={sessionDialog}
        nav={nav}
        initialText={sessionDialogText}
        onClose={() => {
          setSessionDialog(null)
          setSessionDialogText("")
          focusComposer()
        }}
        onResult={(text, ok = true) => {
          setCommandFeedback({ tone: ok ? "status" : "error", text })
        }}
        onApplyDraft={(text) => setDraft(text)}
        onRestoreDraft={(text) => setDraft(text)}
        selectedSkills={selectedSkills}
        onApplySkills={applySkills}
      />
      <IntegrationCommandDialogs
        kind={integrationDialog}
        nav={nav}
        onClose={() => {
          setIntegrationDialog(null)
          focusComposer()
        }}
        onResult={(text, ok = true) => {
          setCommandFeedback({ tone: ok ? "status" : "error", text })
        }}
      />
      {btwQuestion !== null ? (
        <BtwDialog
          nav={nav}
          initialQuestion={btwQuestion}
          onClose={() => {
            setBtwQuestion(null)
            focusComposer()
          }}
          onResult={(text, ok = true) => {
            setCommandFeedback({ tone: ok ? "status" : "error", text })
          }}
        />
      ) : null}
    </div>
  )
}
