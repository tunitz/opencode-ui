import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createStreamWatchdog } from "../src/lib/stream-watchdog.ts"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("the chat event stream uses the watchdog to reconnect and refetch", () => {
  const source = readFileSync(
    new URL("../src/lib/use-opencode.ts", import.meta.url),
    "utf8"
  )
  expect(source).toContain("createStreamWatchdog")
  expect(source).toContain("watchdog.arm()")
  expect(source).toContain("setWakeKey((current) => current + 1)")
  expect(source).toContain("scheduleReconnect(true)")
  expect(source).toContain("watchdog.dispose()")
})

test("chat stream watchdog fires once after a silent deadline", async () => {
  let stale = 0
  const watchdog = createStreamWatchdog(() => { stale += 1 }, 30)
  try {
    watchdog.arm()
    await sleep(70)
    expect(stale).toBe(1)
  } finally {
    watchdog.dispose()
  }
})

test("each received frame resets the chat stream watchdog deadline", async () => {
  let stale = 0
  const watchdog = createStreamWatchdog(() => { stale += 1 }, 40)
  try {
    watchdog.arm()
    await sleep(15)
    watchdog.arm()
    await sleep(20)
    expect(stale).toBe(0)
    await sleep(35)
    expect(stale).toBe(1)
  } finally {
    watchdog.dispose()
  }
})

test("disposing the watchdog cancels a pending stale check", async () => {
  let stale = 0
  const watchdog = createStreamWatchdog(() => { stale += 1 }, 20)
  watchdog.arm()
  watchdog.dispose()
  await sleep(50)
  expect(stale).toBe(0)
  watchdog.arm()
  expect(stale).toBe(0)
})
