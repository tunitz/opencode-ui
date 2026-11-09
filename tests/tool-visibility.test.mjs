import { expect, test } from "bun:test"

import {
  TOOL_VISIBILITY_MODES,
  TOOL_VISIBILITY_STORAGE_PREFIX,
  groupTools,
  normalizeToolVisibility,
  readToolVisibility,
  shouldHideIntermediateText,
  shouldShowTool,
  toolVisibilityLabel,
  toolVisibilityStorageKey,
  visibleTools,
  writeToolVisibility,
} from "../src/lib/tool-visibility"

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

test("normalizes known modes and falls back to all for anything else", () => {
  expect(TOOL_VISIBILITY_MODES).toEqual(["all", "hide-successful", "hide-all", "zen"])
  for (const mode of TOOL_VISIBILITY_MODES) {
    expect(normalizeToolVisibility(mode)).toBe(mode)
  }
  expect(normalizeToolVisibility(null)).toBe("all")
  expect(normalizeToolVisibility(undefined)).toBe("all")
  expect(normalizeToolVisibility("")).toBe("all")
  expect(normalizeToolVisibility("hide")).toBe("all")
  expect(normalizeToolVisibility("ALL")).toBe("all")
  expect(normalizeToolVisibility(" zen")).toBe("all")
})

test("labels each mode", () => {
  expect(toolVisibilityLabel("all")).toBe("All tools")
  expect(toolVisibilityLabel("hide-successful")).toBe("Hide successful")
  expect(toolVisibilityLabel("hide-all")).toBe("Hide all tools")
  expect(toolVisibilityLabel("zen")).toBe("Zen")
})

test("storage keys are scoped by origin and backend version", () => {
  const key = toolVisibilityStorageKey("http://host:5175", "2.1.4")

  expect(key).toBe(
    `${TOOL_VISIBILITY_STORAGE_PREFIX}:${encodeURIComponent("http://host:5175")}:${encodeURIComponent("2.1.4")}`
  )
  expect(key).toContain("http%3A%2F%2Fhost%3A5175")
  expect(toolVisibilityStorageKey("http://host:5175", "2.1.4")).toBe(key)
  expect(toolVisibilityStorageKey("http://other:5175", "2.1.4")).not.toBe(key)
  expect(toolVisibilityStorageKey("http://host:5175", "2.1.5")).not.toBe(key)
})

test("reads fall back to all when storage is absent, empty, corrupt, or throws", () => {
  expect(readToolVisibility(null, "http://host", "1")).toBe("all")

  const store = memoryStorage({
    [toolVisibilityStorageKey("http://host", "1")]: "zen",
  })
  expect(readToolVisibility(store, "http://host", "1")).toBe("zen")
  expect(readToolVisibility(store, "http://host", "2")).toBe("all")

  expect(
    readToolVisibility(
      memoryStorage({ [toolVisibilityStorageKey("http://host", "1")]: "not-a-mode" }),
      "http://host",
      "1"
    )
  ).toBe("all")

  const throwing = {
    getItem: () => {
      throw new Error("denied")
    },
  }
  expect(readToolVisibility(throwing, "http://host", "1")).toBe("all")
})

test("writes return true on success and false when unavailable", () => {
  const store = memoryStorage()
  expect(writeToolVisibility(store, "http://host", "1", "hide-successful")).toBe(true)
  expect(store.values.get(toolVisibilityStorageKey("http://host", "1"))).toBe("hide-successful")
  expect(readToolVisibility(store, "http://host", "1")).toBe("hide-successful")

  expect(writeToolVisibility(null, "http://host", "1", "zen")).toBe(false)

  const throwing = {
    setItem: () => {
      throw new Error("quota")
    },
  }
  expect(writeToolVisibility(throwing, "http://host", "1", "zen")).toBe(false)
})

