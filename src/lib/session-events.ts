import type { ToolFileContent, V2Event } from "@/lib/opencode"
import type { LiveAttachmentPreview } from "@/lib/attachments"
import { structuredErrorMessage } from "@/lib/structured-error"
import { toolFilesFromContent } from "@/lib/tool-artifacts"

export type LiveRunStatus =
  | "submitting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "notice"

export type LiveInboxDelivery = "steer" | "queue"

export type LiveTool = {
  id: string
  assistantMessageID: string
  name: string | null
  status: "running" | "completed" | "error"
  error: string | null
  input?: Record<string, unknown>
  files: ToolFileContent[]
  seq: number
}

export type LiveTextBlock = {
  assistantMessageID: string
  ordinal: number
  text: string
  ended: boolean
  seq: number
}

export type LiveReasoningBlock = {
  assistantMessageID: string
  ordinal: number
  text: string
  ended: boolean
  seq: number
}

export type LivePendingUser = {
  key: string
  seq: number
  id: string | null
  text: string
  delivery: LiveInboxDelivery | null
  requestedSteer: boolean
  requestedDelivery?: LiveInboxDelivery | null
  status: "sending" | "sent" | "delivered"
  files?: LiveAttachmentPreview[]
}

type OrderEntry = { kind: "text" | "reasoning" | "tool"; key: string }

export type LiveRun = {
  status: LiveRunStatus
  texts: Record<string, LiveTextBlock>
  reasonings: Record<string, LiveReasoningBlock>
  tools: Record<string, LiveTool>
  /** Arrival order of text/reasoning/tool segments; updates never reorder a key. */
  order: OrderEntry[]
  pendingUsers: LivePendingUser[]
  notices: string[]
  error: string | null
  seen: Record<string, true>
  startedAt: number | null
  nextSeq: number
}

export type DurableRef = { id: string; type?: string; error?: unknown }

export type LiveBlock =
  | {
      kind: "text"
      key: string
      seq: number
      assistantMessageID: string
      ordinal: number
      text: string
    }
  | {
      kind: "reasoning"
      key: string
      seq: number
      assistantMessageID: string
      ordinal: number
      text: string
      ended: boolean
    }
  | {
      kind: "tool"
      key: string
      seq: number
      assistantMessageID: string
      tool: LiveTool
    }

export type LiveItem =
  | LiveBlock
  | {
      kind: "user"
      key: string
      seq: number
      text: string
      delivery: LiveInboxDelivery | null
      requestedSteer: boolean
      requestedDelivery?: LiveInboxDelivery | null
      files?: LiveAttachmentPreview[]
      status: LivePendingUser["status"]
    }

export type LiveProjection = {
  items: LiveItem[]
  notices: string[]
}

const TERMINAL_STATUS: Record<LiveRunStatus, true | undefined> = {
  submitting: undefined,
  running: undefined,
  completed: true,
  failed: true,
  interrupted: true,
  notice: undefined,
}

function isTerminal(status: LiveRunStatus): boolean {
  return TERMINAL_STATUS[status] === true
}

/**
 * Event ids are deduped for the volatile stream. The set must stay bounded: a
 * long run emits thousands of frames, and copying an ever-growing map per
 * frame turned ingestion quadratic (and pinned every id in memory). The most
 * recent ids are enough to absorb a duplicate/replayed frame; ids older than
 * the window cannot recur without a much larger stream gap.
 */
const SEEN_WINDOW = 256
const SEEN_TRIM_AT = SEEN_WINDOW * 2

function rememberSeen(
  seen: Record<string, true>,
  id: string
): Record<string, true> {
  const next = { ...seen, [id]: true as const }
  const ids = Object.keys(next)

  if (ids.length <= SEEN_TRIM_AT) {
    return next
  }

  const trimmed: Record<string, true> = {}

  for (const key of ids.slice(-SEEN_WINDOW)) {
    trimmed[key] = true
  }

  return trimmed
}

export function emptyLiveRun(status: LiveRunStatus = "running"): LiveRun {
  return {
    status,
    texts: {},
    reasonings: {},
    tools: {},
    order: [],
    pendingUsers: [],
    notices: [],
    error: null,
    seen: {},
    startedAt: null,
    nextSeq: 0,
  }
}

