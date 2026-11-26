import { describe, expect, test } from "bun:test"

import { buildConversationRows } from "../src/lib/message-history"
import type { SessionMessageInfo } from "../src/lib/opencode"
import type { LiveItem } from "../src/lib/session-events"

const message = (id: string) =>
  ({ id, type: "assistant" }) as unknown as SessionMessageInfo

const textItem = (text: string) =>
  ({ kind: "text", key: "t1", text }) as unknown as LiveItem

describe("conversation row allocation", () => {
  test("reuses durable message rows when only the live tail changes", () => {
    const messages = [message("m1"), message("m2")]
    const first = buildConversationRows(messages, [textItem("a")])
    const second = buildConversationRows(messages, [textItem("ab")])

    expect(second).not.toBe(first)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[0].kind).toBe("message")
    expect(second[2].kind).toBe("live-text")
  })

  test("keeps row keys and order stable across projections", () => {
    const messages = [message("m1")]
    const rows = buildConversationRows(messages, [textItem("hello")])
    expect(rows.map((row) => row.key)).toEqual(["m1", "text-t1"])
  })
})
