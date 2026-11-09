import { describe, expect, test } from "bun:test"
import {
  KEYBINDING_COMMANDS,
  KEYBINDING_STORAGE_PREFIX,
  defaultKeybindings,
  findKeybindingConflicts,
  keybindingSignature,
  keybindingStorageKey,
  matchesKeybinding,
  parseKeybindings,
  readKeybindings,
  resetKeybindings,
  writeKeybindings,
} from "../src/lib/keybindings.ts"

function binding(overrides = {}) {
  return {
    command: "command.open",
    key: "k",
    mod: true,
    ctrl: false,
    alt: false,
    shift: false,
    when: "global",
    ...overrides,
  }
}

function keyboardEvent(overrides = {}) {
  return {
    key: "k",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }
}

function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

const EXPECTED_DEFAULTS = [
  { command: "command.open", key: "k", mod: true, ctrl: false, alt: false, shift: false, when: "global" },
  { command: "find.open", key: "f", mod: true, ctrl: false, alt: false, shift: false, when: "conversation" },
  { command: "composer.stash", key: "s", mod: true, ctrl: false, alt: false, shift: false, when: "composer" },
  { command: "composer.backgroundSend", key: "Enter", mod: true, ctrl: false, alt: false, shift: false, when: "composer" },
]

describe("default keybindings", () => {
  test("exposes the four documented commands and defaults", () => {
    expect([...KEYBINDING_COMMANDS]).toEqual([
      "command.open",
      "find.open",
      "composer.stash",
      "composer.backgroundSend",
    ])
    expect(defaultKeybindings()).toEqual(EXPECTED_DEFAULTS)
  })

  test("returns fresh objects so callers cannot mutate later defaults", () => {
    const snapshot = defaultKeybindings()
    const mutable = defaultKeybindings()
    mutable[0].key = "x"
    mutable[0].mod = false
    mutable.length = 0

    expect(defaultKeybindings()).toEqual(snapshot)
    expect(defaultKeybindings()[0]).not.toBe(snapshot[0])
  })
})

describe("parsing stored keybindings", () => {
  test("treats empty, malformed, and non-array payloads as defaults", () => {
    for (const raw of [null, "", "   ", "{", "null", "{}", "[]", '"k"', "42"]) {
      expect(parseKeybindings(raw)).toEqual(EXPECTED_DEFAULTS)
    }
  })

  test("accepts a partial payload and fills missing commands from defaults", () => {
    const parsed = parseKeybindings(
      JSON.stringify([binding({ key: "  P  ", shift: true })])
    )

    expect(parsed).toHaveLength(4)
    expect(parsed[0]).toEqual(binding({ key: "P", shift: true }))
    expect(parsed.slice(1)).toEqual(EXPECTED_DEFAULTS.slice(1))
  })

  test("keeps named keys while trimming surrounding whitespace", () => {
    const parsed = parseKeybindings(
      JSON.stringify([binding({ command: "composer.backgroundSend", key: " Enter ", when: "composer" })])
    )

    expect(parsed[3]).toEqual(
      binding({ command: "composer.backgroundSend", key: "Enter", when: "composer" })
    )
  })

  test("rejects duplicate commands and keeps the first valid entry", () => {
    const parsed = parseKeybindings(
      JSON.stringify([binding({ key: "p" }), binding({ key: "q" })])
    )

    expect(parsed[0].key).toBe("p")
  })

  test("ignores unsafe commands and invalid fields", () => {
    const invalid = [
      binding({ command: "__proto__", key: "p" }),
      binding({ key: "" }),
      binding({ key: "   " }),
      binding({ key: "x".repeat(21) }),
      binding({ key: undefined }),
      binding({ mod: 1 }),
      binding({ ctrl: "false" }),
      binding({ alt: null }),
      binding({ shift: 0 }),
      binding({ when: "editor" }),
      binding({ command: "unknown.command" }),
      null,
      "k",
      [],
    ]

    expect(parseKeybindings(JSON.stringify(invalid))).toEqual(EXPECTED_DEFAULTS)
    expect(parseKeybindings('{"__proto__":{"command":"command.open"}}')).toEqual(EXPECTED_DEFAULTS)
  })
})

