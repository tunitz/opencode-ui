import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  CopyIcon,
  DownloadIcon,
  FolderInputIcon,
  GitForkIcon,
  LoaderCircleIcon,
  Redo2Icon,
  SearchIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { copyText } from "@/lib/clipboard"
import { fixedDesktopSettingsStyle, fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import { useIsDesktop } from "@/lib/use-is-desktop"
import { errorMessage, openCode } from "@/lib/opencode"
import { cn } from "@/lib/utils"
import type {
  PromptSkillAttachment,
  SessionInfo,
  SessionMessageUser,
  SessionTransferData,
  SkillInfo,
} from "@/lib/opencode"
import {
  findUndoBoundary,
  formatByteSize,
  previewRevert,
  resolveSessionDirectory,
  sessionExportFilename,
  timelineTime,
} from "@/lib/session-commands"
import {
  formatMarkdownTranscript,
  nativeJsonTranscript,
} from "@/lib/session-export"
import type { OpenCodeController } from "@/lib/use-opencode"

export type SessionCommandDialogKind =
  | "rename"
  | "timeline"
  | "export"
  | "fork"
  | "compact"
  | "undo"
  | "redo"
  | "cd"
  | "editor"
  | "skills"

type DialogProps = {
  nav: OpenCodeController
  initialText?: string
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
  onApplyDraft?: (text: string) => void
  onRestoreDraft?: (text: string) => void
  selectedSkills?: readonly PromptSkillAttachment[]
  onApplySkills?: (skills: readonly { id: string; name: string }[]) => void
}

export function CommandDialogShell({
  title,
  description,
  pending,
  onClose,
  footer,
  children,
  initialFocusContent = false,
  contentClassName,
  bodyClassName,
}: {
  title: string
  description: string
  pending?: boolean
  onClose: () => void
  footer: ReactNode
  children: ReactNode
  /** Focus the scrollable content instead of the first control (e.g. a text
   *  input that would open its options list and the mobile keyboard). */
  initialFocusContent?: boolean
  contentClassName?: string
  bodyClassName?: string
}) {
  const isDesktop = useIsDesktop()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const initialFocus = initialFocusContent ? contentRef : undefined
  const content = (
    <>
      <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pe-12">
        {isDesktop ? <DialogTitle className="text-[17px] font-semibold tracking-tight">{title}</DialogTitle> : <SheetTitle className="text-[17px] font-semibold tracking-tight">{title}</SheetTitle>}
        {isDesktop ? <DialogDescription className="text-[12px]">{description}</DialogDescription> : <SheetDescription className="text-[12px]">{description}</SheetDescription>}
      </DialogHeader>
      <div ref={contentRef} tabIndex={-1} className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none", bodyClassName)}>{children}</div>
      <DialogFooter className="mx-0 mb-0 shrink-0 flex-row flex-wrap justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {footer}
      </DialogFooter>
    </>
  )
  const onOpenChange = (open: boolean) => {
    if (!open && !pending) onClose()
  }
  return isDesktop ? (
    <Dialog
      open
      onOpenChange={onOpenChange}
    >
      <DialogContent
        showCloseButton={!pending}
        className={cn(
          "flex w-[min(44rem,92vw)] flex-col gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-none",
          contentClassName
        )}
        style={fixedDesktopSettingsStyle()}
        {...(initialFocus ? { initialFocus } : {})}
      >
        {content}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={!pending} className={cn("gap-0 overflow-x-hidden overflow-y-auto rounded-t-xl p-0", contentClassName)} style={fixedMobileDrawerStyle()} {...(initialFocus ? { initialFocus } : {})}>
        {content}
      </SheetContent>
    </Sheet>
  )
}

export function ErrorNotice({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="mt-2 text-xs break-words text-destructive">
      {error}
    </p>
  )
}

function RenameDialog({ nav, onClose, onResult }: DialogProps) {
  const session = nav.activeSession
  const [title, setTitle] = useState(session?.title ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = title.trim()
  const unchanged = trimmed === (session?.title ?? "").trim()
  // Upstream 2.1.4 generates a title by sending an empty title to the native
  // session update. That endpoint is reachable from the browser, so an empty
  // confirmation is a real request rather than a disabled no-op.
  const canGenerate = Boolean(session) && !trimmed && !pending
  const canSave = Boolean(session) && trimmed.length > 0 && !unchanged && !pending

  async function submit() {
    if (!session || pending) return
    if (!trimmed) {
      if (!canGenerate) return
      setPending(true)
      setError(null)
      try {
        await openCode.session.update({ sessionID: session.id, title: "" })
      } catch (failure) {
        setPending(false)
        setError(errorMessage(failure))
        return
      }
      setPending(false)
      onResult("Requested an engine-generated title; it appears after the engine updates the session.")
      onClose()
      return
    }
    if (!canSave) return
    setPending(true)
    setError(null)
    const failure = await nav.renameSession(session.id, trimmed)
    setPending(false)
    if (failure) {
      setError(failure)
      return
    }
    onResult("Session renamed.")
    onClose()
  }

  return (
    <CommandDialogShell
      title="Rename session"
      description="The current title is prefilled. Clearing it and confirming asks the engine to generate a title. Cancel sends no request."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 px-4"
            disabled={!canSave && !canGenerate}
            aria-busy={pending}
            onClick={() => void submit()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {canGenerate ? "Generate title" : "Save"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="space-y-2"
      >
        <Label htmlFor="command-rename-title" className="sr-only">
          Session name
        </Label>
        <Input
          id="command-rename-title"
          aria-label="Session name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={pending}
          aria-invalid={false}
          className="h-11"
          autoFocus
        />
        {!trimmed ? (
          <p className="text-[11px] text-muted-foreground">
            Empty sends the native title-generation request when you confirm. Cancel leaves the title unchanged.
          </p>
        ) : null}
        <ErrorNotice error={error} />
      </form>
    </CommandDialogShell>
  )
}

function useUserMessagePages(sessionID: string | null) {
  const [items, setItems] = useState<SessionMessageUser[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const request = useRef(0)
  const loadingMoreRef = useRef(false)

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (!sessionID) return
      if (mode === "more" && (!cursor || loadingMoreRef.current)) return
      const token = mode === "reset" ? ++request.current : request.current
      if (mode === "reset") {
        setStatus("loading")
        setItems([])
        setCursor(null)
        setError(null)
      } else {
        loadingMoreRef.current = true
        setLoadingMore(true)
      }

      try {
        const response = await openCode.message.list({
          sessionID,
          type: "user",
          limit: 100,
          ...(mode === "reset" ? { order: "desc" as const } : { cursor: cursor ?? undefined }),
        })
        if (token !== request.current) return
        const page = response.data.filter(
          (message): message is SessionMessageUser => message.type === "user"
        )
        setItems((current) => {
          if (mode === "reset") return page
          const seen = new Set(current.map((message) => message.id))
          return [...current, ...page.filter((message) => !seen.has(message.id))]
        })
        setCursor(response.cursor.next ?? null)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setStatus("error")
        setError(errorMessage(failure))
      } finally {
        if (token === request.current) {
          loadingMoreRef.current = false
          setLoadingMore(false)
        }
      }
    },
    [cursor, sessionID]
  )

  useEffect(() => {
    const token = ++request.current
    void (async () => {
      if (!sessionID) return
      setStatus("loading")
      setItems([])
      setCursor(null)
      setError(null)
      try {
        const response = await openCode.message.list({
          sessionID,
          type: "user",
          limit: 100,
          order: "desc",
        })
        if (token !== request.current) return
        setItems(
          response.data.filter(
            (message): message is SessionMessageUser => message.type === "user"
          )
        )
        setCursor(response.cursor.next ?? null)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setStatus("error")
        setError(errorMessage(failure))
      }
    })()
    return () => {
      request.current += 1
    }
  }, [sessionID])

  return {
    items,
    cursor,
    status,
    error,
    loadingMore,
    loadMore: () => load("more"),
  }
}

function MessagePicker({
  title,
  description,
  session,
  mode,
  onClose,
  onResult,
  onRestoreDraft,
  nav,
}: DialogProps & {
  title: string
  description: string
  session: SessionInfo
  mode: "timeline" | "fork"
}) {
  const { items, cursor, status, error, loadingMore, loadMore } =
    useUserMessagePages(session.id)
  const [query, setQuery] = useState("")
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [restorePrompt, setRestorePrompt] = useState(false)
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return items
    return items.filter((message) =>
      message.text.toLowerCase().includes(normalized)
    )
  }, [items, query])
  const selected =
    items.find((message) => message.id === selectedID) ?? filtered[0] ?? null
  const fullSession = mode === "fork" && selectedID === "full"

  async function confirm() {
    if (pending) return
    if (mode === "timeline") {
      if (!selected) return
      setPending(true)
      setActionError(null)
      const failure = await nav.revealMessage(selected.id)
      setPending(false)
      if (failure) {
        setActionError(failure)
        return
      }
      // Upstream DialogTimeline passes setPrompt into the message action so a
      // durable user message can be placed back into the composer. Offer the
      // same behavior here; it only edits the draft and never sends.
      const restored = restorePrompt && Boolean(onRestoreDraft)
      if (restored) onRestoreDraft?.(selected.text)
      onResult(
        `Jumped to message · ${timelineTime(selected.time.created)}${restored ? " · prompt restored to composer" : ""}`
      )
      onClose()
      return
    }

    setPending(true)
    setActionError(null)
    const failure = await nav.forkSession(fullSession ? undefined : selectedID ?? undefined)
    setPending(false)
    if (failure) {
      setActionError(failure)
      return
    }
    onResult(fullSession ? "Forked the full session." : "Forked before the selected message.")
    onClose()
  }

  return (
    <CommandDialogShell
      title={title}
      description={description}
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 px-4"
            disabled={
              pending ||
              (mode === "timeline"
                ? !selected
                : !fullSession && !selectedID)
            }
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {mode === "timeline" ? "Jump to message" : "Fork session"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {mode === "fork" ? (
          <button
            type="button"
            aria-pressed={fullSession}
            onClick={() => setSelectedID("full")}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 text-start text-[13px] hover:bg-muted/60 aria-pressed:bg-muted"
          >
            <GitForkIcon aria-hidden="true" className="size-4 shrink-0" />
            <span>
              <span className="block font-medium">Full session</span>
              <span className="block text-[11px] text-muted-foreground">
                Copy the complete current history.
              </span>
            </span>
          </button>
        ) : null}
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search loaded user messages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search loaded user messages"
            className="h-11 ps-9"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {items.length} loaded user message{items.length === 1 ? "" : "s"}
          {cursor ? "; older messages are available." : "."} Search covers loaded pages only.
        </p>
        {status === "loading" ? (
          <p role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Loading durable messages…
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="text-xs text-destructive">
            {error}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 ps-1 text-xs"
              onClick={() => void loadMore()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
          {filtered.map((message) => (
            <button
              key={message.id}
              type="button"
              aria-pressed={selected?.id === message.id}
              onClick={() => setSelectedID(message.id)}
              className="flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-1.5 text-start text-[12px] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 whitespace-pre-wrap break-words">
                  {message.text.replace(/\s+/g, " ").trim() || "(no text)"}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                  {timelineTime(message.time.created)} · {message.id}
                </span>
              </span>
            </button>
          ))}
          {status === "ready" && filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No loaded user messages match.
            </p>
          ) : null}
        </div>
        {cursor ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full text-xs"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            Load older messages
          </Button>
        ) : null}
        {mode === "timeline" && selected ? (
          <>
            <div className="rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">Selected message</p>
              <p className="mt-1 max-h-28 overflow-y-auto text-[12px] whitespace-pre-wrap break-words">
                {selected.text}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {selected.id}
              </p>
            </div>
            {onRestoreDraft ? (
              <div className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                <Checkbox
                  id="timeline-restore-prompt"
                  checked={restorePrompt}
                  onCheckedChange={(checked) => setRestorePrompt(checked === true)}
                  disabled={pending}
                />
                <Label
                  htmlFor="timeline-restore-prompt"
                  className="flex-col items-start gap-0.5 text-[12px] font-normal leading-5"
                >
                  <span>Restore message text to composer</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Places the selected prompt in this session&apos;s draft. Nothing is sent.
                  </span>
                </Label>
              </div>
            ) : null}
          </>
        ) : null}
        {mode === "fork" ? (
          <p className="text-[11px] text-muted-foreground">
            Creates a child session from settled history before the boundary. The original
            session and its draft remain; the new fork is selected only after success.
          </p>
        ) : null}
        <ErrorNotice error={actionError} />
      </div>
    </CommandDialogShell>
  )
}

function TimelineDialog({ nav, onClose, onResult }: DialogProps) {
  const session = nav.activeSession
  if (!session) return null
  return (
    <MessagePicker
      nav={nav}
      onClose={onClose}
      onResult={onResult}
      session={session}
      mode="timeline"
      title="Timeline"
      description="Search durable user messages and jump to one. Only loaded pages are searched."
    />
  )
}

function ForkDialog({ nav, onClose, onResult }: DialogProps) {
  const session = nav.activeSession
  if (!session) return null
  return (
    <MessagePicker
      nav={nav}
      onClose={onClose}
      onResult={onResult}
      session={session}
      mode="fork"
      title="Fork session"
      description="Choose the native boundary. Forking does not run a model or change the original."
    />
  )
}

type ExportFormat = "markdown" | "json"

function ExportDialog({ nav, onClose, onResult }: DialogProps) {
  const session = nav.activeSession
  // Upstream 2.1.4 defaults to Markdown and offers a JSON format with a
  // sanitize switch. Native JSON stays byte-for-byte the engine transfer.
  const [format, setFormat] = useState<ExportFormat>("markdown")
  const [sanitize, setSanitize] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [tools, setTools] = useState(true)
  const [data, setData] = useState<SessionTransferData | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)
  const effectiveSanitize = format === "json" && sanitize

  useEffect(() => {
    if (!session) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const exported = await openCode.session.export({
          sessionID: session.id,
          ...(effectiveSanitize ? { sanitize: true } : {}),
        })
        if (token !== request.current) return
        setData(exported)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [reloadKey, effectiveSanitize, session])

  if (!session) return null
  const targetSession = session
  const content = data
    ? format === "json"
      ? nativeJsonTranscript(data)
      : formatMarkdownTranscript(data, { thinking, tools })
    : ""
  const size = data ? new Blob([content]).size : 0
  const filename = sessionExportFilename(targetSession, format)
  const mime =
    format === "json"
      ? "application/json;charset=utf-8"
      : "text/markdown;charset=utf-8"

  async function copy() {
    if (!data || pending) return
    setPending(true)
    setError(null)
    try {
      await copyText(content)
      onResult(`Copied ${format} transcript (${formatByteSize(size)}).`)
      onClose()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  function download() {
    if (!data || pending) return
    setPending(true)
    setError(null)
    try {
      const blob = new Blob([content], { type: mime })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      anchor.rel = "noopener"
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      onResult(`Downloaded ${format} transcript (${formatByteSize(size)}).`)
      onClose()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <CommandDialogShell
      title="Export session"
      description="Export the native session transfer as Markdown or exact JSON. Copy or download only on confirmation."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={!data || status !== "ready" || pending}
            aria-busy={pending}
            onClick={() => void copy()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CopyIcon aria-hidden="true" className="size-4" />
            )}
            Copy
          </Button>
          <Button
            type="button"
            className="h-11 px-4"
            disabled={!data || status !== "ready" || pending}
            aria-busy={pending}
            onClick={download}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <DownloadIcon aria-hidden="true" className="size-4" />
            )}
            Download
          </Button>
        </>
      }
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Preparing native export…
        </p>
      ) : null}
      {status === "error" ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-3 text-xs"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {data ? (
        <div className="space-y-3 text-[12px]">
          <div className="flex flex-wrap gap-2">
            {(["markdown", "json"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={format === option}
                disabled={pending}
                onClick={() => setFormat(option)}
                className="min-h-11 rounded-lg border border-border px-3 text-[12px] hover:bg-muted/60 aria-pressed:bg-muted"
              >
                {option === "markdown" ? "Markdown" : "JSON"}
              </button>
            ))}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Format</dt>
            <dd>{format === "json" ? "Native JSON transcript" : "Markdown transcript"}</dd>
            <dt className="text-muted-foreground">Filename</dt>
            <dd dir="ltr" className="font-mono text-[11px] break-all">
              {filename}
            </dd>
            <dt className="text-muted-foreground">Messages</dt>
            <dd className="tabular-nums">{data.messages.length}</dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="tabular-nums">{formatByteSize(size)}</dd>
          </dl>
          {format === "markdown" ? (
            <div className="space-y-2 rounded-lg border border-border p-2.5">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="export-thinking"
                  checked={thinking}
                  onCheckedChange={(checked) => setThinking(checked === true)}
                  disabled={pending}
                />
                <Label htmlFor="export-thinking" className="text-[12px] font-normal leading-5">
                  Include reasoning
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="export-tools"
                  checked={tools}
                  onCheckedChange={(checked) => setTools(checked === true)}
                  disabled={pending}
                />
                <Label htmlFor="export-tools" className="text-[12px] font-normal leading-5">
                  Include tool calls
                </Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Markdown is rendered locally from the native transfer; it is not a separate engine format.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-border p-2.5">
              <Checkbox
                id="export-sanitize"
                checked={sanitize}
                onCheckedChange={(checked) => setSanitize(checked === true)}
                disabled={pending}
              />
              <Label
                htmlFor="export-sanitize"
                className="flex-col items-start gap-0.5 text-[12px] font-normal leading-5"
              >
                <span>Sanitize export</span>
                <span className="block text-[11px] text-muted-foreground">
                  Passes {"{sanitize: true}"} to the native export. Redacts text, attachments,
                  paths, identifiers, and metadata; not a guarantee that every detail is removed.
                </span>
              </Label>
            </div>
          )}
          <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            Nothing leaves the browser until you choose Copy or Download. The result contains
            session content; store and share it deliberately. Browser object URLs are revoked
            after the download starts.
          </p>
          <ErrorNotice error={error} />
        </div>
      ) : null}
    </CommandDialogShell>
  )
}