function textKey(assistantMessageID: string, ordinal: number): string {
  return `text:${assistantMessageID}:${ordinal}`
}

function reasoningKey(assistantMessageID: string, ordinal: number): string {
  return `reasoning:${assistantMessageID}:${ordinal}`
}

function toolKey(assistantMessageID: string, id: string): string {
  return `tool:${assistantMessageID}:${id}`
}

function addNotice(run: LiveRun, notice: string): string[] {
  return run.notices.includes(notice) ? run.notices : [...run.notices, notice]
}

function upsertText(
  run: LiveRun,
  assistantMessageID: string,
  ordinal: number,
  build: (block: LiveTextBlock | undefined) => LiveTextBlock
): LiveRun {
  const key = textKey(assistantMessageID, ordinal)
  const existing = run.texts[key]
  const block = build(existing)

  return {
    ...run,
    texts: { ...run.texts, [key]: block },
    order: existing
      ? run.order
      : [...run.order, { kind: "text" as const, key }],
    nextSeq: existing ? run.nextSeq : run.nextSeq + 1,
  }
}

function upsertReasoning(
  run: LiveRun,
  assistantMessageID: string,
  ordinal: number,
  build: (block: LiveReasoningBlock | undefined) => LiveReasoningBlock
): LiveRun {
  const key = reasoningKey(assistantMessageID, ordinal)
  const existing = run.reasonings[key]
  const block = build(existing)

  return {
    ...run,
    reasonings: { ...run.reasonings, [key]: block },
    order: existing
      ? run.order
      : [...run.order, { kind: "reasoning" as const, key }],
    nextSeq: existing ? run.nextSeq : run.nextSeq + 1,
  }
}

function upsertTool(
  run: LiveRun,
  assistantMessageID: string,
  id: string,
  patch: (tool: LiveTool | undefined) => Partial<LiveTool>
): LiveRun {
  const key = toolKey(assistantMessageID, id)
  const existing = run.tools[key]
  const tool: LiveTool = existing ?? {
    id,
    assistantMessageID,
    name: null,
    status: "running",
    error: null,
    files: [],
    seq: run.nextSeq,
  }

  return {
    ...run,
    tools: { ...run.tools, [key]: { ...tool, ...patch(existing) } },
    order: existing
      ? run.order
      : [...run.order, { kind: "tool" as const, key }],
    nextSeq: existing ? run.nextSeq : run.nextSeq + 1,
  }
}

/**
 * Session id carried inside `event.data` for session-scoped frames. The live
 * stream is global, so every consumer must filter by this before rendering.
 */
export function eventSessionID(event: V2Event): string | null {
  if (event.type === "server.connected") {
    return null
  }

  const data: unknown = event.data

  if (!data || typeof data !== "object") {
    return null
  }

  if ("sessionID" in data && typeof data.sessionID === "string") {
    return data.sessionID
  }

  if (
    "form" in data &&
    data.form &&
    typeof data.form === "object" &&
    "sessionID" in data.form &&
    typeof data.form.sessionID === "string"
  ) {
    return data.form.sessionID
  }

  return null
}

/**
 * Apply one live SSE event to a session's run. Pure: the caller keys runs by
 * `eventSessionID`. Segment order is the native event arrival order (the server
 * exposes no global part index for tools); text ordinals only order text parts.
 * `session.text.ended` is the snapshot for its ordinal, so it replaces
 * accumulated deltas and later deltas for that ordinal are ignored. Event ids
 * are deduped because the shared stream has no replay guarantee.
 */
