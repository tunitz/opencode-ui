import { describe, expect, test } from "bun:test"

import {
  INSPECTOR_TAB_IDS,
  inspectorStorageKey,
  normalizeChangesScope,
  normalizeInspectorTab,
  parseInspectorTabs,
  readInspectorTab,
  readInspectorTabs,
  writeInspectorTab,
} from "../src/lib/inspector-tabs.ts"

function memoryStorage(initial = {}) {
  const values = { ...initial }
  return {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value
    },
    dump: () => values,
  }
}

describe("inspector tab workspace", () => {
  test("exports the five ordered tabs and normalizes unknown history", () => {
    expect(INSPECTOR_TAB_IDS).toEqual([
      "command",
      "files",
      "changes",
      "activity",
      "session",
    ])
    for (const id of INSPECTOR_TAB_IDS) {
      expect(normalizeInspectorTab(id)).toBe(id)
    }
    expect(normalizeInspectorTab("old-activity")).toBe("command")
    expect(normalizeInspectorTab(null)).toBe("command")
    expect(normalizeInspectorTab("__proto__")).toBe("command")
    expect(normalizeChangesScope("turn")).toBe("turn")
    expect(normalizeChangesScope("nope")).toBe("working")
  })

  test("scopes storage by origin", () => {
    expect(inspectorStorageKey("https://a")).not.toBe(
      inspectorStorageKey("https://b")
    )
  })

  test("parses only valid sessions and tabs", () => {
    const raw = JSON.stringify({
      version: 1,
      tabs: {
        s1: "activity",
        s2: "bogus",
        __proto__: "files",
        "": "files",
        s3: 7,
      },
    })
    expect(parseInspectorTabs(raw)).toEqual({ s1: "activity" })
    expect(parseInspectorTabs("{")).toEqual({})
    expect(parseInspectorTabs(JSON.stringify({ version: 2, tabs: { s1: "files" } }))).toEqual({})
  })

  test("reads and writes a per-session tab without clobbering others", () => {
    const storage = memoryStorage()
    expect(writeInspectorTab("s1", "files", storage, "o")).toBe(true)
    expect(writeInspectorTab("s2", "session", storage, "o")).toBe(true)
    expect(readInspectorTab("s1", storage, "o")).toBe("files")
    expect(readInspectorTab("s2", storage, "o")).toBe("session")
    expect(readInspectorTab("missing", storage, "o")).toBe("command")
    expect(readInspectorTabs(storage, "o")).toEqual({
      s1: "files",
      s2: "session",
    })
  })

  test("refuses unsafe IDs and unavailable storage without throwing", () => {
    expect(writeInspectorTab("__proto__", "files", memoryStorage(), "o")).toBe(false)
    expect(writeInspectorTab("s", "files", null, "o")).toBe(false)
    expect(readInspectorTab("__proto__", memoryStorage(), "o")).toBe("command")
    expect(readInspectorTabs(null, "o")).toEqual({})
    const throwing = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }
    expect(readInspectorTabs(throwing, "o")).toEqual({})
    expect(writeInspectorTab("s", "files", throwing, "o")).toBe(false)
  })
})
