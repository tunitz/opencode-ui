import { expect, test } from "bun:test"

import { mergeRefreshedSessions } from "../src/lib/session-refresh.ts"

const session = (id, title) => ({ id, title, time: { updated: 0 } })

test("a background refresh fills an empty list with the fresh page", () => {
  const fresh = [session("a", "A"), session("b", "B")]
  expect(mergeRefreshedSessions([], fresh)).toBe(fresh)
})

test("a background refresh updates matching rows in place and prepends new ones", () => {
  const current = [
    session("a", "old A"),
    session("b", "old B"),
    session("c", "old C"),
  ]
  const fresh = [session("a", "new A"), session("d", "new D")]

  const merged = mergeRefreshedSessions(current, fresh)

  expect(merged.map((row) => row.id)).toEqual(["d", "a", "b", "c"])
  expect(merged.find((row) => row.id === "a").title).toBe("new A")
  expect(merged.find((row) => row.id === "b").title).toBe("old B")
})

test("pages loaded by infinite scroll survive a background refresh", () => {
  const current = Array.from({ length: 35 }, (_, index) =>
    session(`s${index}`, `title ${index}`)
  )
  const fresh = [session("s0", "refreshed s0"), session("s34", "refreshed s34")]

  const merged = mergeRefreshedSessions(current, fresh)

  expect(merged).toHaveLength(35)
  expect(merged.map((row) => row.id)).toEqual(current.map((row) => row.id))
  expect(merged[0].title).toBe("refreshed s0")
  expect(merged[34].title).toBe("refreshed s34")
})

test("a refresh with no new rows keeps the existing order", () => {
  const current = [session("a", "A"), session("b", "B")]
  const fresh = [session("b", "B2"), session("a", "A2")]

  expect(mergeRefreshedSessions(current, fresh)).toEqual([
    session("a", "A2"),
    session("b", "B2"),
  ])
})
