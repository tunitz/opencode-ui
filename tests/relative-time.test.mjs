import { expect, test } from "bun:test"

import {
  fullActivityTime,
  relativeActivityTime,
} from "../src/lib/relative-time.ts"

const now = new Date("2026-11-20T12:00:00").getTime()

test("relativeActivityTime uses short relative labels for recent activity", () => {
  expect(relativeActivityTime(now - 30_000, now)).toMatch(/s|now/)
  expect(relativeActivityTime(now - 5 * 60_000, now)).toMatch(/m/)
  expect(relativeActivityTime(now - 3 * 3_600_000, now)).toMatch(/h/)
  expect(relativeActivityTime(now - 2 * 86_400_000, now)).toMatch(/d/)
})

test("relativeActivityTime falls back to a localized date for old activity", () => {
  const label = relativeActivityTime(now - 90 * 86_400_000, now)
  expect(label).not.toMatch(/^[0-9]+/)
  expect(fullActivityTime(now)).toContain("2026")
})