export function applySessionEvent(
  current: LiveRun | undefined,
  event: V2Event
): LiveRun | undefined {
  if (event.type === "server.connected") {
    return current
  }

  if (current?.seen[event.id]) {
    return current
  }

  const run = current ?? emptyLiveRun()
  const seen = rememberSeen(run.seen, event.id)
  // Every execution.started is a new native execution, so the run clock is
  // reset here instead of inheriting a previous execution's start.
  const executionStartedAt =
    event.type === "session.execution.started" &&
    typeof event.created === "number" &&
    Number.isFinite(event.created) &&
    event.created > 0
      ? event.created
      : null
  const base: LiveRun = {
    ...run,
    seen,
    startedAt:
      event.type === "session.execution.started"
        ? executionStartedAt
        : run.startedAt,
  }

  switch (event.type) {
    case "session.execution.started":
      return { ...base, status: "running" }

    case "session.execution.succeeded":
      return {
        ...base,
        status: "completed",
        error: null,
        tools: Object.fromEntries(
          Object.entries(base.tools).map(([key, tool]) => [
            key,
            tool.status === "running"
              ? { ...tool, status: "completed" as const }
              : tool,
          ])
        ),
      }

    case "session.execution.failed":
      return {
        ...base,
        status: "failed",
        error:
          structuredErrorMessage(event.data.error) ?? "The response failed.",
      }

    case "session.execution.interrupted":
      return {
        ...base,
        status: "interrupted",
        notices: addNotice(base, `Execution interrupted (${event.data.reason}).`),
      }

    case "session.retry.scheduled": {
      const detail = structuredErrorMessage(event.data.error)
      return {
        ...base,
        status: "running",
        notices: addNotice(
          base,
          `Retrying (attempt ${event.data.attempt})${detail ? `: ${detail}` : ""}.`
        ),
      }
    }

    case "session.status":
      if (event.data.status.type === "retry") {
        const detail = structuredErrorMessage({
          message: event.data.status.message,
        })
        const action = event.data.status.action
        const actionText = action
          ? structuredErrorMessage({
              message: [action.title, action.message].filter(Boolean).join(" — "),
            })
          : null
        const explanation = [detail, actionText]
          .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
          .join(" ")
        return {
          ...base,
          status: "running",
          notices: addNotice(
            base,
            `Retrying (attempt ${event.data.status.attempt})${explanation ? `: ${explanation}` : ""}.`
          ),
        }
      }

      if (event.data.status.type === "busy") {
        return { ...base, status: "running" }
      }

      return base

    // A running session that goes idle without an observed terminal frame (for
    // example a session that was already running when this page loaded) must
    // not leave Stop stuck forever. Terminal frames remain authoritative.
    case "session.idle":
      return base.status === "running"
        ? {
            ...base,
            status: "interrupted",
            notices: addNotice(base, "Execution stopped."),
          }
        : base

    case "session.text.started":
      return upsertText(
        base,
        event.data.assistantMessageID,
        event.data.ordinal,
        (block) =>
          block ?? {
            assistantMessageID: event.data.assistantMessageID,
            ordinal: event.data.ordinal,
            text: "",
            ended: false,
            seq: base.nextSeq,
          }
      )

    case "session.text.delta":
      return upsertText(
        base,
        event.data.assistantMessageID,
        event.data.ordinal,
        (block) => {
          const currentBlock = block ?? {
            assistantMessageID: event.data.assistantMessageID,
            ordinal: event.data.ordinal,
            text: "",
            ended: false,
            seq: base.nextSeq,
          }

          return currentBlock.ended
            ? currentBlock
            : { ...currentBlock, text: currentBlock.text + event.data.delta }
        }
      )

    case "session.text.ended":
      return upsertText(
        base,
        event.data.assistantMessageID,
        event.data.ordinal,
        (block) => ({
          ...(block ?? {
            assistantMessageID: event.data.assistantMessageID,
            ordinal: event.data.ordinal,
            seq: base.nextSeq,
          }),
          text: event.data.text,
          ended: true,
        })
      )

    case "session.reasoning.started":
      return upsertReasoning(
        base,
        event.data.assistantMessageID,
        event.data.ordinal,
        (block) =>
          block ?? {
            assistantMessageID: event.data.assistantMessageID,
            ordinal: event.data.ordinal,
            text: "",
            ended: false,
            seq: base.nextSeq,
          }
      )

    case "session.reasoning.delta":
      return upsertReasoning(
        base,
        event.data.assistantMessageID,
        event.data.ordinal,
        (block) => {
          const currentBlock = block ?? {
            assistantMessageID: event.data.assistantMessageID,
            ordinal: event.data.ordinal,
            text: "",
            ended: false,
            seq: base.nextSeq,
          }

          return currentBlock.ended
            ? currentBlock
            : { ...currentBlock, text: currentBlock.text + event.data.delta }
        }
      )

    case "session.reasoning.ended":
      return upsertReasoning(
        base,
        event.data.assistantMessageID,
        event.data.ordinal,
        (block) => ({
          ...(block ?? {
            assistantMessageID: event.data.assistantMessageID,
            ordinal: event.data.ordinal,
            seq: base.nextSeq,
          }),
          text: event.data.text,
          ended: true,
        })
      )

    case "session.tool.input.started":
      return upsertTool(
        base,
        event.data.assistantMessageID,
        event.data.id,
        () => ({ name: event.data.name, status: "running" })
      )

    case "session.tool.input.ended":
      return upsertTool(
        base,
        event.data.assistantMessageID,
        event.data.id,
        () => ({})
      )

    case "session.tool.called":
      return {
        ...upsertTool(
          base,
          event.data.assistantMessageID,
          event.data.id,
          () => ({
            status: "running",
            input: event.data.input as Record<string, unknown>,
          })
        ),
        status: isTerminal(base.status) ? base.status : "running",
      }

    case "session.tool.progress":
      return upsertTool(
        base,
        event.data.assistantMessageID,
        event.data.id,
        () => ({ status: "running" })
      )

    case "session.tool.success":
      return upsertTool(
        base,
        event.data.assistantMessageID,
        event.data.id,
        () => ({
          status: "completed",
          error: null,
          files: toolFilesFromContent(event.data.content),
        })
      )

    case "session.tool.failed":
      return upsertTool(
        base,
        event.data.assistantMessageID,
        event.data.id,
        () => ({
          status: "error",
          error:
            structuredErrorMessage(event.data.error) ??
            "The tool call failed.",
          files: toolFilesFromContent(event.data.content),
        })
      )

    case "session.inbox.delivered":
      return {
        ...base,
        pendingUsers: base.pendingUsers.map((user) =>
          user.id === event.data.inboxID
            ? { ...user, status: "delivered" as const }
            : user
        ),
      }

    case "session.inbox.delivery.changed":
      return {
        ...base,
        pendingUsers: base.pendingUsers.map((user) =>
          user.id === event.data.inboxID
            ? { ...user, delivery: event.data.delivery }
            : user
        ),
      }

    case "permission.asked":
      return {
        ...base,
        status:
          current && (current.status === "running" || isTerminal(current.status))
            ? current.status
            : "notice",
        notices: addNotice(base, "Waiting for permission approval."),
      }

    case "form.created":
      return {
        ...base,
        status:
          current && (current.status === "running" || isTerminal(current.status))
            ? current.status
            : "notice",
        notices: addNotice(base, "A question is waiting for your answer."),
      }

    default:
      return current
  }
}

