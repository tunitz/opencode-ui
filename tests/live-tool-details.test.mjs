import { expect, test } from "bun:test"

import { liveTool } from "../src/components/conversation"
import { applySessionEvent } from "../src/lib/session-events"

const toolEvent = (seq, type, data = {}) => ({
  id: `event-${seq}`,
  type,
  created: 1,
  data: {
    sessionID: "session",
    assistantMessageID: "assistant",
    id: "tool-1",
    ...data,
  },
})

function onlyLiveTool(run) {
  return liveTool(Object.values(run.tools)[0])
}

test("live tool details retain input and output as events update the call", () => {
  let run = applySessionEvent(
    undefined,
    toolEvent(1, "session.tool.input.started", { name: "shell" })
  )

  const started = onlyLiveTool(run)
  expect(started).toMatchObject({ name: "shell", status: "running", error: null })
  expect(started.input).toBeUndefined()
  expect(started.output).toBeUndefined()

  run = applySessionEvent(
    run,
    toolEvent(2, "session.tool.called", { input: { command: "echo hi" } })
  )
  expect(onlyLiveTool(run)).toMatchObject({
    status: "running",
    input: { command: "echo hi" },
  })

  run = applySessionEvent(run, toolEvent(3, "session.tool.progress"))
  expect(onlyLiveTool(run)).toMatchObject({
    status: "running",
    input: { command: "echo hi" },
  })

  run = applySessionEvent(
    run,
    toolEvent(4, "session.tool.success", {
      content: [{ type: "text", text: "hi" }],
    })
  )
  expect(onlyLiveTool(run)).toMatchObject({
    status: "completed",
    input: { command: "echo hi" },
    output: "hi",
  })

  run = applySessionEvent(
    run,
    toolEvent(5, "session.tool.failed", {
      error: { message: "failed" },
      content: [{ type: "text", text: "stderr" }],
    })
  )
  expect(onlyLiveTool(run)).toMatchObject({
    status: "error",
    input: { command: "echo hi" },
    output: "stderr",
    error: "failed",
  })
})
