import { describe, expect, test } from "bun:test"
import { groupSessionShortcuts, parseSessionShortcuts, shortcutStorageKey, updateSessionShortcut } from "../src/lib/session-shortcuts.ts"

describe("browser-local session shortcuts", () => {
  test("scopes metadata by origin and backend version", () => {
    expect(shortcutStorageKey("https://a", "2")).not.toBe(shortcutStorageKey("https://b", "2"))
    expect(shortcutStorageKey("https://a", "2")).not.toBe(shortcutStorageKey("https://a", "3"))
  })
  test("validates corrupted and unsafe stored entries", () => {
    expect(Object.keys(parseSessionShortcuts("{"))).toEqual([])
    const parsed = parseSessionShortcuts('{"__proto__":{"pinned":true},"a":{"pinned":true,"label":" hi "},"b":{"pinned":"yes"}}')
    expect(Object.keys(parsed)).toEqual(["a"])
    expect(parsed.a).toEqual({ pinned: true, label: "hi" })
  })
  test("updates and removes labels independently of pins", () => {
    const pinned = updateSessionShortcut({}, "s", { pinned: true, label: " label " })
    expect(pinned.s).toEqual({ pinned: true, label: "label" })
    const unlabelled = updateSessionShortcut(pinned, "s", { label: " " })
    expect(unlabelled.s).toEqual({ pinned: true, label: "" })
    expect(Object.keys(updateSessionShortcut(unlabelled, "s", { pinned: false }))).toEqual([])
    expect(() => updateSessionShortcut({}, "__proto__", { pinned: true })).toThrow()
  })
  test("uses explicit priority without inventing attention or duplicating sessions", () => {
    const sessions = [{ id: "p" }, { id: "r" }, { id: "u" }, { id: "idle" }]
    const groups = groupSessionShortcuts(sessions, { p: { pinned: true, label: "" } }, { p: true, r: true }, { r: true, u: true })
    expect(groups.Pinned.map((s) => s.id)).toEqual(["p"])
    expect(groups.Running.map((s) => s.id)).toEqual(["r"])
    expect(groups["New activity"].map((s) => s.id)).toEqual(["u"])
    const attention = groupSessionShortcuts(sessions, { p: { pinned: true, label: "" } }, { p: true }, {}, "p")
    expect(attention["Needs attention (current session)"].map((s) => s.id)).toEqual(["p"])
    expect(attention.Pinned).toEqual([])
  })
  test("refuses to silently discard a new entry when the cap is reached", () => {
    const entries = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`s${i}`, { pinned: true, label: "" }]))
    expect(() => updateSessionShortcut(entries, "another", { pinned: true })).toThrow()
  })
})
test("status grouping preserves nested trees and uses the most urgent loaded member", async () => {
  const { groupSessionTreesByStatus } = await import("../src/lib/session-shortcuts.ts")
  const parent = { session: { id: "parent" }, children: [{ session: { id: "child" }, children: [] }] }
  const other = { session: { id: "other" }, children: [] }
  const grouped = groupSessionTreesByStatus([parent, other], {}, { child: true }, { parent: true }, null)
  expect(grouped.Running).toEqual([parent])
  expect(grouped.Other).toEqual([other])
  expect(grouped["New activity"]).toEqual([])
})
