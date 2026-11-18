import { expect, test } from "bun:test"
import { applySessionEvent, emptyLiveRun } from "../src/lib/session-events.ts"

const delta = (id, text = "x") => ({
  id,
  type: "session.text.delta",
  created: 0,
  data: { assistantMessageID: "assistant", ordinal: 0, delta: text },
})

test("event ids are deduped with a bounded insertion-ordered set", () => {
  let run = emptyLiveRun()
  expect(run.seen).toBeInstanceOf(Set)

  for (let index = 0; index < 513; index += 1) {
    run = applySessionEvent(run, delta(`event-${index}`))
  }

  // SEEN_WINDOW = 256: only the most recent ids survive the trim.
  expect(run.seen.size).toBe(256)
  expect(run.seen.has("event-512")).toBe(true)
  expect(run.seen.has("event-0")).toBe(false)
})

test("a replayed recent event is dropped; an evicted old id is accepted", () => {
  let run = emptyLiveRun()
  for (let index = 0; index < 513; index += 1) {
    run = applySessionEvent(run, delta(`event-${index}`))
  }

  const before = run.texts["text:assistant:0"].text
  expect(applySessionEvent(run, delta("event-512", "recent"))).toBe(run)

  const revived = applySessionEvent(run, delta("event-0", "old"))
  expect(revived).not.toBe(run)
  expect(revived.texts["text:assistant:0"].text).toBe(`${before}old`)
})

test("a duplicate event never changes the run", () => {
  const first = applySessionEvent(undefined, delta("one", "A"))
  const second = applySessionEvent(first, delta("one", "B"))
  expect(second).toBe(first)
  expect(second.texts["text:assistant:0"].text).toBe("A")
})
