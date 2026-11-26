import { describe, expect, test } from "bun:test"
import {
  RECALL_LIMIT,
  STASH_LIMIT,
  STASH_PREVIEW_LIMIT,
  cycleRecall,
  promptHistoryStorageKey,
  promptStashStorageKey,
  readPromptHistory,
  readPromptStash,
  recordPrompt,
  removeStashedPrompt,
  stashPreview,
  stashPrompt,
} from "../src/lib/prompt-recall"

const ORIGIN = "https://ui.example:5175"
const VERSION = "2.1.4"
const SESSION = "ses_prompt_recall"

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

describe("storage keys", () => {
  test("are deterministic and scoped to origin, backend version and session", () => {
    const key = promptHistoryStorageKey(ORIGIN, VERSION, SESSION)

    expect(key).toBe(promptHistoryStorageKey(ORIGIN, VERSION, SESSION))
    expect(key).not.toBe(promptHistoryStorageKey("https://other.example", VERSION, SESSION))
    expect(key).not.toBe(promptHistoryStorageKey(ORIGIN, "9.9.9", SESSION))
    expect(key).not.toBe(promptHistoryStorageKey(ORIGIN, VERSION, "ses_other"))
    expect(key).not.toBe(promptStashStorageKey(ORIGIN, VERSION, SESSION))
    expect(key).toContain(encodeURIComponent(ORIGIN))
    expect(key).toContain(encodeURIComponent(SESSION))
  })

  test("reject unsafe or oversized session ids", () => {
    for (const id of ["__proto__", "constructor", "prototype"]) {
      expect(() => promptHistoryStorageKey(ORIGIN, VERSION, id)).toThrow(TypeError)
      expect(() => promptStashStorageKey(ORIGIN, VERSION, id)).toThrow(TypeError)
      expect(() => recordPrompt(null, ORIGIN, VERSION, id, "hello")).toThrow(TypeError)
    }

    expect(() => promptHistoryStorageKey(ORIGIN, VERSION, "x".repeat(257))).toThrow(TypeError)
    expect(promptHistoryStorageKey(ORIGIN, VERSION, "x".repeat(256))).toContain(encodeURIComponent("x".repeat(256)))
  })
})

describe("prompt history", () => {
  test("records newest first and moves exact duplicates to the front", () => {
    const storage = createStorage()

    recordPrompt(storage, ORIGIN, VERSION, SESSION, "first")
    recordPrompt(storage, ORIGIN, VERSION, SESSION, "second")
    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual(["second", "first"])

    recordPrompt(storage, ORIGIN, VERSION, SESSION, "first")
    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual(["first", "second"])
  })

  test("stores exact text and only trims for the emptiness check", () => {
    const storage = createStorage()
    const exact = "  keep   inner\tspacing\nand blank lines  "

    recordPrompt(storage, ORIGIN, VERSION, SESSION, exact)
    recordPrompt(storage, ORIGIN, VERSION, SESSION, " spaced ")
    recordPrompt(storage, ORIGIN, VERSION, SESSION, "spaced")
    recordPrompt(storage, ORIGIN, VERSION, SESSION, "   ")

    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual(["spaced", " spaced ", exact])
  })

  test("caps recall history at the newest entries", () => {
    const storage = createStorage()

    for (let i = 0; i < RECALL_LIMIT + 10; i += 1) {
      recordPrompt(storage, ORIGIN, VERSION, SESSION, `p${i}`)
    }

    const history = readPromptHistory(storage, ORIGIN, VERSION, SESSION)

    expect(history).toHaveLength(RECALL_LIMIT)
    expect(history[0]).toBe(`p${RECALL_LIMIT + 9}`)
    expect(history.at(-1)).toBe("p10")
  })

  test("treats missing, corrupt, unknown-version and malformed entries as empty", () => {
    const storage = createStorage()
    const key = promptHistoryStorageKey(ORIGIN, VERSION, SESSION)

    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual([])

    storage.setItem(key, "{")
    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual([])

    storage.setItem(key, JSON.stringify({ version: 2, entries: ["a"] }))
    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual([])

    storage.setItem(key, JSON.stringify({ version: 1, entries: "a" }))
    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual([])

    storage.setItem(key, JSON.stringify({ version: 1, entries: ["a", 3, " ", null, "b"] }))
    expect(readPromptHistory(storage, ORIGIN, VERSION, SESSION)).toEqual(["a", "b"])
  })

  test("never throws on denied storage and still returns the in-memory result", () => {
    const deniedRead = {
      getItem() {
        throw new Error("denied")
      },
      setItem() {
        throw new Error("denied")
      },
    }

    expect(readPromptHistory(deniedRead, ORIGIN, VERSION, SESSION)).toEqual([])
    expect(recordPrompt(deniedRead, ORIGIN, VERSION, SESSION, "hello")).toEqual(["hello"])

    const deniedWrite = createStorage()

    deniedWrite.setItem = () => {
      throw new Error("quota exceeded")
    }

    expect(recordPrompt(deniedWrite, ORIGIN, VERSION, SESSION, "kept in memory")).toEqual(["kept in memory"])
    expect(readPromptHistory(null, ORIGIN, VERSION, SESSION)).toEqual([])
    expect(recordPrompt(null, ORIGIN, VERSION, SESSION, "still kept")).toEqual(["still kept"])
  })
})