function CompactDialog({ nav, onClose, onResult }: DialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(null)
    const failure = await nav.compactSession()
    setPending(false)
    if (failure?.match(/queued/i)) {
      onResult(failure)
      onClose()
    } else if (failure) {
      setError(failure)
    } else {
      onResult("Compaction queued.")
      onClose()
    }
  }

  return (
    <CommandDialogShell
      title="Compact session"
      description="This queues a native compaction request and may run a model request."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 px-4"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            Queue compaction
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[12px]">
        <p>
          Native compaction summarizes the session to reduce context. It is admitted as a
          steer request and runs at the next step boundary, or immediately when idle.
        </p>
        <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
          No model request is sent until you confirm. The backend decides the actual provider
          request, cost, and step boundary.
        </p>
        <ErrorNotice error={error} />
      </div>
    </CommandDialogShell>
  )
}

function UndoDialog({ nav, onClose, onResult, onRestoreDraft }: DialogProps) {
  const session = nav.activeSession
  // Upstream selects the boundary from history before a staged revert.
  const boundary = session
    ? findUndoBoundary(nav.messages, session.revert?.messageID)
    : null
  const preview = boundary ? previewRevert(nav.messages, boundary.id) : null
  const pendingDelivery = boundary
    ? nav.inbox.find((item) => item.type === "user" && item.id === boundary.id) ?? null
    : null
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const staged = Boolean(session?.revert)

  async function confirm() {
    if (!boundary || !session || pending) return
    setPending(true)
    setError(null)
    if (pendingDelivery) {
      // Upstream cancels the pending delivery instead of staging a revert when
      // the target user message has not been delivered yet.
      const failure = await nav.cancelInboxItem(pendingDelivery.id)
      setPending(false)
      if (failure) {
        setError(failure)
        return
      }
      onRestoreDraft?.(boundary.text)
      onResult("Pending message cancelled; its text was restored to the composer.")
      onClose()
      return
    }
    let failure = await nav.interruptSession()
    if (!failure) {
      try {
        await openCode.session.wait({ sessionID: session.id })
      } catch (waitFailure) {
        failure = errorMessage(waitFailure)
      }
    }
    if (!failure) failure = await nav.stageRevert(boundary.id)
    setPending(false)
    if (failure) {
      setError(failure)
      return
    }
    // Snapshot semantics: the prior user prompt is restored into the draft
    // text only; attachments are not reconstructed by this browser adapter.
    onRestoreDraft?.(boundary.text)
    onResult(
      `Undo staged: ${preview?.messages ?? 0} message(s) and ${preview?.files.length ?? 0} file(s) reverted; prompt restored to the composer.`
    )
    onClose()
  }

  return (
    <CommandDialogShell
      title="Undo previous message"
      description={
        pendingDelivery
          ? "The target prompt is still pending. Confirming cancels that delivery and restores its text; no revert is staged."
          : "Interrupts and waits for the session, then stages the native revert. Cancel sends no request."
      }
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 px-4"
            disabled={pending || !boundary || staged}
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {pendingDelivery ? "Cancel pending & restore" : "Undo last message"}
          </Button>
        </>
      }
    >
      {staged ? (
        <div role="alert" className="text-xs text-destructive">
          A revert is already staged. Use /redo to clear it before undoing again.
        </div>
      ) : !boundary || !preview ? (
        <p className="text-xs text-muted-foreground">Nothing to undo.</p>
      ) : (
        <div className="space-y-3 text-[12px]">
          <div className="rounded-lg border border-border p-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">Message to restore</p>
            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">
              {boundary.text}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {boundary.id}
            </p>
          </div>
          {pendingDelivery ? (
            <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              This prompt has a pending delivery. The native engine cancels it instead of
              staging a file revert. Its text returns to the composer; attachments are not
              reconstructed.
            </p>
          ) : (
            <p>
              This will revert the latest user message and {Math.max(0, preview.messages - 1)} later
              message{preview.messages - 1 === 1 ? "" : "s"}; it restores the files recorded by
              later assistant turns. The prompt text returns to the composer. It does not delete
              the session.
            </p>
          )}
          {!pendingDelivery && preview.files.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
              <p className="font-medium text-foreground">
                {preview.files.length} file{preview.files.length === 1 ? "" : "s"} will be
                restored
              </p>
              <ul className="mt-1 space-y-0.5" aria-label="Files affected by undo">
                {preview.files.slice(0, 8).map((file) => (
                  <li key={file} dir="ltr" className="truncate font-mono text-[10px]">
                    {file}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!pendingDelivery && preview.files.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No files were recorded for later assistant turns.
            </p>
          ) : null}
          <ErrorNotice error={error} />
        </div>
      )}
    </CommandDialogShell>
  )
}

function RedoDialog({ nav, onClose, onResult }: DialogProps) {
  const session = nav.activeSession
  const revert = session?.revert
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (pending || !revert) return
    setPending(true)
    setError(null)
    const failure = await nav.clearRevert()
    setPending(false)
    if (failure) {
      setError(failure)
      return
    }
    onResult("Reverted changes restored.")
    onClose()
  }

  return (
    <CommandDialogShell
      title="Redo"
      description="Clears the staged native revert. Cancel sends no request."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 px-4"
            disabled={pending || !revert}
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Redo2Icon aria-hidden="true" className="size-4" />
            )}
            Restore reverted changes
          </Button>
        </>
      }
    >
      {!revert ? (
        <p className="text-xs text-muted-foreground">No staged revert to clear.</p>
      ) : (
        <div className="space-y-3 text-[12px]">
          <p>
            This clears the revert boundary and restores the reverted files and messages. It
            does not delete the session or its draft.
          </p>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
            <p className="font-medium text-foreground">
              {revert.files?.length ?? 0} restored file
              {(revert.files?.length ?? 0) === 1 ? "" : "s"}
            </p>
            {revert.files?.length ? (
              <ul className="mt-1 space-y-0.5" aria-label="Files affected by redo">
                {revert.files.slice(0, 8).map((file) => (
                  <li key={file.file} dir="ltr" className="truncate font-mono text-[10px]">
                    {file.file}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            The native endpoint returns 409 if the session is busy; this dialog only sends one
            request per confirmation.
          </p>
          <ErrorNotice error={error} />
        </div>
      )}
    </CommandDialogShell>
  )
}

function CdDialog({ nav, initialText = "", onClose, onResult }: DialogProps) {
  const session = nav.activeSession
  const [path, setPath] = useState(initialText.trim())
  const [resolved, setResolved] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = session?.location.directory ?? nav.directory
  // Relative paths resolve against the session directory; `~` and `~/…` are
  // expanded by the engine when checked. No browser-side role gating: the
  // native location lookup decides what is reachable.
  const candidate = resolveSessionDirectory(path, current)

  async function check() {
    if (!candidate || checking || pending) return
    setChecking(true)
    setError(null)
    setResolved(null)
    try {
      let target = candidate
      if (path.trim() === "~" || path.trim().startsWith("~/")) {
        const home = await openCode.location.get({ location: { directory: "~" } })
        target = resolveSessionDirectory(path, current, home.directory) ?? candidate
      }
      const location = await openCode.location.get({ location: { directory: target } })
      setResolved(location.directory)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setChecking(false)
    }
  }

  async function confirm() {
    if (!resolved || pending) return
    setPending(true)
    setError(null)
    const failure = await nav.moveSession(resolved)
    setPending(false)
    if (failure) {
      setError(failure)
      return
    }
    onResult(`Session moved to ${resolved}.`)
    onClose()
  }

  return (
    <CommandDialogShell
      title="Change working directory"
      description="Move this session to an existing directory. Absolute paths, paths relative to the session directory, and ~ are accepted. Cancel sends no request."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 px-4"
            disabled={!resolved || pending}
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <FolderInputIcon aria-hidden="true" className="size-4" />
            )}
            Move session
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-[11px] text-muted-foreground">Current directory</p>
          <p dir="ltr" className="mt-0.5 font-mono text-[11px] break-all">
            {current || "No directory"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="command-cd-path">Target directory</Label>
          <Input
            id="command-cd-path"
            aria-label="Target directory"
            value={path}
            onChange={(event) => {
              setPath(event.target.value)
              setResolved(null)
              setError(null)
            }}
            placeholder="/absolute/path, ./relative, or ~/projects"
            dir="ltr"
            className="h-11 font-mono text-[12px]"
            autoFocus
            aria-invalid={Boolean(path) && !candidate}
            disabled={pending || checking}
          />
          {path && !candidate ? (
            <p className="text-xs text-destructive">
              Enter a directory path without line breaks.
            </p>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          The session moves to the requested location; if work is running, the native move is
          steered at the next boundary. The selected project becomes the target project; browser
          defaults and this session&apos;s draft are preserved. Check the directory before moving.
        </p>
        {resolved ? (
          <div className="rounded-lg border border-border bg-muted/30 p-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">Resolved target</p>
            <p dir="ltr" className="mt-0.5 font-mono text-[11px] break-all">
              {resolved}
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full text-xs"
            disabled={!candidate || checking || pending}
            aria-busy={checking}
            onClick={() => void check()}
          >
            {checking ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <SearchIcon aria-hidden="true" className="size-4" />
            )}
            Check directory
          </Button>
        )}
        <ErrorNotice error={error} />
      </div>
    </CommandDialogShell>
  )
}

function EditorDialog({
  initialText = "",
  onClose,
  onResult,
  onApplyDraft,
  onRestoreDraft,
}: DialogProps) {
  const [text, setText] = useState(initialText)
  const applied = useRef(false)
  const textarea = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = textarea.current
      if (!element) return
      element.focus()
      const end = element.value.length
      element.setSelectionRange(end, end)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  function apply() {
    onApplyDraft?.(text)
    applied.current = true
    onResult("Draft updated from the web editor. Attachments were not changed.")
    onClose()
  }

  function cancel() {
    if (!applied.current) onRestoreDraft?.(initialText)
    onClose()
  }

  return (
    <CommandDialogShell
      title="Web draft editor"
      description="A larger browser editor for this draft. It is not your OS editor and never sends."
      onClose={cancel}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button type="button" className="h-11 px-4" onClick={apply}>
            Apply to draft
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="command-editor-draft">Draft text</Label>
        <Textarea
          id="command-editor-draft"
          ref={textarea}
          aria-label="Draft text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write or edit the draft here…"
          className="max-h-[45svh] min-h-48 resize-none text-base leading-6"
        />
        <p className="text-[11px] text-muted-foreground">
          Enter inserts a newline; nothing is sent. Apply updates only this session&apos;s current
          draft, while attachments and the conversation remain unchanged. Cancel restores the
          draft that was present when the editor opened.
        </p>
      </div>
    </CommandDialogShell>
  )
}

function SkillsDialog({
  nav,
  selectedSkills = [],
  onClose,
  onResult,
  onApplySkills,
}: DialogProps) {
  const session = nav.activeSession
  const directory = session?.location.directory ?? null
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectedSkills.map((skill) => skill.id))
  )
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    if (!directory) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const response = await openCode.skill.list({
          location: { directory },
        })
        if (token !== request.current) return
        setSkills(response.data)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [directory, reloadKey])

  if (!session || !directory) return null
  const filtered = skills.filter((skill) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return true
    return (
      skill.name.toLowerCase().includes(normalized) ||
      (skill.description ?? "").toLowerCase().includes(normalized)
    )
  })

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function apply() {
    const chosen = skills
      .filter((skill) => selected.has(skill.id))
      .map((skill) => ({ id: skill.id, name: skill.name }))
    onApplySkills?.(chosen)
    onResult(
      chosen.length === 0
        ? "Cleared selected skills."
        : `${chosen.length} skill${chosen.length === 1 ? "" : "s"} selected for the next Send.`
    )
    onClose()
  }

  return (
    <CommandDialogShell
      title="Skills"
      description="Choose native skills for this session. Nothing is sent until you activate Send."
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" className="h-11 px-4" onClick={apply}>
            Use selected skills
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search skills"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills"
            className="h-11 ps-9"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Catalog for <span dir="ltr" className="font-mono break-all">{directory}</span>. Selection
          applies only to this session&apos;s next explicit Send.
        </p>
        {status === "loading" ? (
          <p role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Loading native skills…
          </p>
        ) : null}
        {status === "error" ? (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-3 text-xs"
              onClick={() => setReloadKey((current) => current + 1)}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {status === "ready" ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {filtered.map((skill) => (
              <li key={skill.id}>
                <Label
                  htmlFor={`skill-${skill.id}`}
                  className="min-h-11 items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-muted/60"
                >
                  <Checkbox
                    id={`skill-${skill.id}`}
                    checked={selected.has(skill.id)}
                    onCheckedChange={() => toggle(skill.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium">{skill.name}</span>
                    {skill.description ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {skill.description}
                      </span>
                    ) : null}
                    <span dir="ltr" className="block truncate font-mono text-[10px] text-muted-foreground">
                      {skill.path}
                    </span>
                  </span>
                </Label>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted-foreground">
                No native skills match.
              </li>
            ) : null}
          </ul>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {selected.size} selected. Skills are sent as native prompt skill attachments; no
          agent/model request starts until you activate Send.
        </p>
      </div>
    </CommandDialogShell>
  )
}

export function SessionCommandDialogs({
  kind,
  nav,
  initialText,
  onClose,
  onResult,
  onApplyDraft,
  onRestoreDraft,
  selectedSkills,
  onApplySkills,
}: {
  kind: SessionCommandDialogKind | null
  nav: OpenCodeController
  initialText?: string
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
  onApplyDraft?: (text: string) => void
  onRestoreDraft?: (text: string) => void
  selectedSkills?: readonly PromptSkillAttachment[]
  onApplySkills?: (skills: readonly { id: string; name: string }[]) => void
}) {
  if (!kind) return null
  const props = {
    nav,
    initialText,
    onClose,
    onResult,
    onApplyDraft,
    onRestoreDraft,
    selectedSkills,
    onApplySkills,
  }
  switch (kind) {
    case "rename":
      return <RenameDialog {...props} />
    case "timeline":
      return <TimelineDialog {...props} />
    case "export":
      return <ExportDialog {...props} />
    case "fork":
      return <ForkDialog {...props} />
    case "compact":
      return <CompactDialog {...props} />
    case "undo":
      return <UndoDialog {...props} />
    case "redo":
      return <RedoDialog {...props} />
    case "cd":
      return <CdDialog {...props} />
    case "editor":
      return <EditorDialog {...props} />
    case "skills":
      return <SkillsDialog {...props} />
  }
}