describe("scoped storage", () => {
  test("keys storage by origin and keeps the versioned prefix", () => {
    expect(keybindingStorageKey("https://a")).toBe(
      `${KEYBINDING_STORAGE_PREFIX}:${encodeURIComponent("https://a")}`
    )
    expect(keybindingStorageKey("https://a")).not.toBe(keybindingStorageKey("https://b"))
    expect(keybindingStorageKey("https://a")).toBe(keybindingStorageKey("https://a"))
  })

  test("reads, writes, and resets through origin-scoped storage", () => {
    const storage = memoryStorage()

    expect(readKeybindings(storage, "https://a")).toEqual(EXPECTED_DEFAULTS)

    const custom = defaultKeybindings()
    custom[0] = { ...custom[0], key: "p", shift: true }
    expect(writeKeybindings(storage, "https://a", custom)).toBe(true)
    expect(storage.entries.has(keybindingStorageKey("https://a"))).toBe(true)
    expect(readKeybindings(storage, "https://a")).toEqual(custom)
    expect(readKeybindings(storage, "https://b")).toEqual(EXPECTED_DEFAULTS)

    expect(resetKeybindings(storage, "https://a")).toEqual(EXPECTED_DEFAULTS)
    expect(storage.entries.has(keybindingStorageKey("https://a"))).toBe(false)
    expect(readKeybindings(storage, "https://a")).toEqual(EXPECTED_DEFAULTS)
  })

  test("reports unavailable storage and survives throwing implementations", () => {
    expect(readKeybindings(null, "https://a")).toEqual(EXPECTED_DEFAULTS)
    expect(writeKeybindings(null, "https://a", defaultKeybindings())).toBe(false)
    expect(resetKeybindings(null, "https://a")).toEqual(EXPECTED_DEFAULTS)

    expect(
      readKeybindings({ getItem: () => { throw new Error("denied") } }, "https://a")
    ).toEqual(EXPECTED_DEFAULTS)
    expect(
      writeKeybindings({ setItem: () => { throw new Error("denied") } }, "https://a", defaultKeybindings())
    ).toBe(false)
    expect(
      resetKeybindings({ removeItem: () => { throw new Error("denied") } }, "https://a")
    ).toEqual(EXPECTED_DEFAULTS)
    expect(resetKeybindings({ getItem: () => null, setItem: () => {} }, "https://a")).toEqual(
      EXPECTED_DEFAULTS
    )
  })

  test("parses corrupt stored data as defaults", () => {
    const storage = memoryStorage({
      [keybindingStorageKey("https://a")]: "{not json",
    })

    expect(readKeybindings(storage, "https://a")).toEqual(EXPECTED_DEFAULTS)
  })
})

describe("conflict detection", () => {
  test("reports the same command once without also reporting the pair as a combo", () => {
    const a = binding({ key: "p" })
    const b = binding({ key: "q" })
    const conflicts = findKeybindingConflicts([a, b])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toEqual({ a, b, reason: "same-command" })
  })

  test("reports identical combos used by different commands", () => {
    const a = binding({ command: "command.open", key: "x", when: "global" })
    const b = binding({ command: "find.open", key: "x", when: "global" })
    const conflicts = findKeybindingConflicts([a, b])

    expect(conflicts).toEqual([{ a, b, reason: "same-combo" }])
  })

  test("does not report a pair twice when several bindings collide", () => {
    const x = binding({ command: "command.open", key: "x", when: "global" })
    const y = binding({ command: "find.open", key: "x", when: "global" })
    const z = binding({ command: "composer.stash", key: "x", when: "global" })

    expect(findKeybindingConflicts([x, y, z])).toHaveLength(3)
  })

  test("compares single characters case-insensitively but named keys exactly", () => {
    const upper = binding({ command: "command.open", key: "K" })
    const lower = binding({ command: "find.open", key: "k", when: "global" })
    expect(findKeybindingConflicts([upper, lower])).toEqual([
      { a: upper, b: lower, reason: "same-combo" },
    ])

    const enter = binding({ command: "composer.stash", key: "Enter", when: "composer" })
    const lowerEnter = binding({
      command: "composer.backgroundSend",
      key: "enter",
      when: "composer",
    })
    expect(findKeybindingConflicts([enter, lowerEnter])).toEqual([])
  })

  test("respects scope and modifier differences", () => {
    const global = binding({ command: "command.open", key: "x", when: "global" })
    const composer = binding({ command: "find.open", key: "x", when: "composer" })
    const shifted = binding({ command: "find.open", key: "x", shift: true })
    expect(findKeybindingConflicts([global, composer])).toEqual([])
    expect(findKeybindingConflicts([global, shifted])).toEqual([])
  })
})

