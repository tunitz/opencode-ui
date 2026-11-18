import type { SessionMessageInfo } from "@/lib/opencode"
import type { LiveItem, LiveTool } from "@/lib/session-events"

/**
 * A flat, virtualizable row of the conversation. Durable messages and live
 * overlay items are projected into one ordered list so the virtualizer can
 * mount only a bounded window while preserving identity and order.
 */
export type ConversationRow =
  | { kind: "message"; key: string; message: SessionMessageInfo }
  | { kind: "live-user"; key: string; item: Extract<LiveItem, { kind: "user" }> }
  | { kind: "live-text"; key: string; item: Extract<LiveItem, { kind: "text" }> }
  | {
      kind: "live-reasoning"
      key: string
      item: Extract<LiveItem, { kind: "reasoning" }>
    }
  | { kind: "live-tools"; key: string; tools: LiveTool[] }

/**
 * Durable messages and the live overlay are rebuilt on different cadences:
 * `messages` keeps its identity while streamed tokens grow `liveItems`. Cache
 * each projection by its input identity so a token only rebuilds the live tail
 * and durable message rows keep referential identity. WeakMap keys let replaced
 * arrays be collected; nothing here is shared across renders by value.
 */
const messageRowsCache = new WeakMap<object, ConversationRow[]>()
const liveRowsCache = new WeakMap<object, ConversationRow[]>()

function messageRowsFor(
  messages: readonly SessionMessageInfo[]
): ConversationRow[] {
  let rows = messageRowsCache.get(messages)
  if (rows) return rows
  rows = messages.map((message) => ({ kind: "message", key: message.id, message }))
  messageRowsCache.set(messages, rows)
  return rows
}

function liveRowsFor(liveItems: readonly LiveItem[]): ConversationRow[] {
  let rows = liveRowsCache.get(liveItems)
  if (rows) return rows
  rows = []
  for (let index = 0; index < liveItems.length; index += 1) {
    const item = liveItems[index]

    if (item.kind === "user") {
      rows.push({ kind: "live-user", key: `user-${item.key}`, item })
      continue
    }

    if (item.kind === "text") {
      rows.push({ kind: "live-text", key: `text-${item.key}`, item })
      continue
    }

    if (item.kind === "reasoning") {
      rows.push({
        kind: "live-reasoning",
        key: `reasoning-${item.key}`,
        item,
      })
      continue
    }

    // Consecutive tool segments render as one trace at their real position.
    const tools: LiveTool[] = [item.tool]
    let last = index

    while (last + 1 < liveItems.length && liveItems[last + 1].kind === "tool") {
      last += 1
      tools.push((liveItems[last] as Extract<LiveItem, { kind: "tool" }>).tool)
    }

    rows.push({
      kind: "live-tools",
      // Stable across live progress and durable reconciliation: the first
      // native tool id is preserved in the assistant message content.
      key: `tools:${tools[0].assistantMessageID}:${tools[0].id}`,
      tools,
    })
    index = last
  }
  liveRowsCache.set(liveItems, rows)
  return rows
}

/** Build the flat row list: durable messages first, then live overlay items. */
export function buildConversationRows(
  messages: readonly SessionMessageInfo[],
  liveItems: readonly LiveItem[]
): ConversationRow[] {
  return [...messageRowsFor(messages), ...liveRowsFor(liveItems)]
}

/** Prepend an older page, dropping any ids already present (cursor overlap). */
export function mergeOlderMessages(
  existing: readonly SessionMessageInfo[],
  olderPage: readonly SessionMessageInfo[]
): SessionMessageInfo[] {
  const ids = new Set(existing.map((message) => message.id))
  const fresh = olderPage.filter((message) => !ids.has(message.id))
  return [...fresh, ...existing]
}
