import { expect, test } from "bun:test"
import {
  COMMAND_MESSAGE_CAP,
  groupCommandItems,
  matchCommandItem,
  messageText,
  searchMessages,
  sessionSearchQuery,
} from "../src/lib/command-search"

test("matchCommandItem treats empty and whitespace queries as matches", () => {
  const item = { label: "New Session", detail: "Create a session" }
  expect(matchCommandItem(item, "")).toBe(true)
  expect(matchCommandItem(item, "   ")).toBe(true)
})

test("matchCommandItem requires every word and ignores case", () => {
  const item = { label: "New Session", detail: "Create another conversation" }
  expect(matchCommandItem(item, "new session")).toBe(true)
  expect(matchCommandItem(item, "NEW   SESSION")).toBe(true)
  expect(matchCommandItem(item, "new conversation")).toBe(true)
  expect(matchCommandItem(item, "new missing")).toBe(false)
})

test("matchCommandItem searches the detail text too", () => {
  const item = { label: "Compact", detail: "Summarize the conversation" }
  expect(matchCommandItem(item, "summarize")).toBe(true)
  expect(matchCommandItem(item, "conversation")).toBe(true)
})

test("groupCommandItems uses fixed group order and omits empty groups", () => {
  const items = [
    { id: "f1", group: "Files", label: "a.ts", detail: "" },
    { id: "s1", group: "Sessions", label: "One", detail: "" },
    { id: "a1", group: "Actions", label: "New", detail: "" },
    { id: "m1", group: "Messages", label: "Hello", detail: "" },
    { id: "s2", group: "Sessions", label: "Two", detail: "" },
  ]
  const grouped = groupCommandItems(items)

  expect(grouped.map((entry) => entry.group)).toEqual([
    "Actions",
    "Sessions",
    "Messages",
    "Files",
  ])
  expect(grouped[1].items.map((item) => item.id)).toEqual(["s1", "s2"])
  expect(grouped.some((entry) => entry.group === "Projects")).toBe(false)
})

test("groupCommandItems preserves archived flags and input order", () => {
  const archived = {
    id: "s1",
    group: "Sessions",
    label: "Old",
    detail: "",
    archived: true,
  }
  const active = { id: "s2", group: "Sessions", label: "New", detail: "" }
  const [sessions] = groupCommandItems([archived, active])

  expect(sessions.items).toEqual([archived, active])
  expect(sessions.items[0]).toBe(archived)
  expect(sessions.items[0].archived).toBe(true)
})

test("messageText reads user text", () => {
  expect(messageText({ id: "u1", type: "user", text: "hello world" })).toBe(
    "hello world"
  )
})

test("messageText concatenates only assistant text blocks", () => {
  const message = {
    id: "a1",
    type: "assistant",
    content: [
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "hidden thinking" },
      { type: "tool", id: "t1", name: "bash", state: {} },
      { type: "text", text: "world" },
    ],
  }
  expect(messageText(message)).toBe("Hello\nworld")
})

test("messageText is defensive about malformed messages", () => {
  expect(messageText({ id: "a1", type: "assistant", content: "not an array" })).toBe(
    ""
  )
  expect(messageText({ id: "a1", type: "assistant" })).toBe("")
  expect(
    messageText({
      id: "a1",
      type: "assistant",
      content: [null, 42, { type: "text" }, { type: "text", text: 7 }],
    })
  ).toBe("")
  expect(messageText({ id: "u1", type: "user", text: 42 })).toBe("")
  expect(messageText({ id: "sys1", type: "system" })).toBe("")
  expect(messageText({})).toBe("")
  expect(messageText(null)).toBe("")
})

test("searchMessages returns no hits for an empty query", () => {
  const result = searchMessages(
    [{ id: "u1", type: "user", text: "hello" }],
    "   "
  )
  expect(result.hits).toEqual([])
  expect(result.capped).toBe(false)
})

test("searchMessages matches case-insensitively in input order", () => {
  const result = searchMessages(
    [
      { id: "u1", type: "user", text: "Alpha one" },
      { id: "a1", type: "assistant", content: [{ type: "text", text: "alpha" }] },
      { id: "sys1", type: "system" },
      { id: "u2", type: "user", text: "nope" },
    ],
    "ALPHA"
  )

  expect(result.hits.map((hit) => hit.messageID)).toEqual(["u1", "a1"])
  expect(result.hits.map((hit) => hit.role)).toEqual(["user", "assistant"])
  expect(result.searched).toBe(3)
  expect(result.capped).toBe(false)
})

test("searchMessages reports the cap honestly", () => {
  const messages = [
    { id: "u1", type: "user", text: "needle" },
    { id: "u2", type: "user", text: "needle" },
    { id: "u3", type: "user", text: "needle" },
  ]
  const result = searchMessages(messages, "needle", 2)

  expect(result.hits.map((hit) => hit.messageID)).toEqual(["u1", "u2"])
  expect(result.searched).toBe(2)
  expect(result.capped).toBe(true)
})

test("searchMessages does not report capped when everything fits", () => {
  const result = searchMessages(
    [
      { id: "u1", type: "user", text: "needle" },
      { id: "u2", type: "user", text: "needle" },
    ],
    "needle",
    2
  )
  expect(result.searched).toBe(2)
  expect(result.capped).toBe(false)
})

test("searchMessages ignores non-user/assistant messages when counting", () => {
  const result = searchMessages(
    [
      { id: "sys1", type: "system" },
      { id: "u1", type: "user", text: "needle" },
      { id: "sys2", type: "system" },
      { id: "u2", type: "user", text: "needle" },
      { id: "sys3", type: "system" },
      { id: "u3", type: "user", text: "needle" },
    ],
    "needle",
    2
  )
  expect(result.searched).toBe(2)
  expect(result.hits.map((hit) => hit.messageID)).toEqual(["u1", "u2"])
  expect(result.capped).toBe(true)
})

test("searchMessages exposes the default message cap", () => {
  expect(COMMAND_MESSAGE_CAP).toBe(500)
})

test("searchMessages truncates long snippets around the first match", () => {
  const text = `${"a".repeat(150)}needle${"b".repeat(150)}`
  const result = searchMessages(
    [{ id: "u1", type: "user", text }],
    "NEEDLE"
  )
  const [hit] = result.hits

  expect(hit.snippet.length).toBeLessThanOrEqual(120)
  expect(hit.snippet).toContain("needle")
  expect(hit.snippet.startsWith("…")).toBe(true)
  expect(hit.snippet.endsWith("…")).toBe(true)
})

test("searchMessages leaves short snippets untruncated", () => {
  const result = searchMessages(
    [{ id: "u1", type: "user", text: "a short needle here" }],
    "needle"
  )
  expect(result.hits[0].snippet).toBe("a short needle here")
})

test("sessionSearchQuery trims and enforces the 100-character bound", () => {
  expect(sessionSearchQuery("")).toBeNull()
  expect(sessionSearchQuery("   ")).toBeNull()
  expect(sessionSearchQuery("  hello  ")).toBe("hello")
  expect(sessionSearchQuery("x".repeat(100))).toBe("x".repeat(100))
  expect(sessionSearchQuery("x".repeat(101))).toBeNull()
  expect(sessionSearchQuery(`  ${"x".repeat(100)}  `)).toBe("x".repeat(100))
})
