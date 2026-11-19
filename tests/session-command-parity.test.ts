import { expect, test } from "bun:test"

import type {
  SessionInfo,
  SessionMessageInfo,
  SessionTransferData,
} from "../src/lib/opencode"
import {
  copyableAssistantText,
  findUndoBoundary,
  resolveSessionDirectory,
  sessionExportFilename,
} from "../src/lib/session-commands"
import {
  formatMarkdownTranscript,
  nativeJsonTranscript,
} from "../src/lib/session-export"

const user = (id: string, text: string, created = 1) =>
  ({ id, type: "user", text, time: { created } }) as unknown as SessionMessageInfo

const assistant = (
  id: string,
  content: readonly unknown[],
  created = 2
) =>
  ({
    id,
    type: "assistant",
    content: [...content],
    time: { created },
  }) as unknown as SessionMessageInfo

const compaction = (id: string, summary: string, created = 3) =>
  ({
    id,
    type: "compaction",
    status: "completed",
    summary,
    time: { created },
  }) as unknown as SessionMessageInfo

const info = (id: string, title?: string) =>
  ({
    id,
    title,
    time: { created: 1_700_000_000_000, updated: 1_700_000_060_000 },
    location: { directory: "/work/project" },
  }) as unknown as SessionInfo

const transfer = (messages: readonly SessionMessageInfo[], id = "ses_1") =>
  ({ info: info(id, "Parity session"), messages: [...messages] }) as unknown as SessionTransferData

test("/cd resolves relative paths against the session directory", () => {
  expect(resolveSessionDirectory("src/lib", "/work/project")).toBe(
    "/work/project/src/lib"
  )
  expect(resolveSessionDirectory("../other", "/work/project")).toBe(
    "/work/other"
  )
  expect(resolveSessionDirectory("./docs/./nested", "/work/project")).toBe(
    "/work/project/docs/nested"
  )
})

test("/cd keeps absolute paths and normalizes them without a browser escape gate", () => {
  expect(resolveSessionDirectory("/a//b/../c", "/work/project")).toBe("/a/c")
  expect(resolveSessionDirectory("/../outside", "/work/project")).toBe(
    "/outside"
  )
})

test("/cd expands ~ and ~/ against home when it is known", () => {
  expect(resolveSessionDirectory("~", "/work/project", "/home/u")).toBe(
    "/home/u"
  )
  expect(resolveSessionDirectory("~/docs", "/work/project", "/home/u")).toBe(
    "/home/u/docs"
  )
})

test("/cd preserves the tilde form when home is unknown so the engine can expand it", () => {
  expect(resolveSessionDirectory("~", "/work/project")).toBe("~")
  expect(resolveSessionDirectory("~/docs", "/work/project")).toBe("~/docs")
})

test("/cd rejects empty or control-character paths", () => {
  expect(resolveSessionDirectory("   ", "/work/project")).toBeNull()
  expect(resolveSessionDirectory("/a\nb", "/work/project")).toBeNull()
  expect(resolveSessionDirectory("/a\0b", "/work/project")).toBeNull()
})

test("undo boundary respects a staged revert boundary", () => {
  const messages = [
    user("u1", "first prompt"),
    assistant("a1", [{ type: "text", text: "first answer" }]),
    user("u2", "second prompt"),
    assistant("a2", [{ type: "text", text: "second answer" }]),
  ]
  expect(findUndoBoundary(messages)?.id).toBe("u2")
  // Native revert boundaries are user message IDs, matching revert.stage.
  expect(findUndoBoundary(messages, "u2")?.id).toBe("u1")
  expect(findUndoBoundary(messages, "missing")?.id).toBe("u2")
  expect(findUndoBoundary(messages, "u1")).toBeNull()
})

test("copy selection respects revert and includes completed compaction summaries", () => {
  const messages = [
    user("u1", "first prompt"),
    assistant("a1", [{ type: "text", text: "first answer" }]),
    user("u2", "second prompt"),
    compaction("c1", "Compacted summary of the earlier turn"),
    assistant("a2", [{ type: "text", text: "latest answer" }]),
  ]
  expect(copyableAssistantText(messages)).toBe("latest answer")
  // Without a later assistant turn, the completed compaction summary is the
  // copy target, as in upstream messages.copy.
  expect(
    copyableAssistantText([
      user("u1", "first prompt"),
      assistant("a1", [{ type: "text", text: "first answer" }]),
      user("u2", "second prompt"),
      compaction("c1", "Compacted summary of the earlier turn"),
    ])
  ).toBe("Compacted summary of the earlier turn")
  // A staged revert on u2 hides u2 and everything after it.
  expect(copyableAssistantText(messages, "u2")).toBe("first answer")
  expect(copyableAssistantText(messages, "u1")).toBeNull()
  expect(copyableAssistantText([user("u1", "only")])).toBeNull()
})

test("native JSON export is exact pretty-printed engine data", () => {
  const data = transfer([user("u1", "hello")])
  expect(nativeJsonTranscript(data)).toBe(`${JSON.stringify(data, null, 2)}\n`)
})

test("Markdown export renders user, assistant and tool sections", () => {
  const data = transfer([
    user("u1", "do the thing"),
    assistant("a1", [
      { type: "text", text: "Working on it" },
      {
        type: "tool",
        name: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
        },
      },
    ]),
  ])
  const markdown = formatMarkdownTranscript(data)
  expect(markdown.startsWith("# Parity session\n")).toBe(true)
  expect(markdown).toContain("**Session ID:** ses_1")
  expect(markdown).toContain("## User\n\ndo the thing")
  expect(markdown).toContain("## Assistant\n\nWorking on it")
  expect(markdown).toContain("**Tool: bash**")
  expect(markdown).toContain("file.txt")
})

test("Markdown export hides reasoning and tools when asked", () => {
  const data = transfer([
    assistant("a1", [
      { type: "text", text: "Answer" },
      { type: "reasoning", text: "Secret reasoning" },
      {
        type: "tool",
        name: "bash",
        state: { status: "running", input: {} },
      },
    ]),
  ])
  const plain = formatMarkdownTranscript(data, { tools: false })
  expect(plain).not.toContain("Secret reasoning")
  expect(plain).not.toContain("**Tool: bash**")

  const withThinking = formatMarkdownTranscript(data, { thinking: true, tools: false })
  expect(withThinking).toContain("_Thinking:_\n\nSecret reasoning")
  expect(withThinking).not.toContain("**Tool: bash**")
})

test("export filenames follow the selected format", () => {
  expect(sessionExportFilename(info("ses_1"))).toBe("session-ses_1.json")
  expect(sessionExportFilename(info("ses_1"), "markdown")).toBe(
    "session-ses_1.md"
  )
})