describe("cycleRecall", () => {
  test("walks older prompts and stops at the oldest", () => {
    const history = ["a", "b", "c"]

    expect(cycleRecall(history, -1, "older")).toEqual({ index: 0, text: "a" })
    expect(cycleRecall(history, 0, "older")).toEqual({ index: 1, text: "b" })
    expect(cycleRecall(history, 1, "older")).toEqual({ index: 2, text: "c" })
    expect(cycleRecall(history, 2, "older")).toEqual({ index: 2, text: "c" })
  })

  test("walks newer prompts and clears past the newest", () => {
    const history = ["a", "b", "c"]

    expect(cycleRecall(history, -1, "newer")).toEqual({ index: -1, text: null })
    expect(cycleRecall(history, 0, "newer")).toEqual({ index: -1, text: null })
    expect(cycleRecall(history, 1, "newer")).toEqual({ index: 0, text: "a" })
    expect(cycleRecall(history, 2, "newer")).toEqual({ index: 1, text: "b" })
  })

  test("stays put when history is empty or has one entry", () => {
    expect(cycleRecall([], -1, "older")).toEqual({ index: -1, text: null })
    expect(cycleRecall([], -1, "newer")).toEqual({ index: -1, text: null })
    expect(cycleRecall(["only"], -1, "older")).toEqual({ index: 0, text: "only" })
    expect(cycleRecall(["only"], 0, "older")).toEqual({ index: 0, text: "only" })
    expect(cycleRecall(["only"], 0, "newer")).toEqual({ index: -1, text: null })
  })
})