/**
 * Live-only projection for the conversation, in segment order. Durable messages
 * win: once refetched history contains an assistant message id (or a pending
 * inbox id), that piece is dropped from the overlay instead of rendering twice.
 */
export function projectLiveRun(
  run: LiveRun | null | undefined,
  durable: readonly DurableRef[]
): LiveProjection {
  if (!run) {
    return { items: [], notices: [] }
  }

  const durableIDs = new Set(durable.map((message) => message.id))
  const blocks: LiveBlock[] = []

  for (const entry of run.order) {
    if (entry.kind === "text") {
      const block = run.texts[entry.key]

      if (
        !block ||
        durableIDs.has(block.assistantMessageID) ||
        block.text.trim().length === 0
      ) {
        continue
      }

      blocks.push({
        kind: "text",
        key: entry.key,
        seq: block.seq,
        assistantMessageID: block.assistantMessageID,
        ordinal: block.ordinal,
        text: block.text,
      })
      continue
    }

    if (entry.kind === "reasoning") {
      const block = run.reasonings[entry.key]

      if (
        !block ||
        durableIDs.has(block.assistantMessageID) ||
        block.text.trim().length === 0
      ) {
        continue
      }

      blocks.push({
        kind: "reasoning",
        key: entry.key,
        seq: block.seq,
        assistantMessageID: block.assistantMessageID,
        ordinal: block.ordinal,
        text: block.text,
        ended: block.ended,
      })
      continue
    }

    const tool = run.tools[entry.key]

    if (!tool || durableIDs.has(tool.assistantMessageID)) {
      continue
    }

    blocks.push({
      kind: "tool",
      key: entry.key,
      seq: tool.seq,
      assistantMessageID: tool.assistantMessageID,
      tool,
    })
  }

  const users: LiveItem[] = run.pendingUsers
    .filter((user) => !user.id || !durableIDs.has(user.id))
    .map((user) => ({
      kind: "user" as const,
      key: user.key,
      seq: user.seq,
      text: user.text,
      delivery: user.delivery,
      requestedSteer: user.requestedSteer,
      requestedDelivery: user.requestedDelivery,
      files: user.files,
      status: user.status,
    }))

  const items = [...blocks, ...users].toSorted((a, b) =>
    a.seq === b.seq ? a.key.localeCompare(b.key) : a.seq - b.seq
  )

  return { items, notices: run.notices }
}

