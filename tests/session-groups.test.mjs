import { expect, test } from "bun:test"

import {
  SESSION_GROUPS,
  groupSessionsByUpdated,
  sessionGroupForUpdated,
} from "../src/lib/session-activity.ts"

const yesterday = new Date("2026-11-19T23:59:59").getTime()
const today = new Date("2026-11-20T00:00:00").getTime()

test("sessions use a single Recent bucket", () => {
  expect(SESSION_GROUPS).toEqual(["Recent"])
  expect(sessionGroupForUpdated()).toBe("Recent")
})

test("grouping keeps newest-first order inside Recent", () => {
  const groups = groupSessionsByUpdated([
    { id: "old", time: { updated: yesterday - 10_000 } },
    { id: "recent-old", time: { updated: yesterday } },
    { id: "today", time: { updated: today + 1_000 } },
  ])
  expect(groups.Recent.map((session) => session.id)).toEqual([
    "today",
    "recent-old",
    "old",
  ])
})