describe("prompt stash", () => {
  test("stores newest first with timestamps and exact text", () => {
    const storage = createStorage()

    let stash = stashPrompt(storage, ORIGIN, VERSION, SESSION, "  first  ", 1000)
    expect(stash).toHaveLength(1)
    expect(stash[0].text).toBe("  first  ")
    expect(stash[0].createdAt).toBe(1000)
    expect(stash[0].id).toContain("1000-")

    stash = stashPrompt(storage, ORIGIN, VERSION, SESSION, "second", 1001)
    expect(stash.map((entry) => entry.text)).toEqual(["second", "  first  "])
    expect(readPromptStash(storage, ORIGIN, VERSION, SESSION)).toEqual(stash)
  })

  test("allows duplicate text and unique ids for stashes in the same millisecond", () => {
    const storage = createStorage()

    const one = stashPrompt(storage, ORIGIN, VERSION, SESSION, "same", 500)
    const two = stashPrompt(storage, ORIGIN, VERSION, SESSION, "same", 500)

    expect(two.map((entry) => entry.text)).toEqual(["same", "same"])
    expect(one[0].id).not.toBe(two[0].id)
  })

  test("ignores whitespace-only stashes", () => {
    const storage = createStorage()
    const before = stashPrompt(storage, ORIGIN, VERSION, SESSION, "kept", 1)

    expect(stashPrompt(storage, ORIGIN, VERSION, SESSION, "   \n\t ", 2)).toEqual(before)
    expect(readPromptStash(storage, ORIGIN, VERSION, SESSION)).toEqual(before)
  })

  test("caps the stash at the newest entries", () => {
    const storage = createStorage()

    for (let i = 0; i < STASH_LIMIT + 5; i += 1) {
      stashPrompt(storage, ORIGIN, VERSION, SESSION, `s${i}`, 2000 + i)
    }

    const stash = readPromptStash(storage, ORIGIN, VERSION, SESSION)

    expect(stash).toHaveLength(STASH_LIMIT)
    expect(stash[0].text).toBe(`s${STASH_LIMIT + 4}`)
    expect(stash.at(-1).text).toBe("s5")
  })

  test("drops malformed stored entries and ignores extra fields", () => {
    const storage = createStorage()
    const key = promptStashStorageKey(ORIGIN, VERSION, SESSION)

    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        entries: [
          null,
          "text",
          { id: "x", text: "ok", createdAt: 1 },
          { id: "y", text: "   ", createdAt: 1 },
          { id: "z", text: "ok", createdAt: "nope" },
          { id: "", text: "ok", createdAt: 1 },
          { id: "w", text: "later", createdAt: 2, secret: "ignored" },
        ],
      })
    )

    expect(readPromptStash(storage, ORIGIN, VERSION, SESSION)).toEqual([
      { id: "x", text: "ok", createdAt: 1 },
      { id: "w", text: "later", createdAt: 2 },
    ])

    storage.setItem(key, "{")
    expect(readPromptStash(storage, ORIGIN, VERSION, SESSION)).toEqual([])

    storage.setItem(key, JSON.stringify({ version: 7, entries: [] }))
    expect(readPromptStash(storage, ORIGIN, VERSION, SESSION)).toEqual([])
  })

  test("removes one stash by id and tolerates unknown ids", () => {
    const storage = createStorage()

    const first = stashPrompt(storage, ORIGIN, VERSION, SESSION, "first", 1)
    stashPrompt(storage, ORIGIN, VERSION, SESSION, "second", 2)

    const remaining = removeStashedPrompt(storage, ORIGIN, VERSION, SESSION, first[0].id)

    expect(remaining.map((entry) => entry.text)).toEqual(["second"])
    expect(readPromptStash(storage, ORIGIN, VERSION, SESSION)).toEqual(remaining)
    expect(removeStashedPrompt(storage, ORIGIN, VERSION, SESSION, "missing-id")).toEqual(remaining)
  })

  test("never throws on corrupt or denied storage", () => {
    const deniedRead = {
      getItem() {
        throw new Error("denied")
      },
      setItem() {
        throw new Error("denied")
      },
    }

    expect(readPromptStash(deniedRead, ORIGIN, VERSION, SESSION)).toEqual([])
    expect(stashPrompt(deniedRead, ORIGIN, VERSION, SESSION, "memory only", 10)).toEqual([
      { id: "10-0", text: "memory only", createdAt: 10 },
    ])

    const deniedWrite = createStorage()
    deniedWrite.setItem = () => {
      throw new Error("quota exceeded")
    }

    const stash = stashPrompt(deniedWrite, ORIGIN, VERSION, SESSION, "kept", 11)
    expect(stash.map((entry) => entry.text)).toEqual(["kept"])
    expect(readPromptStash(null, ORIGIN, VERSION, SESSION)).toEqual([])
  })
})

describe("stashPreview", () => {
  test("collapses whitespace runs and trims", () => {
    expect(stashPreview("  hello   world \n\t next  ")).toBe("hello world next")
    expect(stashPreview(" \n\t ")).toBe("")
    expect(stashPreview("")).toBe("")
  })

  test("truncates only when longer than the preview limit", () => {
    expect(stashPreview("a".repeat(STASH_PREVIEW_LIMIT))).toBe("a".repeat(STASH_PREVIEW_LIMIT))
    expect(stashPreview("a".repeat(STASH_PREVIEW_LIMIT + 1))).toBe(`${"a".repeat(STASH_PREVIEW_LIMIT)}…`)
    expect(stashPreview(`${"b".repeat(59)} ${"c".repeat(60)}`)).toBe(`${"b".repeat(59)} ${"c".repeat(60)}`)
    expect(stashPreview(`${"b".repeat(59)}  ${"c".repeat(60)}`)).toBe(`${"b".repeat(59)} ${"c".repeat(60)}`)
  })
})
