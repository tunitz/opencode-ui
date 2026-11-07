import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDownIcon,
  BrainIcon,
  CircleAlertIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react"

import {
  hasOffscreenBelow,
  prefersReducedMotion,
  scrollBehavior,
} from "@/lib/accessibility"
import { Markdown } from "@/components/markdown"
import { MessageFiles } from "@/components/message-files"
import { ToolArtifacts } from "@/components/tool-artifacts"
import { ProjectArtifacts } from "@/components/project-artifacts"
import { finalProjectArtifactMessages } from "@/lib/project-artifacts"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Message, MessageContent } from "@/components/ui/message"
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
import type { LoadStatus, StreamStatus } from "@/lib/use-opencode"
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

type ToolLike = {
  id: string
  name: string | null
  status: "running" | "completed" | "error"
  error?: string | null
  input?: Record<string, unknown>
  output?: string
  files: ToolFileContent[]
}

// Only select short, human-readable fields; never render prompts, commands,
// paths, arbitrary parameters, or raw streamed input in the trace heading.
function traceValue(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (
    !text ||
    text.length > max ||
    !/^[\p{L}\p{N} .,_()&+:’'-]+$/u.test(text)
  ) {
    return null
  }
  if (/\b(?:secret|password|token|credential|api[ -]?key|private[ -]?key)\b/i.test(text)) return null
  if (/\S{32,}/u.test(text)) return null
  return text
}

function toolLabel(tool: ToolLike): string {
  const name = tool.name ?? `tool ${tool.id}`
  const input = tool.input
  if (!input) return name

  if (name === "subagent" || name === "task") {
    const agent =
      traceValue(input.agent, 40) ?? traceValue(input.subagent_type, 40)
    const description = traceValue(input.description, 100)
    const detail = [agent, description].filter(Boolean).join(" — ")
    return detail ? `${detail} · ${name}` : name
  }
  if (name === "skill") {
    const skill = traceValue(input.id, 60) ?? traceValue(input.name, 60)
    return skill ? `${skill} · ${name}` : name
  }
  // Numeric pagination arguments distinguish calls without revealing content.
  for (const key of ["offset", "limit"]) {
    const value = input[key]
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return `${key} ${value} · ${name}`
    }
  }
  return name
}

function ItemWrap({
  messageId,
  author,
  children,
}: {
  messageId: string
  author: "You" | "Assistant"
  children: ReactNode
}) {
  return (
    <div
      data-message-id={messageId}
      tabIndex={-1}
      className="min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="sr-only">{author}:</span>
      {children}
    </div>
  )
}

const UserMessage = memo(function UserMessage({
  message,
}: {
  message: SessionMessageUser
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
    <ItemWrap messageId={message.id} author="You">
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
        </MessageContent>
      </Message>
    </ItemWrap>
  )
})