/**
 * User-facing caption for a live user message. Only a genuine active-run Send
 * is a steer: the backend may report a transport `delivery` mode (including
 * "steer") for ordinary first/idle admissions, so the caption is gated on
 * `requestedSteer` alone and never on the transport delivery mode.
 */
export function steerCaption(item: {
  requestedSteer: boolean
  delivery: LiveInboxDelivery | null
  status: LivePendingUser["status"]
}): string | null {
  if (!item.requestedSteer) {
    return null
  }

  if (item.delivery === "steer") {
    if (item.status === "sending") return "Sending steer…"
    if (item.status === "delivered") return "Steer delivered"
    return "Steer sent"
  }

  if (item.delivery === "queue") {
    return item.status === "delivered"
      ? "Steer queued (backend reported queue), delivered"
      : "Steer queued (backend reported queue)"
  }

  return null
}

/** User-facing caption for an explicitly queued message. */
export function queueCaption(item: {
  requestedDelivery?: LiveInboxDelivery | null
  delivery: LiveInboxDelivery | null
  status: LivePendingUser["status"]
}): string | null {
  if (item.requestedDelivery !== "queue") {
    return null
  }

  if (item.delivery === "queue") {
    if (item.status === "sending") return "Queueing…"
    if (item.status === "delivered") return "Queued message delivered"
    return "Queued"
  }

  if (item.delivery === "steer") {
    return "Queue requested, but the backend reported steer delivery."
  }

  return item.status === "sending" ? "Queueing…" : "Queue requested; awaiting delivery."
}

/** Caption for the user's explicitly requested delivery mode. */
export function deliveryCaption(item: {
  requestedSteer: boolean
  requestedDelivery?: LiveInboxDelivery | null
  delivery: LiveInboxDelivery | null
  status: LivePendingUser["status"]
}): string | null {
  if (item.requestedDelivery === "queue") {
    return queueCaption(item)
  }

  return steerCaption(item)
}

/** True when refetched durable history already contains everything live. */
export function runCoveredByMessages(
  run: LiveRun,
  durable: readonly DurableRef[]
): boolean {
  if (!isTerminal(run.status)) {
    return false
  }

  const hasLiveContent =
    run.pendingUsers.length > 0 ||
    run.order.length > 0

  let latestAssistant: DurableRef | undefined
  for (let index = durable.length - 1; index >= 0; index -= 1) {
    if (durable[index]?.type === "assistant") {
      latestAssistant = durable[index]
      break
    }
  }

  // Errors and notices are not represented by an empty durable page; keep the
  // terminal run visible until a later refetch actually carries its content.
  // A failed run with no streamed content is covered once the latest durable
  // assistant carries the failure, so its error is not shown twice.
  if (!hasLiveContent) {
    return run.status === "failed" && Boolean(latestAssistant?.error)
  }

  // A failed run stays visible until the latest durable assistant record
  // carries its structured error. Checking any older error message would hide
  // a fresh failure whose durable record has not arrived yet.
  if (run.status === "failed" && !latestAssistant?.error) return false

  const ids = new Set(durable.map((message) => message.id))

  for (const user of run.pendingUsers) {
    if (!user.id || !ids.has(user.id)) {
      return false
    }
  }

  for (const entry of run.order) {
    const assistantID =
      entry.kind === "text"
        ? run.texts[entry.key]?.assistantMessageID
        : entry.kind === "reasoning"
          ? run.reasonings[entry.key]?.assistantMessageID
          : run.tools[entry.key]?.assistantMessageID

    if (!assistantID || !ids.has(assistantID)) {
      return false
    }
  }

  return true
}