describe("signatures", () => {
  test("is stable and ignores modifier order of construction", () => {
    const base = binding({ key: "K" })
    expect(keybindingSignature(base)).toBe(keybindingSignature({ ...base }))
    expect(keybindingSignature(base)).toBe(keybindingSignature({ ...base, key: "k" }))
  })

  test("distinguishes named-key case, modifiers, and scope", () => {
    const base = binding({ key: "Enter" })
    expect(keybindingSignature(base)).not.toBe(keybindingSignature({ ...base, key: "enter" }))
    expect(keybindingSignature(base)).not.toBe(keybindingSignature({ ...base, mod: false }))
    expect(keybindingSignature(base)).not.toBe(keybindingSignature({ ...base, ctrl: true }))
    expect(keybindingSignature(base)).not.toBe(keybindingSignature({ ...base, alt: true }))
    expect(keybindingSignature(base)).not.toBe(keybindingSignature({ ...base, shift: true }))
    expect(keybindingSignature(base)).not.toBe(
      keybindingSignature({ ...base, when: "composer" })
    )
  })
})

describe("event matching", () => {
  test("maps mod to Cmd on macOS and requires an exact modifier set", () => {
    const command = binding({ key: "k", mod: true })

    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true }), command, "mac")).toBe(true)
    expect(matchesKeybinding(keyboardEvent({ key: "K", metaKey: true }), command, "mac")).toBe(true)
    expect(matchesKeybinding(keyboardEvent({ key: "k", ctrlKey: true }), command, "mac")).toBe(false)
    expect(
      matchesKeybinding(keyboardEvent({ key: "k", metaKey: true, ctrlKey: true }), command, "mac")
    ).toBe(false)
    expect(
      matchesKeybinding(keyboardEvent({ key: "k", metaKey: true, shiftKey: true }), command, "mac")
    ).toBe(false)
    expect(
      matchesKeybinding(keyboardEvent({ key: "k", metaKey: true, altKey: true }), command, "mac")
    ).toBe(false)
  })

  test("maps mod to Ctrl elsewhere and rejects Meta", () => {
    const command = binding({ key: "k", mod: true })

    expect(matchesKeybinding(keyboardEvent({ key: "k", ctrlKey: true }), command, "other")).toBe(true)
    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true }), command, "other")).toBe(false)
    expect(
      matchesKeybinding(keyboardEvent({ key: "k", metaKey: true, ctrlKey: true }), command, "other")
    ).toBe(false)
    expect(matchesKeybinding(keyboardEvent({ key: "k" }), command, "other")).toBe(false)
  })

  test("honours explicit ctrl, alt, and shift modifiers", () => {
    const command = binding({ key: "k", mod: false, ctrl: true })
    expect(matchesKeybinding(keyboardEvent({ key: "k", ctrlKey: true }), command, "other")).toBe(true)
    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true }), command, "other")).toBe(false)
    expect(matchesKeybinding(keyboardEvent({ key: "k", ctrlKey: true }), command, "mac")).toBe(true)

    const shifted = binding({ key: "k", shift: true })
    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true, shiftKey: true }), shifted, "mac")).toBe(
      true
    )
    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true }), shifted, "mac")).toBe(false)

    const alt = binding({ key: "k", alt: true })
    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true, altKey: true }), alt, "mac")).toBe(true)
    expect(matchesKeybinding(keyboardEvent({ key: "k", metaKey: true }), alt, "mac")).toBe(false)
  })

  test("compares single characters case-insensitively and named keys exactly", () => {
    const enter = binding({
      command: "composer.backgroundSend",
      key: "Enter",
      when: "composer",
    })
    expect(matchesKeybinding(keyboardEvent({ key: "Enter", metaKey: true }), enter, "mac")).toBe(true)
    expect(matchesKeybinding(keyboardEvent({ key: "enter", metaKey: true }), enter, "mac")).toBe(false)

    const slash = binding({ key: "/" })
    expect(matchesKeybinding(keyboardEvent({ key: "/", metaKey: true }), slash, "mac")).toBe(true)
  })
})