const MOBILE_TOOL_DETAIL_LIMIT = 240
const ToolDetailRowContext = createContext<string | null>(null)
const ToolDetailPinContext = createContext<(key: string | null) => void>(() => {})

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
            <SheetDescription dir="auto">{name}</SheetDescription>
          </SheetHeader>
          <div role="region" aria-label="Full tool error" tabIndex={0} dir="auto" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 text-sm break-words whitespace-pre-wrap text-destructive focus-visible:outline-2 focus-visible:outline-ring">{error}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function ToolTrace({
  tools,
  open,
  onOpenChange,
}: {
  tools: ToolLike[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const running = tools.some((tool) => tool.status === "running")
  const failed = tools.some((tool) => tool.status === "error")
  const status = failed ? "error" : running ? "running" : "completed"
  const name = tools[0] ? toolLabel(tools[0]) : "tool unknown"
  const summary = tools.length === 1 ? toolCallSummary(tools[0].name, tools[0].input) : undefined
  const title =
    tools.length === 1
      ? `1 tool call: ${name}${summary ? ` · ${summary}` : ""}`
      : `${tools.length} tool calls: ${tools.map((tool) => toolLabel(tool)).join(", ")}`

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
          <ul className="space-y-1.5">
            {tools.map((tool) => (
              <li
                key={tool.id}
                className="min-w-0 text-[13px]"
              >
                <Collapsible>
                  <CollapsibleTrigger className="group/tool flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md text-start focus-visible:outline-2 focus-visible:outline-ring">
                    <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-aria-expanded/tool:rotate-90 motion-reduce:transition-none" />
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate font-mono">{tool.name ?? `tool ${tool.id}`}</span>
                      {toolCallSummary(tool.name, tool.input) ? <span dir="auto" className="block truncate font-mono text-xs">{toolCallSummary(tool.name, tool.input)}</span> : null}
                    </span>
                    <span className={cn("shrink-0 text-xs text-muted-foreground", tool.status === "error" && "text-destructive")}>{tool.status}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-w-0 ps-6">
                    <ToolCallDetails tool={tool} />
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function ToolCallDetails({ tool }: { tool: ToolLike }) {
  const input = toolInputDetail(tool.input)
  return <>
    {input !== undefined ? <ToolDetail label="Input" text={input} /> : null}
    {tool.output !== undefined ? <ToolDetail label="Output" text={tool.output} /> : null}
    {tool.status === "error" && tool.error ? <ToolErrorDetails error={tool.error} name={toolLabel(tool)} /> : null}
  </>
}

function ToolDetail({ label, text }: { label: string; text: string }) {
  return <div className="mt-2 min-w-0"><div className="text-xs font-medium">{label}</div><pre dir="auto" tabIndex={0} aria-label={label} className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words focus-visible:outline-2 focus-visible:outline-ring">{text}</pre></div>
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
  const description =
    durationMs !== null && durationMs !== undefined
      ? formatDurationMs(durationMs)
      : streaming
        ? "thinking"
        : null

  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger className="min-h-11 rounded-lg px-1.5">
          <TraceLine>
            <TraceIcon>
              <BrainIcon aria-hidden="true" />
            </TraceIcon>
            <TraceTitle>Thought process</TraceTitle>
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
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-destructive",
        className
      )}
    >
      <p className="text-sm font-medium" dir="auto">Response failed</p>
      <p className="mt-1 break-words whitespace-pre-wrap text-xs leading-5" dir="auto">
        {message}
      </p>
    </div>
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

  return (
    <ItemWrap messageId={message.id} author="Assistant">
      <Message>
        <MessageContent>
          {groups.map((group) => {
            if (group.kind === "text") {
              return (
                <Bubble key={group.key} variant="ghost">
                  <BubbleContent className="message-markdown space-y-3.5 p-0 text-base leading-6">
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
              <div key={group.key} className="min-w-0 space-y-1">
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
          {projectAttachments && sessionKey ? <ProjectArtifacts sessionID={sessionKey} messageID={message.id} text={message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n\n")} streamStatus={streamStatus} /> : null}
          {errorText ? (
            <ResponseError
              message={errorText}
              className={groups.length > 0 ? "mt-3" : undefined}
            />
          ) : null}
        </MessageContent>
      </Message>
    </ItemWrap>
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
}: {
  message: SessionMessageInfo
  sessionKey: string | null
  projectAttachments: boolean
  streamStatus: StreamStatus
  expandedToolGroups: Record<string, true>
  onToolOpenChange: (key: string, open: boolean) => void
  expandedReasoningGroups: Record<string, true>
  onReasoningOpenChange: (key: string, open: boolean) => void
}) {
  if (message.type === "user") {
    return <UserMessage message={message} />
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
    <ItemWrap messageId={`live-user-${item.key}`} author="You">
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
            <p
              role="status"
              className="pe-1 text-end text-xs text-muted-foreground"
            >
              {status}
            </p>
          ) : null}
        </MessageContent>
      </Message>
    </ItemWrap>
  )
}

function LiveTextItem({
  item,
  sessionKey,
  onGrow,
}: {
  item: Extract<LiveItem, { kind: "text" }>
  sessionKey: string | null
  onGrow?: () => void
}) {
  // Parsing a growing Markdown answer is the dominant cost of a long stream on
  // a slow device. Deferring the text keeps typing/Stop urgent while React
  // batches or skips intermediate parses; the settled text is still shown.
  const text = useDeferredValue(item.text)

  // The deferred text can grow after the parent's live-run follow ran, so the
  // conversation must re-pin after this commit when the reader is at the end.
  useEffect(() => {
    onGrow?.()
  }, [onGrow, text])

  return (
    <ItemWrap messageId={`live-${item.key}`} author="Assistant">
      <Message>
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent className="message-markdown space-y-3.5 p-0 text-base leading-6">
              <Markdown artifactSessionID={sessionKey} streaming>
                {text}
              </Markdown>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </ItemWrap>
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
    <ItemWrap messageId={`live-reasoning-${item.key}`} author="Assistant">
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
    </ItemWrap>
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
    <ItemWrap messageId={`live-tools-${tools[0]?.id ?? "group"}`} author="Assistant">
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
    </ItemWrap>
  )
}, (previous, next) =>
  previous.groupKey === next.groupKey &&
  previous.sessionKey === next.sessionKey &&
  previous.expandedToolGroups === next.expandedToolGroups &&
  previous.onToolOpenChange === next.onToolOpenChange &&
  sameToolList(previous.tools, next.tools)
)

function RowView({
  row,
  sessionKey,
  projectAttachments,
  streamStatus,
  expandedToolGroups,
  onToolOpenChange,
  expandedReasoningGroups,
  onReasoningOpenChange,
  onLiveTextGrow,
}: {
  row: ConversationRow
  sessionKey: string | null
  projectAttachments: boolean
  streamStatus: StreamStatus
  expandedToolGroups: Record<string, true>
  onToolOpenChange: (key: string, open: boolean) => void
  expandedReasoningGroups: Record<string, true>
  onReasoningOpenChange: (key: string, open: boolean) => void
  onLiveTextGrow?: () => void
}) {
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
        />
      )
    case "live-user":
      return <LiveUserItem item={row.item} />
    case "live-text":
      return (
        <LiveTextItem
          item={row.item}
          sessionKey={sessionKey}
          onGrow={onLiveTextGrow}
        />
      )
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
}

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
      <div role="status" className="space-y-1 px-1 text-xs text-muted-foreground">
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
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center overflow-hidden px-6 py-10 text-center text-sm",
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {children}
      </div>
    </div>
  )
}

const SCROLL_EDGE_THRESHOLD = 48
const PREPEND_TRIGGER = 160

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

export function Conversation({
  sessionKey,
  hasSession,
  status,
  error,
  messages,
  streamStatus,
  hasOlder,
  loadingOlder,
  olderError,
  revert,
  focusMessageID,
  onFocusMessageHandled,
  onRetry,
  onLoadOlder,
}: {
  sessionKey: string | null
  hasSession: boolean
  status: LoadStatus
  error: string | null
  messages: SessionMessageInfo[]
  streamStatus: StreamStatus
  hasOlder: boolean
  loadingOlder: boolean
  olderError: string | null
  revert: SessionRevert | null
  focusMessageID: string | null
  onFocusMessageHandled: () => void
  onRetry: () => void
  onLoadOlder: () => Promise<void>
}) {
  recordPerfRender("Conversation")
  // Subscribed here, not in the app shell: streaming tokens re-render the
  // conversation only. Status-only consumers use a status subscription.
  const liveRun = useLiveRun(sessionKey)
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
  const contentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const reducedMotion = useReducedMotion()
  const anchorRef = useRef<{
    key: string
    top: number
    baseCount: number
  } | null>(null)
  const prevCountRef = useRef(rows.length)
  const focusedRowKeyRef = useRef<string | null>(null)
  const [sheetPinnedRowKey, setSheetPinnedRowKey] = useState<string | null>(null)
  const didInitialScrollRef = useRef(false)
  const initialSettlingRef = useRef(true)
  const autoScrollingRef = useRef(false)
  const jumpTimerRef = useRef<number | null>(null)
  const followFrameRef = useRef<number | null>(null)
  const pinnedBottomRef = useRef<{ top: number; height: number } | null>(null)
  const sessionKeyRef = useRef(sessionKey)
  const loadingOlderRef = useRef(loadingOlder)
  loadingOlderRef.current = loadingOlder
  const olderRequestRef = useRef<Promise<void> | null>(null)
  const hasOlderRef = useRef(hasOlder)
  hasOlderRef.current = hasOlder
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const disclosureRef = useRef<{ frame: number; session: string | null } | null>(null)
  const prependRestoreRef = useRef<number | null>(null)
  const syncScrollStateRef = useRef<() => void>(() => {})

  const cancelPrependRestore = useCallback(() => {
    if (prependRestoreRef.current === null) return
    cancelAnimationFrame(prependRestoreRef.current)
    prependRestoreRef.current = null
    autoScrollingRef.current = false
    syncScrollStateRef.current()
  }, [])

  const cancelDisclosureAnchor = useCallback(() => {
    if (!disclosureRef.current) return
    cancelAnimationFrame(disclosureRef.current.frame)
    disclosureRef.current = null
    syncScrollStateRef.current()
  }, [])

  // Keep the activated trigger in place while the panel animates and the
  // virtualizer measures it. This is deliberately short-lived: it must never
  // turn into another bottom-follow mechanism or fight a reader's scrolling.
  const handleDisclosureClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element
    const trigger = target.closest<HTMLElement>('[data-slot="trace-collapsible-trigger"]')
    const viewport = viewportRef.current
    if (!trigger || !viewport || !viewport.contains(trigger) || anchorRef.current || initialSettlingRef.current) return

    cancelDisclosureAnchor()
    cancelPrependRestore()
    if (followFrameRef.current !== null) {
      cancelAnimationFrame(followFrameRef.current)
      followFrameRef.current = null
    }
    pinnedBottomRef.current = null
    atBottomRef.current = false
    setAtBottom(false)
    const top = trigger.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    const started = performance.now()
    const anchor = { frame: 0, session: sessionKey }
    disclosureRef.current = anchor
    const settle = () => {
      if (disclosureRef.current !== anchor) return
      if (!trigger.isConnected || viewportRef.current !== viewport || sessionKeyRef.current !== anchor.session) {
        disclosureRef.current = null
        if (viewportRef.current === viewport && sessionKeyRef.current === anchor.session) {
          syncScrollStateRef.current()
        }
        return
      }
      const delta = trigger.getBoundingClientRect().top - viewport.getBoundingClientRect().top - top
      if (Math.abs(delta) > 0.5) viewport.scrollTop += delta
      // The panel transition is 200ms; allow time for deferred RO measurement.
      if (performance.now() - started < 400) {
        anchor.frame = requestAnimationFrame(settle)
      } else {
        disclosureRef.current = null
        syncScrollStateRef.current()
      }
    }
    anchor.frame = requestAnimationFrame(settle)
  }, [cancelDisclosureAnchor, cancelPrependRestore, sessionKey])
  useEffect(() => () => {
    if (disclosureRef.current) cancelAnimationFrame(disclosureRef.current.frame)
  }, [])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns a live instance that React Compiler cannot memoize; the windowed render is handled by the virtualizer itself, and Conversation is intentionally not memoized.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 116,
    overscan: 12,
    // Defer ResizeObserver measurements to the next frame. The virtualizer's
    // dynamic row measurements otherwise re-enter synchronously with the
    // browser's RO delivery while prepending/streaming rows; WebKit reports
    // "ResizeObserver loop completed with undelivered notifications".
    useAnimationFrameWithResizeObserver: true,
    getItemKey: (index) => rows[index]?.key ?? index,
    measureElement: (el) => el.getBoundingClientRect().height,
    rangeExtractor: (range) => {
      const start = Math.max(0, range.startIndex - range.overscan)
      const end = Math.min(range.count - 1, range.endIndex + range.overscan)
      const indices: number[] = []

      for (let i = start; i <= end; i += 1) {
        indices.push(i)
      }

      // Keep the row holding keyboard focus mounted even when it leaves the
      // window, so focusing a tool/link inside a message never unmounts focus.
      // Track it by key so prepending history cannot pin the wrong row.
      const focusedKey = focusedRowKeyRef.current
      const focused = focusedKey
        ? rowsRef.current.findIndex((row) => row.key === focusedKey)
        : -1

      if (
        focused >= 0 &&
        focused < range.count &&
        !indices.includes(focused)
      ) {
        indices.push(focused)
      }

      // A sheet is portaled outside its virtual row; keep that row mounted
      // until the sheet has closed and focus can return to the trigger.
      const sheetPinned = sheetPinnedRowKey
        ? rowsRef.current.findIndex((row) => row.key === sheetPinnedRowKey)
        : -1
      if (sheetPinned >= 0 && sheetPinned < range.count && !indices.includes(sheetPinned)) {
        indices.push(sheetPinned)
      }
      indices.sort((a, b) => a - b)

      return indices
    },
  })

  const handleFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const row = target?.closest("[data-index]")
    const index = row?.getAttribute("data-index")
    focusedRowKeyRef.current =
      index === null || index === undefined
        ? null
        : (rowsRef.current[Number(index)]?.key ?? null)
  }, [])

  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null

    if (next && event.currentTarget.contains(next)) {
      return
    }

    focusedRowKeyRef.current = null
  }, [])

  const syncScrollState = useCallback(() => {
    const el = viewportRef.current

    if (!el) {
      return
    }

    // A pin we just performed can be followed by more content (including a
    // deferred Markdown commit) before its scroll event is delivered. Only an
    // upward scrollTop movement proves the reader left the bottom; height
    // changes alone are our own growth and stay followed.
    const pinned = pinnedBottomRef.current
    if (pinned !== null) {
      if (el.scrollTop >= pinned.top - 1) {
        return
      }
      pinnedBottomRef.current = null
    }

    const metrics = {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }
    const nextAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_EDGE_THRESHOLD
    atBottomRef.current = nextAtBottom
    setAtBottom(nextAtBottom)
    setShowJump(hasOffscreenBelow(metrics, SCROLL_EDGE_THRESHOLD))
  }, [])
  syncScrollStateRef.current = syncScrollState

  const scrollToLatest = useCallback(() => {
    cancelDisclosureAnchor()
    const el = viewportRef.current
    if (!el) {
      return
    }

    pinnedBottomRef.current = null
    const behavior = scrollBehavior(reducedMotion)
    el.scrollTo({ top: el.scrollHeight, behavior })

    const settle = () => {
      const current = viewportRef.current

      if (!current) {
        return
      }

      // Dynamic virtual rows can grow the scroll extent while a smooth jump is
      // in flight. Finish from the measured virtualizer end, not the stale
      // scrollHeight captured at click time.
      virtualizer.scrollToIndex(rowsRef.current.length - 1, { align: "end" })
      current.scrollTop = current.scrollHeight
      syncScrollState()
    }

    if (jumpTimerRef.current !== null) {
      window.clearTimeout(jumpTimerRef.current)
    }
    if (behavior === "auto") {
      requestAnimationFrame(settle)
    } else {
      jumpTimerRef.current = window.setTimeout(settle, 250)
    }
  }, [cancelDisclosureAnchor, reducedMotion, syncScrollState, virtualizer])

  useEffect(() => {
    return () => {
      if (jumpTimerRef.current !== null) {
        window.clearTimeout(jumpTimerRef.current)
      }
    }
  }, [])

  const loadOlder = useCallback(() => {
    if (!hasOlderRef.current || loadingOlderRef.current || olderRequestRef.current) return

    cancelDisclosureAnchor()
    cancelPrependRestore()

    const el = viewportRef.current
    const first = virtualizer.getVirtualItems().find((item) =>
      item.end + (contentRef.current?.offsetTop ?? 0) > (el?.scrollTop ?? 0)
    )
    if (el && first) {
      anchorRef.current = {
        key: rowsRef.current[first.index]?.key ?? "",
        top: first.start + (contentRef.current?.offsetTop ?? 0) - el.scrollTop,
        baseCount: rowsRef.current.length,
      }
    }
    // An explicit request must not be overridden by initial placement or
    // bottom-follow, including when the current page does not scroll.
    initialSettlingRef.current = false
    pinnedBottomRef.current = null
    atBottomRef.current = false
    setAtBottom(false)
    const request = Promise.resolve().then(onLoadOlder)
    olderRequestRef.current = request
    void request.catch(() => {}).finally(() => {
      if (olderRequestRef.current === request) olderRequestRef.current = null
    })
  }, [cancelDisclosureAnchor, cancelPrependRestore, onLoadOlder, virtualizer])

  const handleScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el) {
      return
    }

    if (disclosureRef.current) return
    syncScrollState()

    // Initial bottom placement fires scroll events while dynamic rows are
    // still being measured; never treat those as a request for older history.
    if (initialSettlingRef.current || autoScrollingRef.current) {
      return
    }

    const scrollable = el.scrollHeight - el.clientHeight

    if (
      scrollable > PREPEND_TRIGGER &&
      el.scrollTop < PREPEND_TRIGGER &&
      hasOlderRef.current &&
      !loadingOlderRef.current &&
      !olderError
    ) {
      loadOlder()
    }
  }, [loadOlder, olderError, syncScrollState])

  useEffect(() => {
    if (!focusMessageID) return
    cancelDisclosureAnchor()
    cancelPrependRestore()
    pinnedBottomRef.current = null
    const index = rows.findIndex((row) => row.key === focusMessageID)
    if (index < 0) return

    autoScrollingRef.current = true
    atBottomRef.current = false
    setAtBottom(false)
    virtualizer.scrollToIndex(index, { align: "center" })
    let frame = 0
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(() => {
        const element = viewportRef.current?.querySelector<HTMLElement>(
          `[data-message-id="${focusMessageID}"]`
        )
        element?.focus({ preventScroll: true })
        autoScrollingRef.current = false
        onFocusMessageHandled()
      })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      autoScrollingRef.current = false
    }
  }, [cancelDisclosureAnchor, cancelPrependRestore, focusMessageID, onFocusMessageHandled, rows, virtualizer])

  // Bottom-follow: autoscroll only when the reader is already near the bottom.
  useEffect(() => {
    const prev = prevCountRef.current
    prevCountRef.current = rows.length

    if (focusMessageID || disclosureRef.current) return

    if (rows.length > prev && !anchorRef.current) {
      if (atBottom) {
        // New rows can move the virtualizer's offset for a frame. Mark this
        // programmatic follow so its scroll events are not read as a request
        // for older history, then pin to the measured end.
        autoScrollingRef.current = true
        virtualizer.scrollToIndex(rows.length - 1, { align: "end" })

        requestAnimationFrame(() => {
          const el = viewportRef.current

          if (el) {
            el.scrollTop = el.scrollHeight
          }

          requestAnimationFrame(() => {
            autoScrollingRef.current = false
          })
        })
      }
    }
  }, [focusMessageID, rows.length, atBottom, virtualizer])

  // Coalesced follow for live growth (tool rows, streamed text, and deferred
  // text commits). Never cancels a pending frame: a commit can outpace the
  // next animation frame while a large answer is rendering.
  const followIfAtBottom = useCallback(() => {
    if (focusMessageID || initialSettlingRef.current || disclosureRef.current) return
    if (!atBottomRef.current) return
    if (followFrameRef.current !== null) return
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null
      const el = viewportRef.current
      if (!el || !atBottomRef.current) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 0.5) {
        el.scrollTop = el.scrollHeight
      }
      pinnedBottomRef.current = {
        top: el.scrollTop,
        height: el.scrollHeight,
      }
      syncScrollState()
    })
  }, [focusMessageID, syncScrollState])

  useEffect(() => {
    if (!liveRun) return
    followIfAtBottom()
  }, [followIfAtBottom, liveRun])

  useEffect(() => {
    return () => {
      if (followFrameRef.current !== null) {
        cancelAnimationFrame(followFrameRef.current)
        followFrameRef.current = null
      }
    }
  }, [])

  // A freshly opened long session starts at its newest message. Dynamic row
  // heights arrive over several frames, so keep pinning to the real end until
  // the measured height is stable, then record the true scroll state.
  const hasRows = rows.length > 0

  useEffect(() => {
    if (!hasRows) {
      didInitialScrollRef.current = false
      initialSettlingRef.current = true
      return
    }

    if (didInitialScrollRef.current) {
      return
    }

    didInitialScrollRef.current = true
    initialSettlingRef.current = true
    pinnedBottomRef.current = null
    let cancelled = false
    let frame = 0
    let lastHeight = -1
    let stableFrames = 0

    const settle = (attempt: number) => {
      if (cancelled || !initialSettlingRef.current) {
        return
      }

      const el = viewportRef.current

      if (!el) {
        return
      }

      virtualizer.scrollToIndex(rowsRef.current.length - 1, {
        align: "end",
      })
      el.scrollTop = el.scrollHeight

      const height = el.scrollHeight
      stableFrames = Math.abs(height - lastHeight) < 1 ? stableFrames + 1 : 0
      lastHeight = height

      if (attempt < 90 && (attempt < 3 || stableFrames < 3)) {
        frame = requestAnimationFrame(() => settle(attempt + 1))
        return
      }

      initialSettlingRef.current = false
      autoScrollingRef.current = false
      syncScrollState()
    }

    frame = requestAnimationFrame(() => settle(0))

    return () => {
      cancelled = true
      didInitialScrollRef.current = false
      cancelAnimationFrame(frame)
    }
  }, [hasRows, syncScrollState, virtualizer])

  // Keep the jump affordance tied to the measured scroll range, including
  // after virtualizer measurements, live text/tool growth, keyboard/orientation
  // resizes, and session transitions. It is false until real metrics exist.
  useEffect(() => {
    if (!hasRows || status !== "ready") {
      return
    }

    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    let frame = 0
    const sync = () => {
      const el = viewportRef.current

      // A keyboard/orientation resize changes clientHeight without scrolling.
      // If the reader was at the bottom, keep them pinned there instead of
      // exposing a jump arrow for content that was already read.
      if (el && atBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }

      syncScrollState()
    }
    const scheduleSync = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        sync()
      })
    }
    sync()

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleSync)
    observer?.observe(viewport)
    // Content observer intentionally omitted while diagnosing RO loops.
    window.addEventListener("resize", scheduleSync)
    window.visualViewport?.addEventListener("resize", scheduleSync)

    return () => {
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("resize", scheduleSync)
      window.visualViewport?.removeEventListener("resize", scheduleSync)
    }
  }, [hasRows, rows.length, sessionKey, status, syncScrollState])

  // Preserve the logical anchor after older messages are prepended.
  useEffect(() => {
    if (!anchorRef.current) {
      return
    }

    const anchor = anchorRef.current
    if (rows.length <= anchor.baseCount) {
      // No new page yet. If loading already ended, this request produced no
      // rows (or failed), so the anchor must not block later auto-follow.
      if (!loadingOlderRef.current) anchorRef.current = null
      return
    }

    const index = rows.findIndex((row) => row.key === anchor.key)
    anchorRef.current = null
    if (index <= 0) return
    const el = viewportRef.current
    if (!el) {
      return
    }

    const started = performance.now()
    const restore = () => {
      if (prependRestoreRef.current === null || viewportRef.current !== el) return
      const index = rowsRef.current.findIndex((row) => row.key === anchor.key)
      if (index >= 0) {
        const entry = virtualizer.getOffsetForIndex(index, "start")
        if (entry) {
          autoScrollingRef.current = true
          el.scrollTop = entry[0] + (contentRef.current?.offsetTop ?? 0) - anchor.top
        }
      }
      if (performance.now() - started < 600) {
        prependRestoreRef.current = requestAnimationFrame(restore)
      } else {
        prependRestoreRef.current = null
        autoScrollingRef.current = false
        syncScrollStateRef.current()
      }
    }
    prependRestoreRef.current = requestAnimationFrame(restore)
    return cancelPrependRestore
  }, [cancelPrependRestore, rows, virtualizer])

  useEffect(() => {
    // A completed request that produced no new rows must release the anchor so
    // later messages can follow normally. Successful prepends are released by
    // the anchor-restore effect above.
    if (loadingOlder) return
    const anchor = anchorRef.current
    if (anchor && rowsRef.current.length <= anchor.baseCount) {
      anchorRef.current = null
    }
  }, [loadingOlder])

  // Cross-session guard: forget the pinned row and hide the jump control until
  // the next session's real scroll metrics are measured.
  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) {
      return
    }

    sessionKeyRef.current = sessionKey
    cancelDisclosureAnchor()
    cancelPrependRestore()
    focusedRowKeyRef.current = null
    setSheetPinnedRowKey(null)
    anchorRef.current = null
    olderRequestRef.current = null
    pinnedBottomRef.current = null
    didInitialScrollRef.current = false
    initialSettlingRef.current = true
    autoScrollingRef.current = false
    atBottomRef.current = true
    setAtBottom(true)
    setShowJump(false)
  }, [cancelDisclosureAnchor, cancelPrependRestore, sessionKey])

  if (!hasSession) {
    return (
      <ConversationNotice>
        Select a session to view its history.
      </ConversationNotice>
    )
  }

  if (status === "loading") {
    return (
      <ConversationNotice>
        <span role="status">Loading history…</span>
      </ConversationNotice>
    )
  }

  if (status === "error") {
    return (
      <ConversationNotice tone="error">
        <div role="alert" className="max-w-sm space-y-3">
          <p className="break-words">{error ?? "Could not load history."}</p>
          <Button variant="outline" onClick={onRetry} className="h-11 px-4">
            Retry history
          </Button>
        </div>
      </ConversationNotice>
    )
  }

  if (rows.length === 0 && !liveRun && !revert && !hasOlder && !loadingOlder && !olderError) {
    return <ConversationNotice>No messages yet.</ConversationNotice>
  }

  return (
    <ToolDetailPinContext.Provider value={setSheetPinnedRowKey}>
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClickCapture={handleDisclosureClick}
        onWheelCapture={() => { cancelDisclosureAnchor(); cancelPrependRestore() }}
        onTouchStartCapture={() => { cancelDisclosureAnchor(); cancelPrependRestore() }}
        onPointerDownCapture={() => { cancelDisclosureAnchor(); cancelPrependRestore() }}
        onKeyDownCapture={() => { cancelDisclosureAnchor(); cancelPrependRestore() }}
        aria-label="Conversation"
        role="region"
        tabIndex={0}
        className="safe-horizontal h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-gutter-stable md:px-0"
      >
        {olderError || loadingOlder || hasOlder ? (
          <div className="py-2 text-center">
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
          </div>
        ) : null}
        <div
          ref={contentRef}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
                className={cn("pb-5", item.index === 0 && "pt-5")}
              >
                <ToolDetailRowContext.Provider value={row.key}><RowView
                  row={row}
                  sessionKey={sessionKey}
                  projectAttachments={row.kind === "message" && projectAttachmentMessages.has(row.message.id)}
                  streamStatus={streamStatus}
                  expandedToolGroups={expandedToolGroups}
                  onToolOpenChange={handleToolOpenChange}
                  expandedReasoningGroups={expandedReasoningGroups}
                  onReasoningOpenChange={handleReasoningOpenChange}
                  onLiveTextGrow={followIfAtBottom}
                /></ToolDetailRowContext.Provider>
              </div>
            )
          })}
        </div>
        {revert ? (
          <div
            role="status"
            aria-live="polite"
            className="mx-1 my-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
          >
            <p className="font-medium text-foreground">
              {visibleMessages.length === messages.length
                ? "Revert staged"
                : `${messages.length - visibleMessages.length} message${messages.length - visibleMessages.length === 1 ? "" : "s"} reverted`}
            </p>
            <p className="mt-1">
              {revert.files?.length
                ? `${revert.files.length} file${revert.files.length === 1 ? "" : "s"} restored by the native revert.`
                : "No file changes were recorded for this revert."}
            </p>
            {revert.files?.length ? (
              <ul className="mt-1 space-y-0.5" aria-label="Restored files">
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
            <p className="mt-1">Use /redo to clear the staged revert and restore the messages/files.</p>
          </div>
        ) : null}
        {liveRun ? (
          <div className="py-3">
            {liveRun.notices.length > 0 && liveRun.status !== "notice" ? (
              <div
                role="status"
                className="space-y-1 px-1 text-xs text-muted-foreground"
              >
                {liveRun.notices.map((notice) => (
                  <p key={notice}>
                    <bdi>{notice}</bdi>
                  </p>
                ))}
              </div>
            ) : null}
            <LiveStatus run={liveRun} streamStatus={streamStatus} />
          </div>
        ) : null}
      </div>
      {showJump ? (
        <Button
          type="button"
          variant="secondary"
          aria-label="Scroll to latest"
          onClick={scrollToLatest}
          className="absolute bottom-4 left-1/2 size-11 -translate-x-1/2 rounded-full border-border bg-background text-foreground motion-reduce:transition-none"
        >
          <ArrowDownIcon aria-hidden="true" className="size-5" />
        </Button>
      ) : null}
    </div>
    </ToolDetailPinContext.Provider>
  )
}