test("shouldShowTool follows the mode truth table", () => {
  expect(shouldShowTool("all", "running")).toBe(true)
  expect(shouldShowTool("all", "completed")).toBe(true)
  expect(shouldShowTool("all", "error")).toBe(true)

  expect(shouldShowTool("hide-successful", "running")).toBe(true)
  expect(shouldShowTool("hide-successful", "completed")).toBe(false)
  expect(shouldShowTool("hide-successful", "error")).toBe(true)

  expect(shouldShowTool("hide-all", "running")).toBe(false)
  expect(shouldShowTool("hide-all", "completed")).toBe(false)
  expect(shouldShowTool("hide-all", "error")).toBe(false)

  expect(shouldShowTool("zen", "running")).toBe(false)
  expect(shouldShowTool("zen", "completed")).toBe(false)
  expect(shouldShowTool("zen", "error")).toBe(false)
})

test("zen hides interim text only during an active run outside find and the final answer", () => {
  const context = { runActive: true, isFinalAnswer: false, findOpen: false }
  expect(shouldHideIntermediateText("zen", context)).toBe(true)
  expect(shouldHideIntermediateText("zen", { ...context, findOpen: true })).toBe(false)
  expect(shouldHideIntermediateText("zen", { ...context, isFinalAnswer: true })).toBe(false)
  expect(shouldHideIntermediateText("zen", { ...context, runActive: false })).toBe(false)

  for (const mode of ["all", "hide-successful", "hide-all"]) {
    expect(shouldHideIntermediateText(mode, context)).toBe(false)
    expect(shouldHideIntermediateText(mode, { ...context, findOpen: true })).toBe(false)
  }
})

test("groups a contiguous tool run and counts its states", () => {
  const tools = [
    { id: "a", status: "running" },
    { id: "b", status: "completed" },
    { id: "c", status: "completed" },
    { id: "d", status: "error" },
  ]

  const groups = groupTools(tools)
  expect(groups).toHaveLength(1)
  expect(groups[0].key).toBe("tools:a")
  expect(groups[0].tools).toEqual(tools)
  expect(groups[0].tools).not.toBe(tools)
  expect(groups[0].states).toEqual({ running: 1, completed: 2, error: 1 })

  expect(groupTools([])).toEqual([])
})

test("visibleTools filters by mode and preserves order", () => {
  const tools = [
    { id: "a", status: "running" },
    { id: "b", status: "completed" },
    { id: "c", status: "error" },
  ]

  expect(visibleTools("all", tools).map((tool) => tool.id)).toEqual(["a", "b", "c"])
  expect(visibleTools("hide-successful", tools).map((tool) => tool.id)).toEqual(["a", "c"])
  expect(visibleTools("hide-all", tools)).toEqual([])
  expect(visibleTools("zen", tools)).toEqual([])
  expect(visibleTools("all", [])).toEqual([])
})

import { visibleConversationTools } from "../src/lib/tool-visibility"

test("conversation visibility keeps errors and only hides Zen during an active turn", () => {
  const tools = [
    { id: "a", status: "running" },
    { id: "b", status: "completed" },
    { id: "c", status: "error" },
  ]
  expect(visibleConversationTools(tools, "all", true, false).map((tool) => tool.id)).toEqual([
    "a",
    "b",
    "c",
  ])
  expect(
    visibleConversationTools(tools, "hide-successful", false, false).map((tool) => tool.id)
  ).toEqual(["a", "c"])
  expect(visibleConversationTools(tools, "hide-all", false, false).map((tool) => tool.id)).toEqual([
    "c",
  ])
  expect(visibleConversationTools(tools, "zen", true, false).map((tool) => tool.id)).toEqual([
    "c",
  ])
  expect(visibleConversationTools(tools, "zen", true, true).map((tool) => tool.id)).toEqual([
    "a",
    "b",
    "c",
  ])
  expect(visibleConversationTools(tools, "zen", false, false).map((tool) => tool.id)).toEqual([
    "a",
    "b",
    "c",
  ])
})
