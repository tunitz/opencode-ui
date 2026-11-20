import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  QuoteIcon,
  SearchIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"

import { prefersReducedMotion } from "@/lib/accessibility"
import { copyText } from "@/lib/clipboard"
import { Markdown } from "@/components/markdown"
import { MessageFiles } from "@/components/message-files"
import { ToolArtifacts } from "@/components/tool-artifacts"
import { ProjectArtifacts } from "@/components/project-artifacts"
import { finalProjectArtifactMessages } from "@/lib/project-artifacts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Marker, MarkerContent } from "@/components/ui/marker"
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  buildConversationRows,
  type ConversationRow,
} from "@/lib/message-history"
import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionRevert,
  ToolFileContent,
} from "@/lib/opencode"
import {
  deliveryCaption,
  projectLiveRun,
  type LiveItem,
  type LiveRun,
  type LiveTool,
} from "@/lib/session-events"
import type { ConnectionStatus, LoadStatus, StreamStatus } from "@/lib/use-opencode"
import {
  artifactSignature,
  toolArtifactsFromContent,
  toolFilesFromContent,
} from "@/lib/tool-artifacts"
import { formatDurationMs } from "@/lib/context-usage"
import { cn } from "@/lib/utils"
import { recordPerfRender } from "@/lib/perf-probe"
import { useLiveRun } from "@/lib/use-live-run"
import { structuredErrorMessage } from "@/lib/structured-error"
import { fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import { useIsDesktop } from "@/lib/use-is-desktop"
import { toolCallSummary, toolInputDetail, toolTextOutput } from "@/lib/tool-details"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { messageText } from "@/lib/command-search"
import { useToolVisibility } from "@/lib/use-tool-visibility"
import {
  shouldHideIntermediateText,
  visibleConversationTools,
  type ToolVisibilityMode,
} from "@/lib/tool-visibility"
import { useKeybindings } from "@/lib/use-keybindings"
import { matchesKeybinding } from "@/lib/keybindings"
import {
  toCheckpointView,
  toReasoningLine,
  toTraceLine,
  toolLabel,
  traceValue,
} from "@/lib/shadcn-ai"

type ToolLike = {
  id: string
  name: string | null
  status: "running" | "completed" | "error"
  error?: string | null
  input?: Record<string, unknown>
  output?: string
  files: ToolFileContent[]
}

/** Ghost icon action wrapped in a tooltip; always a 44px touch target. */
function RowAction({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={title}
            disabled={disabled}
            onClick={onClick}
            className="size-11 shrink-0 p-0"
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function CopyMessageAction({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!copied && !failed) return
    const timer = window.setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [copied, failed])
  return (
    <>
      <RowAction
        label={copied ? "Copied" : failed ? "Copy failed" : "Copy message"}
        title={
          failed
            ? "Could not copy — select the message and copy manually"
            : undefined
        }
        icon={
          copied ? (
            <CheckIcon aria-hidden="true" className="size-4" />
          ) : (
            <CopyIcon aria-hidden="true" className="size-4" />
          )
        }
        onClick={() => {
          void copyText(value).then(
            () => {
              setFailed(false)
              setCopied(true)
            },
            () => {
              setCopied(false)
              setFailed(true)
            }
          )
        }}
      />
      <span aria-live="polite" className="sr-only">
        {copied
          ? "Copied"
          : failed
            ? "Could not copy. Select the message and copy manually."
            : ""}
      </span>
    </>
  )
}

/**
 * A transcript row is a MessageScrollerItem: the primitive owns measurement,
 * anchoring and visibility, while the data attributes stay on the same wrapper
 * so find/disclosure/focus behavior keeps working.
 */
function ConversationItem({
  messageId,
  author,
  scrollAnchor = false,
  children,
}: {
  messageId: string
  author: "You" | "Assistant"
  scrollAnchor?: boolean
  children: ReactNode
}) {
  const findMatches = useContext(FindMatchContext)
  const highlighted = findMatches?.has(messageId) === true
  return (
    <MessageScrollerItem
      messageId={messageId}
      scrollAnchor={scrollAnchor}
      data-author={author === "Assistant" ? "assistant" : "user"}
      data-find-match={highlighted ? "" : undefined}
      tabIndex={-1}
      className={cn(
        "min-w-0 rounded-lg outline-none [content-visibility:visible] focus-visible:ring-2 focus-visible:ring-ring/50",
        highlighted && "bg-primary/10 ring-1 ring-primary/50"
      )}
    >
      <span className="sr-only">{author}:</span>
      {children}
    </MessageScrollerItem>
  )
}

const UserMessage = memo(function UserMessage({
  message,
  onEditFromHere,
}: {
  message: SessionMessageUser
  onEditFromHere?: (message: SessionMessageUser) => void
}) {
  const files = (message.files ?? []).map((file) => ({
    name: file.name ?? null,
    mime: file.mime,
    dataUrl: `data:${file.mime};base64,${file.data}`,
  }))

  if (!message.text.trim() && files.length === 0) {
    return null
  }

  return (
    <ConversationItem messageId={message.id} author="You" scrollAnchor>
      <Message align="end">
        <MessageContent>
          <MessageFiles files={files} />
          {message.text.trim() ? (
            <Bubble variant="secondary" align="end" className="max-w-[85%]">
              <BubbleContent dir="auto" className="rounded-2xl px-4 py-2.5 text-base leading-6 break-words whitespace-pre-wrap">
                {message.text}
              </BubbleContent>
            </Bubble>
          ) : null}
          <MessageFooter className="gap-0.5 px-0">
            {message.text.trim() ? <CopyMessageAction value={message.text} /> : null}
            {onEditFromHere ? (
              <RowAction
                label="Edit from here"
                icon={<PencilLineIcon aria-hidden="true" className="size-4" />}
                onClick={() => onEditFromHere(message)}
              />
            ) : null}
          </MessageFooter>
        </MessageContent>
      </Message>
    </ConversationItem>
  )
})

const MOBILE_TOOL_DETAIL_LIMIT = 240
const ToolDetailRowContext = createContext<string | null>(null)
const ToolDetailPinContext = createContext<(key: string | null) => void>(() => {})

const ToolVisibilityContext = createContext<{
  mode: ToolVisibilityMode
  runActive: boolean
  findOpen: boolean
}>({ mode: "all", runActive: false, findOpen: false })
const ToolDiffContext = createContext<(file?: string) => void>(() => {})
const FindMatchContext = createContext<ReadonlySet<string> | null>(null)

function ToolErrorDetails({ error, name }: { error: string; name: string }) {
  const isDesktop = useIsDesktop()
  const rowKey = useContext(ToolDetailRowContext)
  const pinRow = useContext(ToolDetailPinContext)
  const ownsPin = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [sheetActive, setSheetActive] = useState(false)
  // Rotation or a shorter live error must not unmount a sheet under its reader.
  const showMobileSheet = sheetActive || (!isDesktop && error.length > MOBILE_TOOL_DETAIL_LIMIT)
  useEffect(() => () => {
    if (ownsPin.current) pinRow(null)
  }, [pinRow])
  if (!showMobileSheet) {
    return <p dir="auto" className="mt-1 break-words whitespace-pre-wrap text-destructive">{error}</p>
  }
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1">
      <p dir="auto" className="break-words whitespace-pre-wrap text-destructive">{error.slice(0, MOBILE_TOOL_DETAIL_LIMIT)}…</p>
      <Sheet onOpenChange={(open) => {
        if (open) {
          setSheetActive(true)
          if (rowKey) { ownsPin.current = true; pinRow(rowKey) }
        }
      }} onOpenChangeComplete={(open) => {
        if (!open && ownsPin.current) {
          const focusTarget = isDesktop || error.length <= MOBILE_TOOL_DETAIL_LIMIT
            ? triggerRef.current?.closest('[data-slot="trace-collapsible"]')?.querySelector<HTMLElement>('[data-slot="trace-collapsible-trigger"]')
            : triggerRef.current
          focusTarget?.focus()
          ownsPin.current = false
          pinRow(null)
        }
        if (!open) setSheetActive(false)
      }}>
        <SheetTrigger render={<Button ref={triggerRef} type="button" variant="outline" className="min-h-11 self-start" aria-label={`View full error for ${name}`} />}>
          View full error
        </SheetTrigger>
        <SheetContent side="bottom" style={fixedMobileDrawerStyle()} className="gap-0 overflow-hidden rounded-t-xl bg-card p-0">
          <SheetHeader className="shrink-0 pe-14">
            <SheetTitle>Tool error details</SheetTitle>
            <SheetDescription dir="auto">{traceValue(name, 80) ?? "Tool"}</SheetDescription>
          </SheetHeader>
          <div role="region" aria-label="Full tool error" tabIndex={0} dir="auto" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 text-sm break-words whitespace-pre-wrap text-destructive focus-visible:outline-2 focus-visible:outline-ring">{error}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function ToolTrace({
  tools: allTools,
  open,
  onOpenChange,
}: {
  tools: ToolLike[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const visibility = useContext(ToolVisibilityContext)
  const tools = visibleConversationTools(
    allTools,
    visibility.mode,
    visibility.runActive,
    visibility.findOpen
  )
  const running = tools.some((tool) => tool.status === "running")
  const failed = tools.some((tool) => tool.status === "error")
  const status = failed ? "error" : running ? "running" : "completed"
  const name = tools[0] ? toolLabel(tools[0]) : "tool unknown"
  const summary = tools.length === 1 ? toolCallSummary(tools[0].name, tools[0].input) : undefined
  const title =
    tools.length === 1
      ? `1 tool call: ${name}${summary ? ` · ${summary}` : ""}`
      : `${tools.length} tool calls: ${tools.map((tool) => toolLabel(tool)).join(", ")}`

  if (tools.length === 0) {
    return null
  }

  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger className="min-h-11 rounded-lg px-1.5">
          <TraceLine
            status={failed ? "error" : running ? "running" : undefined}
          >
            <TraceIcon>
              {failed ? (
                <CircleAlertIcon aria-hidden="true" />
              ) : running ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <WrenchIcon aria-hidden="true" />
              )}
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
            <TraceDescription>{status}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ul className="flex min-w-0 flex-col gap-1.5">
            {tools.map((tool) => {
              const summary = toolCallSummary(tool.name, tool.input)
              // The mapper maps SDK statuses to "running" | "error" | undefined.
              const line = toTraceLine(tool, tool.status === "running")
              return (
              <li
                key={tool.id}
                className="min-w-0 text-[13px]"
              >
                <Collapsible>
                  <CollapsibleTrigger className="group/tool flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md text-start focus-visible:outline-2 focus-visible:outline-ring">
                    <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-aria-expanded/tool:rotate-90 motion-reduce:transition-none" />
                    <TraceLine status={line.status} className="min-w-0 flex-1">
                      <TraceIcon>
                        <WrenchIcon aria-hidden="true" />
                      </TraceIcon>
                      <TraceTitle className="font-mono">{traceValue(tool.name, 80) ?? `tool ${tool.id}`}</TraceTitle>
                      {summary ? <TraceDescription className="truncate font-mono text-xs">{summary}</TraceDescription> : null}
                    </TraceLine>
                    <span className={cn("shrink-0 text-xs text-muted-foreground", line.status === "error" && "text-destructive")}>
                      {line.status === "error" ? "error" : line.status === "running" ? "running" : "completed"}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-w-0 ps-6">
                    <ToolCallDetails tool={tool} />
                  </CollapsibleContent>
                </Collapsible>
              </li>
              )
            })}
          </ul>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function ToolCallDetails({ tool }: { tool: ToolLike }) {
  const input = toolInputDetail(tool.input)
  const openDiff = useContext(ToolDiffContext)
  const candidate =
    tool.input?.filePath ?? tool.input?.path ?? tool.input?.file
  const fileChangeTool =
    tool.files.length > 0 ||
    Boolean(tool.name && /(?:write|edit|patch|apply|create_file)/i.test(tool.name))
  const changedFiles =
    fileChangeTool && typeof candidate === "string" && candidate.trim()
      ? [candidate]
      : []
  return <>
    {input !== undefined ? <ToolDetail label="Input" text={input} /> : null}
    {tool.output !== undefined ? (
      <ToolDetail label="Output" text={tool.output} />
    ) : null}
    {tool.status === "completed" && changedFiles.length > 0 ? (
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-11 px-3 text-xs"
        onClick={() => openDiff(changedFiles[0])}
      >
        Open turn diff
      </Button>
    ) : null}
    {tool.status === "error" && tool.error ? <ToolErrorDetails error={tool.error} name={toolLabel(tool)} /> : null}
  </>
}

function ToolDetail({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-2 min-w-0">
      <div className="text-xs font-medium">{label}</div>
      <CodeBlock size="sm" className="mt-1">
        <CodeBlockContent wrap aria-label={label} className="max-h-64">
          {text}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}

function ReasoningTrace({
  text,
  durationMs,
  streaming,
  open,
  onOpenChange,
}: {
  text: string
  durationMs?: number | null
  streaming?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const line = toReasoningLine(text, Boolean(streaming))
  const description =
    durationMs !== null && durationMs !== undefined
      ? formatDurationMs(durationMs)
      : line.description ?? null

  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger className="min-h-11 rounded-lg px-1.5">
          <TraceLine status={line.status}>
            <TraceIcon>
              <BrainIcon aria-hidden="true" />
            </TraceIcon>
            <TraceTitle>{line.title}</TraceTitle>
            {description ? (
              <TraceDescription>{description}</TraceDescription>
            ) : null}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div
            role="region"
            aria-label="Thought process"
            tabIndex={0}
            dir="auto"
            className="max-h-64 overflow-y-auto overscroll-contain pe-1 text-[13px] leading-relaxed whitespace-pre-wrap break-words scrollbar-thin outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {text}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function ResponseError({
  message,
  className,
}: {
  message: string
  className?: string
}) {
  return (
    <Alert variant="destructive" className={cn("px-3 py-2.5", className)}>
      <AlertTitle dir="auto">Response failed</AlertTitle>
      <AlertDescription dir="auto" className="break-words whitespace-pre-wrap text-xs leading-5">
        {message}
      </AlertDescription>
    </Alert>
  )
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  sessionKey,
  projectAttachments,
  streamStatus,
  expandedToolGroups,
  onToolOpenChange,
  expandedReasoningGroups,
  onReasoningOpenChange,
}: {
  message: SessionMessageAssistant
  sessionKey: string | null
  projectAttachments: boolean
  streamStatus: StreamStatus
  expandedToolGroups: Record<string, true>
  onToolOpenChange: (key: string, open: boolean) => void
  expandedReasoningGroups: Record<string, true>
  onReasoningOpenChange: (key: string, open: boolean) => void
}) {
  recordPerfRender("AssistantMessage")
  const groups: Array<
    | { kind: "text"; key: string; text: string }
    | {
        kind: "reasoning"
        key: string
        text: string
        durationMs: number | null
      }
    | { kind: "tools"; key: string; tools: ToolLike[] }
  > = []
  let textParts: string[] = []
  let toolParts: ToolLike[] = []
  let groupIndex = 0

  function flushText() {
    if (textParts.length === 0) {
      return
    }

    groups.push({
      kind: "text",
      key: `text-${groupIndex++}`,
      text: textParts.join("\n\n"),
    })
    textParts = []
  }

  function flushTools() {
    if (toolParts.length === 0) {
      return
    }

    groups.push({
      kind: "tools",
      key: `tools:${message.id}:${toolParts[0]?.id ?? groupIndex++}`,
      tools: toolParts,
    })
    toolParts = []
  }

  for (const part of message.content) {
    if (part.type === "text") {
      flushTools()
      if (part.text.trim()) {
        textParts.push(part.text)
      }
      continue
    }

    if (part.type === "reasoning") {
      flushText()
      flushTools()
      if (part.text.trim()) {
        const completed = part.time?.completed
        const durationMs =
          part.time &&
          typeof completed === "number" &&
          Number.isFinite(completed) &&
          completed >= part.time.created
            ? completed - part.time.created
            : null
        groups.push({
          kind: "reasoning",
          key: `reasoning:${message.id}:${groupIndex++}`,
          text: part.text,
          durationMs,
        })
      }
      continue
    }

    if (part.type === "tool") {
      flushText()
      toolParts.push({
        id: part.id,
        name: part.name,
        status:
          part.state.status === "streaming" ? "running" : part.state.status,
        error:
          part.state.status === "error"
            ? structuredErrorMessage(part.state.error)
            : null,
        input: part.state.status === "streaming" ? undefined : part.state.input,
        output: part.state.status === "completed" || part.state.status === "error" ? toolTextOutput(part.state.content) : undefined,
        files:
          part.state.status === "completed" || part.state.status === "error"
            ? toolFilesFromContent(part.state.content)
            : [],
      })
    }
  }

  flushText()
  flushTools()

  const messageError = structuredErrorMessage(message.error)
  const errorText =
    message.error || message.finish === "error"
      ? (messageError ?? "This response ended with an error.")
      : null

  if (groups.length === 0 && !errorText) {
    return null
  }

  const toolSignatures = new Set<string>()
  for (const group of groups) {
    if (group.kind !== "tools") continue
    for (const tool of group.tools) {
      for (const artifact of toolArtifactsFromContent({
        content: tool.files,
        toolID: tool.id,
        toolName: tool.name,
      })) {
        toolSignatures.add(artifactSignature(artifact))
      }
    }
  }
  const artifactExcludeSignatures = [...toolSignatures]
  const answerText = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")

  return (
    <ConversationItem messageId={message.id} author="Assistant">
      <Message>
        <MessageContent>
          {groups.map((group) => {
            if (group.kind === "text") {
              return (
                <Bubble key={group.key} variant="ghost">
                  <BubbleContent className="message-markdown flex flex-col gap-3.5 p-0 text-base leading-6">
                    <Markdown
                      artifactSessionID={sessionKey}
                      artifactExcludeSignatures={artifactExcludeSignatures}
                    >
                      {group.text}
                    </Markdown>
                  </BubbleContent>
                </Bubble>
              )
            }

            if (group.kind === "reasoning") {
              const key = `${sessionKey ?? "none"}:${group.key}`
              return (
                <ReasoningTrace
                  key={group.key}
                  text={group.text}
                  durationMs={group.durationMs}
                  open={Boolean(expandedReasoningGroups[key])}
                  onOpenChange={(open) => onReasoningOpenChange(key, open)}
                />
              )
            }

            return (
              <div key={group.key} className="flex min-w-0 flex-col gap-1">
                <ToolTrace
                  tools={group.tools}
                  open={Boolean(expandedToolGroups[`${sessionKey ?? "none"}:${group.key}`])}
                  onOpenChange={(open) =>
                    onToolOpenChange(`${sessionKey ?? "none"}:${group.key}`, open)
                  }
                />
                <ToolArtifacts tools={group.tools} />
              </div>
            )
          })}
          {projectAttachments && sessionKey ? <ProjectArtifacts sessionID={sessionKey} messageID={message.id} text={answerText} streamStatus={streamStatus} /> : null}
          {errorText ? (
            <ResponseError
              message={errorText}
              className={groups.length > 0 ? "mt-3" : undefined}
            />
          ) : null}
          {answerText.trim() ? (
            <MessageFooter className="gap-0.5 px-0">
              <CopyMessageAction value={answerText} />
            </MessageFooter>
          ) : null}
        </MessageContent>
      </Message>
    </ConversationItem>
  )
})

function MessageItem({
  message,
  sessionKey,
  projectAttachments,
  streamStatus,
  expandedToolGroups,
  onToolOpenChange,
  expandedReasoningGroups,
  onReasoningOpenChange,
  onEditFromHere,
}: {
  message: SessionMessageInfo
  sessionKey: string | null
  projectAttachments: boolean
  streamStatus: StreamStatus
  expandedToolGroups: Record<string, true>
  onToolOpenChange: (key: string, open: boolean) => void
  expandedReasoningGroups: Record<string, true>
  onReasoningOpenChange: (key: string, open: boolean) => void
  onEditFromHere?: (message: SessionMessageUser) => void
}) {
  if (message.type === "user") {
    return <UserMessage message={message} onEditFromHere={onEditFromHere} />
  }

  if (message.type === "assistant") {
    return (
      <AssistantMessage
        message={message}
        sessionKey={sessionKey}
        projectAttachments={projectAttachments}
        streamStatus={streamStatus}
        expandedToolGroups={expandedToolGroups}
        onToolOpenChange={onToolOpenChange}
        expandedReasoningGroups={expandedReasoningGroups}
        onReasoningOpenChange={onReasoningOpenChange}
      />
    )
  }

  return null
}

export function liveTool(tool: LiveTool): ToolLike {
  return {
    id: tool.id,
    name: tool.name,
    status: tool.status,
    error: tool.error,
    input: tool.input,
    output: tool.output,
    files: tool.files,
  }
}

function LiveUserItem({
  item,
}: {
  item: Extract<LiveItem, { kind: "user" }>
}) {
  const status = deliveryCaption(item)

  return (
    <ConversationItem messageId={`live-user-${item.key}`} author="You" scrollAnchor>
      <Message align="end">
        <MessageContent>
          <MessageFiles files={item.files ?? []} />
          {item.text.trim() ? (
            <Bubble variant="secondary" align="end" className="max-w-[85%]">
              <BubbleContent dir="auto" className="rounded-2xl px-4 py-2.5 text-base leading-6 break-words whitespace-pre-wrap">
                {item.text}
              </BubbleContent>
            </Bubble>
          ) : null}
          {status ? (
            <MessageFooter role="status" className="pe-0 text-xs">
              <bdi>{status}</bdi>
            </MessageFooter>
          ) : null}
        </MessageContent>
      </Message>
    </ConversationItem>
  )
}

function LiveTextItem({
  item,
  sessionKey,
}: {
  item: Extract<LiveItem, { kind: "text" }>
  sessionKey: string | null
}) {
  // Parsing a growing Markdown answer is the dominant cost of a long stream on
  // a slow device. Deferring the text keeps typing/Stop urgent while React
  // batches or skips intermediate parses; the settled text is still shown.
  // MessageScroller's content observer follows the resulting height growth.
  const text = useDeferredValue(item.text)

  return (
    <ConversationItem messageId={`live-${item.key}`} author="Assistant">
      <Message>
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent className="message-markdown flex flex-col gap-3.5 p-0 text-base leading-6">
              <Markdown artifactSessionID={sessionKey} streaming>
                {text}
              </Markdown>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </ConversationItem>
  )
}

function LiveReasoningItem({
  item,
  sessionKey,
  expandedReasoningGroups,
  onReasoningOpenChange,
}: {
  item: Extract<LiveItem, { kind: "reasoning" }>
  sessionKey: string | null
  expandedReasoningGroups: Record<string, true>
  onReasoningOpenChange: (key: string, open: boolean) => void
}) {
  const key = `${sessionKey ?? "none"}:reasoning-${item.key}`

  return (
    <ConversationItem messageId={`live-reasoning-${item.key}`} author="Assistant">
      <Message>
        <MessageContent>
          <ReasoningTrace
            text={item.text}
            streaming={!item.ended}
            open={Boolean(expandedReasoningGroups[key])}
            onOpenChange={(open) => onReasoningOpenChange(key, open)}
          />
        </MessageContent>
      </Message>
    </ConversationItem>
  )
}

/**
 * Tool segments only change when a tool frame arrives. Text tokens rebuild the
 * row list with the same `LiveTool` objects, so comparing those references
 * keeps traces/artifacts from re-rendering for every token.
 */
function sameToolList(a: readonly LiveTool[], b: readonly LiveTool[]): boolean {
  if (a === b) {
    return true
  }

  if (a.length !== b.length) {
    return false
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}

const LiveToolsItem = memo(function LiveToolsItem({
  tools,
  groupKey,
  sessionKey,
  expandedToolGroups,
  onToolOpenChange,
}: {
  tools: LiveTool[]
  groupKey: string
  sessionKey: string | null
  expandedToolGroups: Record<string, true>
  onToolOpenChange: (key: string, open: boolean) => void
}) {
  const key = `${sessionKey ?? "none"}:${groupKey}`
  return (
    <ConversationItem messageId={`live-tools-${tools[0]?.id ?? "group"}`} author="Assistant">
      <Message>
        <MessageContent>
          <ToolTrace
            tools={tools.map(liveTool)}
            open={Boolean(expandedToolGroups[key])}
            onOpenChange={(open) => onToolOpenChange(key, open)}
          />
          <ToolArtifacts tools={tools} />
        </MessageContent>
      </Message>
    </ConversationItem>
  )
}, (previous, next) =>
  previous.groupKey === next.groupKey &&
  previous.sessionKey === next.sessionKey &&
  previous.expandedToolGroups === next.expandedToolGroups &&
  previous.onToolOpenChange === next.onToolOpenChange &&
  sameToolList(previous.tools, next.tools)
)

// Durable rows keep referential identity across live tokens (see
// buildConversationRows), and the context values they read are now memoized,
// so comparing props stops whole messages from re-rendering per token. Context
// updates still propagate through memo, so Find/tool-visibility stay correct.
const RowView = memo(function RowView({
  row,
  sessionKey,
  projectAttachments,
  streamStatus,
  expandedToolGroups,
  onToolOpenChange,
  expandedReasoningGroups,
  onReasoningOpenChange,
  onEditFromHere,
}: {
  row: ConversationRow
  sessionKey: string | null
  projectAttachments: boolean
  streamStatus: StreamStatus
  expandedToolGroups: Record<string, true>
  onToolOpenChange: (key: string, open: boolean) => void
  expandedReasoningGroups: Record<string, true>
  onReasoningOpenChange: (key: string, open: boolean) => void
  onEditFromHere?: (message: SessionMessageUser) => void
}) {
  const visibility = useContext(ToolVisibilityContext)
  if (
    shouldHideIntermediateText(visibility.mode, {
      runActive: visibility.runActive,
      isFinalAnswer: false,
      findOpen: visibility.findOpen,
    }) &&
    (row.kind === "live-text" || row.kind === "live-reasoning" || row.kind === "live-tools")
  ) {
    return null
  }
  switch (row.kind) {
    case "message":
      return (
        <MessageItem
          message={row.message}
          sessionKey={sessionKey}
          projectAttachments={projectAttachments}
          streamStatus={streamStatus}
          expandedToolGroups={expandedToolGroups}
          onToolOpenChange={onToolOpenChange}
          expandedReasoningGroups={expandedReasoningGroups}
          onReasoningOpenChange={onReasoningOpenChange}
          onEditFromHere={onEditFromHere}
        />
      )
    case "live-user":
      return <LiveUserItem item={row.item} />
    case "live-text":
      return <LiveTextItem item={row.item} sessionKey={sessionKey} />
    case "live-reasoning":
      return (
        <LiveReasoningItem
          item={row.item}
          sessionKey={sessionKey}
          expandedReasoningGroups={expandedReasoningGroups}
          onReasoningOpenChange={onReasoningOpenChange}
        />
      )
    case "live-tools":
      return (
        <LiveToolsItem
          tools={row.tools}
          groupKey={row.key}
          sessionKey={sessionKey}
          expandedToolGroups={expandedToolGroups}
          onToolOpenChange={onToolOpenChange}
        />
      )
  }
})

function LiveStatus({
  run,
  streamStatus,
}: {
  run: LiveRun
  streamStatus: StreamStatus
}) {
  const active = run.status === "submitting" || run.status === "running"
  const lost = active && streamStatus !== "ready"

  if (run.status === "failed") {
    return (
      <ResponseError
        message={run.error ?? "The response failed."}
        className="mx-1"
      />
    )
  }

  if (lost) {
    return (
      <p role="alert" className="px-1 text-xs break-words text-destructive">
        <bdi>
          {streamStatus === "lost"
            ? "Event stream lost. Response status is unknown."
            : "Event stream unavailable. Response status is unknown."}
        </bdi>
      </p>
    )
  }

  if (run.status === "interrupted") {
    return (
      <p role="status" className="px-1 text-xs text-muted-foreground">
        <bdi>Response interrupted.</bdi>
      </p>
    )
  }

  if (run.notices.length > 0 && run.status === "notice") {
    return (
      <div role="status" className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
        {run.notices.map((notice) => (
          <p key={notice}>
            <bdi>{notice}</bdi>
          </p>
        ))}
      </div>
    )
  }

  if (run.status === "submitting") {
    return (
      <p role="status" className="px-1 text-xs text-muted-foreground">
        <bdi>Sending message…</bdi>
      </p>
    )
  }

  if (run.status === "running") {
    return (
      <p role="status" className="px-1 text-xs text-muted-foreground">
        <bdi>Responding…</bdi>
      </p>
    )
  }

  return null
}

function ConversationNotice({
  children,
  tone = "default",
}: {
  children: ReactNode
  tone?: "default" | "error"
}) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden px-6 py-10 text-center text-sm">
        {tone === "error" ? (
          <Alert variant="destructive" className="max-w-sm text-start">{children}</Alert>
        ) : (
          <Empty className="border-0 p-0"><EmptyContent>{children}</EmptyContent></Empty>
        )}
      </div>
    </div>
  )
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") {
      return false
    }

    return prefersReducedMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)")
    )
  })

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = () => setReduced(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return reduced
}

