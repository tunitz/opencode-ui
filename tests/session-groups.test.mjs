import { expect, test } from "bun:test"

import {
  SESSION_GROUPS,
  groupSessionsByUpdated,
  sessionGroupForUpdated,
} from "../src/lib/session-activity.ts"

const now = new Date("2026-11-20T15:00:00").getTime()
const today = new Date("2026-11-20T00:00:00").getTime()
const yesterday = new Date("2026-11-19T23:59:59").getTime()

test("sessions use Today and Previous buckets only", () => {
  expect(SESSION_GROUPS).toEqual(["Today", "Previous"])
  expect(sessionGroupForUpdated(today, now)).toBe("Today")
  expect(sessionGroupForUpdated(yesterday, now)).toBe("Previous")
})

test("grouping keeps newest-first order inside each bucket", () => {
  const groups = groupSessionsByUpdated(
    [
      { id: "old", time: { updated: yesterday - 10_000 } },
      { id: "recent-old", time: { updated: yesterday } },
      { id: "today", time: { updated: today + 1_000 } },
    ],
    now
  )
  expect(groups.Today.map((session) => session.id)).toEqual(["today"])
  expect(groups.Previous.map((session) => session.id)).toEqual([
    "recent-old",
    "old",
  ])
})
