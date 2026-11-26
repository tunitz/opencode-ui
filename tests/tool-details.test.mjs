import { expect, test } from "bun:test"
import { boundedToolDetail, toolCallSummary, toolInputDetail, toolTextOutput } from "../src/lib/tool-details"
import { applySessionEvent } from "../src/lib/session-events"

test("tool summaries use structured command and skill fields only", () => {
  expect(toolCallSummary("shell", { command: "echo hello\nworld" })).toBe("echo hello world")
  expect(toolCallSummary("skill", { id: "frontend-design" })).toBe("frontend-design")
  expect(toolCallSummary("other", { command: "not a shell" })).toBeUndefined()
  expect(toolCallSummary("shell", { command: "x".repeat(300) }).length).toBe(201)
})

test("details are bounded and text output excludes file content", () => {
  expect(toolTextOutput([{ type: "text", text: "<script>" }, { type: "file", uri: "data:secret", mime: "text/plain" }, { type: "text", text: "done" }])).toBe("<script>\ndone")
  expect(toolTextOutput([{ type: "file", uri: "x" }])).toBeUndefined()
  expect(boundedToolDetail("x".repeat(33000))).toEndWith("… (truncated)")
  expect(toolInputDetail({ command: "echo hi" })).toContain('"command": "echo hi"')
})

test("live tool results retain text for success and failure without inventing output", () => {
  const event = (id, type, data) => ({ id, type, created: 1, data: { sessionID: "s", assistantMessageID: "m", id: "t", ...data } })
  let run = applySessionEvent(undefined, event("1", "session.tool.input.started", { name: "shell" }))
  run = applySessionEvent(run, event("2", "session.tool.called", { input: { command: "echo hi" } }))
  expect(Object.values(run.tools)[0].output).toBeUndefined()
  run = applySessionEvent(run, event("3", "session.tool.success", { content: [{ type: "text", text: "hi" }, { type: "file", uri: "file:///x", mime: "text/plain" }] }))
  expect(Object.values(run.tools)[0]).toMatchObject({ input: { command: "echo hi" }, output: "hi", status: "completed", files: [{ type: "file", uri: "file:///x", mime: "text/plain" }] })
  run = applySessionEvent(run, event("4", "session.tool.failed", { error: { message: "failed" }, content: [{ type: "text", text: "stderr" }] }))
  expect(Object.values(run.tools)[0]).toMatchObject({ output: "stderr", status: "error" })
})