/** Bridges the scroller hooks into Conversation, which renders the provider. */
function ScrollerBridge({
  apiRef,
}: {
  apiRef: { current: ReturnType<typeof useMessageScroller> | null }
}) {
  const api = useMessageScroller()
  useEffect(() => {
    apiRef.current = api
  }, [api, apiRef])
  return null
}

export function Conversation({
  sessionKey,
  hasSession,
  connection = "connected",
  connectionError = null,
  onRetryConnection,
  status,
  error,
  messages,
  streamStatus,
  hasOlder,
  loadingOlder,
  olderError,
  serverVersion,
  revert,
  focusMessageID,
  onFocusMessageHandled,
  onRetry,
  onLoadOlder,
  onOpenDiff,
  onStageRevert,
  onClearRevert,
  onRestorePrompt,
}: {
  sessionKey: string | null
  hasSession: boolean
  connection?: ConnectionStatus
  connectionError?: string | null
  onRetryConnection?: () => void
  status: LoadStatus
  error: string | null
  messages: SessionMessageInfo[]
  streamStatus: StreamStatus
  hasOlder: boolean
  loadingOlder: boolean
  olderError: string | null
  serverVersion: string | null
  revert: SessionRevert | null
  focusMessageID: string | null
  onFocusMessageHandled: () => void
  onRetry: () => void
  onLoadOlder: () => Promise<void>
  onOpenDiff?: (path?: string | null) => void
  onStageRevert?: (messageID: string) => Promise<string | null>
  onClearRevert?: () => Promise<string | null>
  onRestorePrompt?: (text: string) => void
}) {
  recordPerfRender("Conversation")
  // Subscribed here, not in the app shell: streaming tokens re-render the
  // conversation only. Status-only consumers use a status subscription.
  const liveRun = useLiveRun(sessionKey)
  const { mode: toolMode } = useToolVisibility(serverVersion)
  const { bindings } = useKeybindings()
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findIndex, setFindIndex] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)
  const [selectionQuote, setSelectionQuote] = useState<string | null>(null)
  const [citationOpen, setCitationOpen] = useState(false)
  const [citationComment, setCitationComment] = useState("")
  const [editTarget, setEditTarget] = useState<SessionMessageUser | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const hadRevertRef = useRef(false)
  const visibleMessages = useMemo(() => {
    if (!revert) return messages
    const boundary = messages.findIndex(
      (message) => message.id === revert.messageID
    )
    return boundary === -1 ? messages : messages.slice(0, boundary)
  }, [messages, revert])
  const live = useMemo(
    () => projectLiveRun(liveRun, visibleMessages),
    [liveRun, visibleMessages]
  )
  const rows = useMemo(
    () => buildConversationRows(visibleMessages, live.items),
    [visibleMessages, live.items]
  )
  const findMatches = useMemo(() => {
    const query = findQuery.trim().toLocaleLowerCase()
    if (!query) return []
    return visibleMessages
      .filter((message) => messageText(message).toLocaleLowerCase().includes(query))
      .map((message) => message.id)
      .slice(0, 200)
  }, [findQuery, visibleMessages])
  const findMatchSet = useMemo(
    () => (findOpen ? new Set(findMatches) : null),
    [findMatches, findOpen]
  )
  const runActive =
    liveRun?.status === "running" || liveRun?.status === "submitting"
  const zenHidesIntermediate = toolMode === "zen" && runActive && !findOpen
  // These providers wrap the whole transcript, and Conversation re-renders on
  // every live token. Stable values keep the context from invalidating every
  // memoized tool row in every message on each token (FindMatchContext and
  // ToolDetailPinContext already pass stable values).
  const toolVisibilityValue = useMemo(
    () => ({ mode: toolMode, runActive, findOpen }),
    [toolMode, runActive, findOpen]
  )
  const openDiff = useCallback(
    (path?: string) => onOpenDiff?.(path ?? null),
    [onOpenDiff]
  )
  const projectAttachmentMessages = useMemo(
    () => finalProjectArtifactMessages(visibleMessages, hasOlder),
    [visibleMessages, hasOlder]
  )
  const [expandedToolGroups, setExpandedToolGroups] = useState<
    Record<string, true>
  >({})
  const handleToolOpenChange = useCallback((key: string, open: boolean) => {
    setExpandedToolGroups((current) => {
      if (open) {
        return current[key] ? current : { ...current, [key]: true }
      }
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])
  const [expandedReasoningGroups, setExpandedReasoningGroups] = useState<
    Record<string, true>
  >({})
  const handleReasoningOpenChange = useCallback(
    (key: string, open: boolean) => {
      setExpandedReasoningGroups((current) => {
        if (open) {
          return current[key] ? current : { ...current, [key]: true }
        }
        if (!current[key]) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    },
    []
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const scrollerApiRef = useRef<ReturnType<typeof useMessageScroller> | null>(null)
  const reducedMotion = useReducedMotion()
  const olderRequestRef = useRef<Promise<void> | null>(null)
  // Kept for ToolErrorDetails: a sheet portaled outside a row must not lose its
  // trigger. Without virtualization every row stays mounted, so this is only a
  // liveness signal for the details component, not a virtualization pin.
  const [, setSheetPinnedRowKey] = useState<string | null>(null)

  // The scroller's generic prepend heuristic over-corrects when the "load older"
  // row also changes. Capture a real visible row instead and restore its exact
  // viewport offset as soon as the older rows are committed.
  const prependAnchorRef = useRef<{
    id: string
    offset: number
    baseCount: number
  } | null>(null)

  const loadOlder = useCallback(() => {
    if (!hasOlder || loadingOlder || olderRequestRef.current) return
    const viewport = viewportRef.current
    if (viewport) {
      const bounds = viewport.getBoundingClientRect()
      const candidates = [
        ...viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
      ]
      const anchorElement =
        candidates.find((element) => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > bounds.top && rect.top < bounds.bottom
        }) ??
        candidates.find((element) => element.getBoundingClientRect().bottom > bounds.top)
      if (anchorElement?.dataset.messageId) {
        prependAnchorRef.current = {
          id: anchorElement.dataset.messageId,
          offset: anchorElement.getBoundingClientRect().top - bounds.top,
          baseCount: rows.length,
        }
      }
    }
    const request = Promise.resolve().then(onLoadOlder)
    olderRequestRef.current = request
    void request.catch(() => {}).finally(() => {
      if (olderRequestRef.current === request) olderRequestRef.current = null
    })
  }, [hasOlder, loadingOlder, onLoadOlder, rows.length])

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current
    if (!anchor || rows.length <= anchor.baseCount) return
    const viewport = viewportRef.current
    if (!viewport) return
    const started = performance.now()
    let frame = 0
    let cancelled = false
    const restore = () => {
      if (cancelled || viewportRef.current !== viewport) return
      const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(anchor.id) : anchor.id.replace(/["\\]/g, "\\$&")
      const element = viewport.querySelector<HTMLElement>(
        `[data-message-id="${escaped}"]`
      )
      if (element) {
        const delta =
          element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          anchor.offset
        if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
          viewport.scrollTop += delta
        }
      }
      if (performance.now() - started < 600) {
        frame = requestAnimationFrame(restore)
      } else {
        prependAnchorRef.current = null
      }
    }
    frame = requestAnimationFrame(restore)
    const cancel = () => {
      cancelled = true
      cancelAnimationFrame(frame)
      prependAnchorRef.current = null
    }
    viewport.addEventListener("wheel", cancel, { once: true, passive: true })
    viewport.addEventListener("touchmove", cancel, { once: true, passive: true })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      viewport.removeEventListener("wheel", cancel)
      viewport.removeEventListener("touchmove", cancel)
    }
  }, [rows])

  // Center a message requested by the parent (inspector "jump to message").
  // MessageScroller owns the scroll geometry; we only focus the row afterwards.
  useEffect(() => {
    if (!focusMessageID) return
    scrollerApiRef.current?.scrollToMessage(focusMessageID, { align: "center" })
    let frame = 0
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(() => {
        const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(focusMessageID) : focusMessageID.replace(/["\\]/g, "\\$&")
        viewportRef.current
          ?.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`)
          ?.focus({ preventScroll: true })
        onFocusMessageHandled()
      })
    }, 120)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [focusMessageID, onFocusMessageHandled])

  // Cmd/Ctrl+F opens in-thread find only when the conversation owns focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      const findBinding = bindings.find((binding) => binding.command === "find.open")
      const platform = navigator.platform.toLowerCase().includes("mac") ? "mac" : "other"
      if (findBinding && matchesKeybinding(event, findBinding, platform)) {
        const active = document.activeElement
        const viewport = viewportRef.current
        if (!viewport) return
        if (active && (active === viewport || viewport.contains(active))) {
          event.preventDefault()
          setFindOpen(true)
          requestAnimationFrame(() => findInputRef.current?.focus())
        }
      }
      if (event.key === "Escape" && findOpen && !citationOpen) {
        // The find input handles its own Escape; this covers focus elsewhere.
        const active = document.activeElement
        if (active instanceof Element && active.closest("[data-find-bar]")) return
        setFindOpen(false)
        setFindQuery("")
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [bindings, citationOpen, findOpen])

  function captureSelection() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionQuote(null)
      return
    }
    const text = selection.toString().trim()
    if (text.length < 3) {
      setSelectionQuote(null)
      return
    }
    const anchor = selection.anchorNode
    const element =
      anchor instanceof Element ? anchor : (anchor?.parentElement ?? null)
    const item = element?.closest<HTMLElement>('[data-message-id][data-author="assistant"]')
    if (!item || !viewportRef.current?.contains(item)) {
      setSelectionQuote(null)
      return
    }
    setSelectionQuote(text.slice(0, 2000))
  }

  function jumpToFindMatch(index: number) {
    if (findMatches.length === 0) return
    const wrapped = (index + findMatches.length) % findMatches.length
    setFindIndex(wrapped)
    const target = findMatches[wrapped]
    // The scroller keeps its own element registry and aligns by message id, so
    // find jumps no longer need virtual-index arithmetic.
    scrollerApiRef.current?.scrollToMessage(target, { align: "center" })
    window.setTimeout(() => {
      const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(target) : target.replace(/["\\]/g, "\\$&")
      viewportRef.current
        ?.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`)
        ?.focus({ preventScroll: true })
    }, 120)
  }

  const startEditFromHere = useCallback(
    async (message: SessionMessageUser) => {
      if (!onStageRevert) return
      hadRevertRef.current = Boolean(revert)
      setEditTarget(message)
      setEditError(null)
      setEditBusy(true)
      const failure = await onStageRevert(message.id)
      setEditError(failure)
      setEditBusy(false)
    },
    [onStageRevert, revert]
  )

  async function finishEdit(keepFiles: boolean) {
    if (!editTarget) return
    setEditBusy(true)
    let failure: string | null = null
    if (keepFiles && onClearRevert) {
      failure = await onClearRevert()
    }
    if (!failure) onRestorePrompt?.(editTarget.text)
    setEditBusy(false)
    if (failure) {
      setEditError(failure)
      return
    }
    setEditTarget(null)
  }

  async function cancelEdit() {
    // A preview staged by this dialog must not silently change the working
    // tree. A revert that predated the dialog is left untouched.
    if (!hadRevertRef.current && onClearRevert) {
      await onClearRevert()
    }
    setEditTarget(null)
    setEditError(null)
  }

  function insertCitation() {
    if (!selectionQuote || !sessionKey) return
    const quoted = selectionQuote
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n> ")
    const comment = citationComment.trim()
    const text = `> ${quoted}\n>\n> — Assistant${comment ? `\n\n${comment}` : ""}`
    window.dispatchEvent(
      new CustomEvent("composer-citation", {
        detail: { sessionID: sessionKey, text, quote: selectionQuote },
      })
    )
    setCitationOpen(false)
    setCitationComment("")
    setSelectionQuote(null)
    window.getSelection()?.removeAllRanges()
  }

  // Keep the current find result visible when the query or row set changes.
  // Deferred so the imperative scroller jump does not set state inside the
  // effect body; its cleanup also prevents a stale jump on a fast retype.
  useEffect(() => {
    if (!findOpen || findMatches.length === 0) return
    const frame = requestAnimationFrame(() => {
      jumpToFindMatch(Math.min(findIndex, findMatches.length - 1))
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpToFindMatch is intentionally ephemeral
  }, [findOpen, findMatches.length, findQuery])

  if (!hasSession) {
    if (connection === "offline") {
      return (
        <ConversationNotice tone="error">
          <AlertTitle>OpenCode engine is unreachable</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p className="break-words">
              {connectionError
                ? `Could not connect to the OpenCode engine (${connectionError}). Check that the engine is running and try again.`
                : "Could not connect to the OpenCode engine. Check that the engine is running and try again."}
            </p>
            {onRetryConnection ? (
              <Button variant="outline" onClick={onRetryConnection} className="h-11 px-4">
                Retry connection
              </Button>
            ) : null}
          </AlertDescription>
        </ConversationNotice>
      )
    }
    return (
      <ConversationNotice>
        <EmptyTitle>No session selected</EmptyTitle>
        <EmptyDescription>Select a session to view its history.</EmptyDescription>
      </ConversationNotice>
    )
  }

  if (status === "loading" && rows.length === 0 && !liveRun) {
    return (
      <ConversationNotice>
        <p role="status" className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          Loading history…
          <Skeleton className="h-2 w-40" />
        </p>
      </ConversationNotice>
    )
  }

  if (status === "error") {
    return (
      <ConversationNotice tone="error">
        <AlertTitle>Could not load history</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p className="break-words">{error ?? "Could not load history."}</p>
          <Button variant="outline" onClick={onRetry} className="h-11 px-4">
            Retry history
          </Button>
        </AlertDescription>
      </ConversationNotice>
    )
  }

  if (rows.length === 0 && !liveRun && !revert && !hasOlder && !loadingOlder && !olderError) {
    return (
      <ConversationNotice>
        <EmptyTitle>No messages yet</EmptyTitle>
        <EmptyDescription>Send a message to start the conversation.</EmptyDescription>
      </ConversationNotice>
    )
  }

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={64}
    >
      <ScrollerBridge apiRef={scrollerApiRef} />
      <ToolDetailPinContext.Provider value={setSheetPinnedRowKey}>
      <ToolVisibilityContext.Provider value={toolVisibilityValue}>
      <ToolDiffContext.Provider value={openDiff}>
      <FindMatchContext.Provider value={findMatchSet}>
      <div className="relative min-h-0 flex-1">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport
            ref={viewportRef}
            preserveScrollOnPrepend={false}
            aria-label="Conversation"
            role="region"
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
            className="safe-horizontal"
          >
            <MessageScrollerContent className="px-0 py-5 md:px-0">
              {/* These two rows stay mounted (hidden when idle) so the scroller's
                  first DOM child is stable when older history is prepended. */}
              <MessageScrollerItem
                messageId="loading-history"
                className={cn(
                  "[content-visibility:visible]",
                  !(status === "loading" && rows.length > 0) && "hidden"
                )}
              >
                <p role="status" className="mx-1 flex items-center justify-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-center text-xs text-muted-foreground shadow-sm backdrop-blur">
                  <Skeleton className="size-3 rounded-full" />
                  Loading history…
                </p>
              </MessageScrollerItem>
              <MessageScrollerItem
                messageId="load-older"
                className={cn(
                  "[content-visibility:visible] py-2 text-center",
                  !(olderError || loadingOlder || hasOlder) && "hidden"
                )}
              >
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingOlder || !hasOlder}
                    onClick={loadOlder}
                    className="min-h-11 px-4"
                  >
                    {loadingOlder
                      ? "Loading older messages…"
                      : olderError
                        ? "Retry older messages"
                        : "Load older messages"}
                  </Button>
                  {olderError ? (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {olderError}
                    </p>
                  ) : null}
              </MessageScrollerItem>
              {rows.map((row) => (
                <ToolDetailRowContext.Provider key={row.key} value={row.key}>
                  <RowView
                    row={row}
                    sessionKey={sessionKey}
                    projectAttachments={row.kind === "message" && projectAttachmentMessages.has(row.message.id)}
                    streamStatus={streamStatus}
                    expandedToolGroups={expandedToolGroups}
                    onToolOpenChange={handleToolOpenChange}
                    expandedReasoningGroups={expandedReasoningGroups}
                    onReasoningOpenChange={handleReasoningOpenChange}
                    onEditFromHere={startEditFromHere}
                  />
                </ToolDetailRowContext.Provider>
              ))}
              {revert ? (
                <MessageScrollerItem messageId="revert-status" className="[content-visibility:visible]">
                  <div
                    role="status"
                    aria-live="polite"
                    className="mx-1 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
                  >
                    <Marker variant="separator">
                      <MarkerContent>
                        {visibleMessages.length === messages.length
                          ? "Revert staged"
                          : `${messages.length - visibleMessages.length} message${messages.length - visibleMessages.length === 1 ? "" : "s"} reverted`}
                      </MarkerContent>
                    </Marker>
                    <p>
                      {revert.files?.length
                        ? `${revert.files.length} file${revert.files.length === 1 ? "" : "s"} restored by the native revert.`
                        : "No file changes were recorded for this revert."}
                    </p>
                    {revert.files?.length ? (
                      <ul className="flex flex-col gap-0.5" aria-label="Restored files">
                        {revert.files.slice(0, 5).map((file) => (
                          <li key={file.file} dir="ltr" className="truncate font-mono text-[10px]">
                            {file.file}
                            {file.additions > 0 || file.deletions > 0
                              ? ` (+${file.additions}/−${file.deletions})`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p>Use /redo to clear the staged revert and restore the messages/files.</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 self-start px-3"
                        onClick={() => {
                          scrollerApiRef.current?.scrollToMessage(revert.messageID, { align: "center" })
                          const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(revert.messageID) : revert.messageID.replace(/["\\]/g, "\\$&")
                          viewportRef.current
                            ?.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`)
                            ?.focus({ preventScroll: true })
                        }}
                      >
                        {toCheckpointView({
                          id: revert.messageID,
                          role: visibleMessages.find((message) => message.id === revert.messageID)?.type,
                        }).label}
                      </Button>
                    </div>
                  </div>
                </MessageScrollerItem>
              ) : null}
              {zenHidesIntermediate ? (
                <MessageScrollerItem messageId="zen-notice" className="[content-visibility:visible]">
                  <div
                    role="status"
                    className="mx-1 my-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <Marker>
                      <MarkerContent>Zen mode</MarkerContent>
                    </Marker>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>Zen hides intermediate text and tools while the turn runs.</span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 px-3 text-xs"
                        onClick={() => {
                          setFindOpen(true)
                          requestAnimationFrame(() => findInputRef.current?.focus())
                        }}
                      >
                        Reveal with Find
                      </Button>
                    </div>
                  </div>
                </MessageScrollerItem>
              ) : null}
              {liveRun ? (
                <MessageScrollerItem messageId="live-status" className="[content-visibility:visible]">
                  <div className="flex flex-col gap-2 py-3">
                    {liveRun.notices.length > 0 && liveRun.status !== "notice" ? (
                      <div role="status" className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
                        {liveRun.notices.map((notice) => (
                          <p key={notice}>
                            <bdi>{notice}</bdi>
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <LiveStatus run={liveRun} streamStatus={streamStatus} />
                  </div>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton
            behavior={reducedMotion ? "auto" : "smooth"}
            className="size-11 rounded-full"
          />
          {findOpen ? (
            <div
              data-find-bar
              className="absolute inset-x-2 top-2 z-30 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
            >
              <SearchIcon aria-hidden="true" className="ms-1 size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={findInputRef}
                value={findQuery}
                onChange={(event) => {
                  setFindQuery(event.target.value)
                  setFindIndex(0)
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setFindOpen(false)
                    setFindQuery("")
                    viewportRef.current?.focus()
                    return
                  }
                  if (event.key === "Enter") {
                    event.preventDefault()
                    jumpToFindMatch(findIndex + (event.shiftKey ? -1 : 1))
                  }
                }}
                aria-label="Find in conversation"
                placeholder="Find in conversation"
                className="h-11 min-w-0 flex-1 border-0 bg-transparent text-base shadow-none md:text-sm"
              />
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {findQuery.trim()
                  ? `${findMatches.length ? findIndex + 1 : 0}/${findMatches.length}`
                  : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                className="size-11 shrink-0 p-0"
                aria-label="Previous match"
                disabled={findMatches.length === 0}
                onClick={() => jumpToFindMatch(findIndex - 1)}
              >
                <ArrowUpIcon aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="size-11 shrink-0 p-0"
                aria-label="Next match"
                disabled={findMatches.length === 0}
                onClick={() => jumpToFindMatch(findIndex + 1)}
              >
                <ArrowDownIcon aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="size-11 shrink-0 p-0"
                aria-label="Close find"
                onClick={() => {
                  setFindOpen(false)
                  setFindQuery("")
                  viewportRef.current?.focus()
                }}
              >
                <XIcon aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ) : null}
        </MessageScroller>
        {selectionQuote && !citationOpen ? (
          <Button
            type="button"
            variant="secondary"
            className="absolute bottom-16 start-1/2 z-30 h-11 -translate-x-1/2 gap-1.5 rounded-full px-3 text-xs shadow-lg rtl:translate-x-1/2"
            onClick={() => {
              setCitationComment("")
              setCitationOpen(true)
            }}
          >
            <QuoteIcon aria-hidden="true" className="size-4" />
            Cite selection
          </Button>
        ) : null}
        <Dialog open={citationOpen} onOpenChange={setCitationOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add citation</DialogTitle>
              <DialogDescription>
                The quote is inserted into the composer as attributed plain text.
              </DialogDescription>
            </DialogHeader>
            <blockquote
              dir="auto"
              className="max-h-40 overflow-y-auto break-words rounded-lg border-s-2 border-border bg-muted/40 px-3 py-2 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {selectionQuote}
            </blockquote>
            <Textarea
              value={citationComment}
              onChange={(event) => setCitationComment(event.target.value)}
              aria-label="Citation comment"
              placeholder="Optional comment"
              rows={2}
            />
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" onClick={() => setCitationOpen(false)}>
                Cancel
              </Button>
              <Button type="button" className="h-11" onClick={insertCitation}>
                Insert citation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(editTarget)}
          onOpenChange={(open) => {
            if (!open) void cancelEdit()
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit from here</DialogTitle>
              <DialogDescription>
                Staged with the native revert boundary. Confirm before anything is
                kept.
              </DialogDescription>
            </DialogHeader>
            {editTarget ? (
              <>
                <p dir="auto" className="max-h-32 overflow-y-auto break-words rounded-lg bg-muted/50 px-3 py-2 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {editTarget.text}
                </p>
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {editBusy ? (
                    <p role="status" className="flex items-center gap-2">
                      <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
                      Staging native revert preview…
                    </p>
                  ) : revert?.messageID === editTarget.id ? (
                    <p role="status">
                      Preview: {revert.files?.length ?? 0} file
                      {(revert.files?.length ?? 0) === 1 ? "" : "s"} affected by the native revert.
                    </p>
                  ) : (
                    <p role="status">No file effects were reported for this boundary.</p>
                  )}
                  {revert?.files?.length ? (
                    <ul aria-label="Revert preview files" className="max-h-24 overflow-y-auto">
                      {revert.files.slice(0, 8).map((file) => (
                        <li key={file.file} dir="ltr" className="truncate font-mono text-[10px]">
                          {file.file} (+{file.additions}/−{file.deletions})
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {editError ? <p role="alert" className="text-xs text-destructive">{editError}</p> : null}
              </>
            ) : null}
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="h-11" disabled={editBusy} onClick={() => void cancelEdit()}>
                Cancel
              </Button>
              <Button type="button" variant="outline" className="h-11" disabled={editBusy} onClick={() => void finishEdit(true)}>
                Keep files, restore prompt
              </Button>
              <Button type="button" className="h-11" disabled={editBusy} onClick={() => void finishEdit(false)}>
                Revert files and restore prompt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </FindMatchContext.Provider>
      </ToolDiffContext.Provider>
      </ToolVisibilityContext.Provider>
      </ToolDetailPinContext.Provider>
    </MessageScrollerProvider>
  )
}
