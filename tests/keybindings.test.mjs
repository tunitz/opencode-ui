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

// ---------------------------------------------------------------------------
// Settings → Keys renders shortcuts as a table whose key cells capture combos.
// ---------------------------------------------------------------------------

const nodeText = (node) =>
  (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : nodeText(child)))
    .join("")

function fakeBrowser() {
  const windowListeners = new Map()
  const documentListeners = new Map()
  const entries = new Map()
  const register = (registry) => (type, handler) => {
    const handlers = registry.get(type) ?? new Set()
    handlers.add(handler)
    registry.set(type, handlers)
  }
  const unregister = (registry) => (type, handler) => {
    registry.get(type)?.delete(handler)
  }
  const storage = {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  }
  const fakeWindow = {
    location: { origin: "https://ui.test" },
    localStorage: storage,
    addEventListener: register(windowListeners),
    removeEventListener: unregister(windowListeners),
    dispatchEvent(event) {
      for (const handler of windowListeners.get(event.type) ?? []) handler(event)
    },
  }
  const fakeDocument = {
    addEventListener: register(documentListeners),
    removeEventListener: unregister(documentListeners),
  }
  return {
    window: fakeWindow,
    document: fakeDocument,
    storage,
    entries,
    windowListeners,
    documentListeners,
  }
}

async function mountKeybindings() {
  const browser = fakeBrowser()
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  globalThis.window = browser.window
  globalThis.localStorage = browser.storage
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const React = await import("react")
  const { act } = React
  const { create } = await import("react-test-renderer")
  const { KeybindingsSettings } = await import(
    "../src/components/keybindings-settings"
  )

  // Import first: Base UI chooses its layout-effect implementation from
  // `typeof document` at module load, so the fake document must come later.
  globalThis.document = browser.document

  let root
  await act(async () => {
    root = create(React.createElement(KeybindingsSettings))
  })
  await act(async () => {
    await Promise.resolve()
  })

  return {
    browser,
    root,
    act,
    storageKey: keybindingStorageKey("https://ui.test"),
    async restore() {
      if (root) await act(async () => root.unmount())
      for (const [name, value] of Object.entries(previous)) {
        const key = name === "act" ? "IS_REACT_ACT_ENVIRONMENT" : name
        if (value === undefined) delete globalThis[key]
        else globalThis[key] = value
      }
    },
  }
}

const keyCells = (root) =>
  root.root
    .findAllByType("button")
    .filter((node) =>
      /^(Change keybind for|Press keys for) /.test(node.props["aria-label"] ?? "")
    )

const storedBindings = (browser, storageKey) => {
  const raw = browser.storage.getItem(storageKey)
  return raw === null ? null : JSON.parse(raw)
}

const dispatchKey = async (browser, act, overrides = {}) => {
  const handlers = [...(browser.windowListeners.get("keydown") ?? [])]
  const event = {
    key: "p",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {},
    ...overrides,
  }
  await act(async () => {
    for (const handler of handlers) handler(event)
  })
  return event
}

const dispatchMouseDown = async (browser, act, target) => {
  const handlers = [...(browser.documentListeners.get("mousedown") ?? [])]
  await act(async () => {
    for (const handler of handlers) handler({ target })
  })
}

describe("keybindings table", () => {
  test("renders one row per shortcut with header, scope, and key cells", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root } = mounted
      const table = root.root.findByProps({ role: "table" })
      expect(table.props["aria-label"]).toBe("Keyboard shortcuts")

      expect(
        root.root.findAllByProps({ role: "columnheader" }).map(nodeText)
      ).toEqual(["Shortcut", "Scope", "Keys"])
      expect(root.root.findAllByProps({ role: "row" })).toHaveLength(5)
      expect(root.root.findAllByProps({ role: "cell" })).toHaveLength(12)

      // The old per-row button is gone; the key cell is the control.
      expect(
        root.root.findAllByType("button").filter((node) => nodeText(node) === "Change")
      ).toHaveLength(0)
      expect(keyCells(root)).toHaveLength(4)
      expect(keyCells(root)[0].props["aria-label"]).toBe(
        "Change keybind for Open inspector Command, currently Mod+K"
      )
      expect(keyCells(root)[3].props["aria-label"]).toBe(
        "Change keybind for Send and start a fresh draft, currently Mod+Enter"
      )
      expect(
        keyCells(root).map((node) => nodeText(node.findAllByType("kbd")[0]))
      ).toEqual(["Mod+K", "Mod+F", "Mod+S", "Mod+Enter"])
      // Every key cell keeps a 44px target.
      for (const cell of keyCells(root)) {
        expect(cell.props.className).toContain("min-h-11")
      }
    } finally {
      await mounted.restore()
    }
  })

  test("a captured combo auto-saves and swaps the cell to the new shortcut", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser, storageKey } = mounted
      await act(async () => keyCells(root)[0].props.onClick())
      expect(JSON.stringify(root.toJSON())).toContain("Press keys…")
      expect(keyCells(root)[0].props["aria-label"]).toBe(
        "Press keys for Open inspector Command"
      )

      const event = await dispatchKey(browser, act, {
        key: "p",
        metaKey: true,
        shiftKey: true,
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(event.defaultPrevented).toBe(true)
      expect(storedBindings(browser, storageKey)[0]).toEqual({
        command: "command.open",
        key: "p",
        mod: true,
        ctrl: false,
        alt: false,
        shift: true,
        when: "global",
      })
      expect(keyCells(root)).toHaveLength(4)
      expect(keyCells(root)[0].props["aria-label"]).toBe(
        "Change keybind for Open inspector Command, currently Mod+Shift+P"
      )
      expect(JSON.stringify(root.toJSON())).not.toContain("Press keys…")
    } finally {
      await mounted.restore()
    }
  })

  test("Escape cancels capture and writes nothing", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser, storageKey } = mounted
      await act(async () => keyCells(root)[1].props.onClick())
      expect(JSON.stringify(root.toJSON())).toContain("Press keys…")

      await dispatchKey(browser, act, { key: "Escape" })
      expect(JSON.stringify(root.toJSON())).not.toContain("Press keys…")
      expect(storedBindings(browser, storageKey)).toBeNull()
      expect(keyCells(root)[1].props["aria-label"]).toBe(
        "Change keybind for Find in conversation, currently Mod+F"
      )
    } finally {
      await mounted.restore()
    }
  })

  test("a press outside the capturing cell cancels without saving", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser, storageKey } = mounted
      await act(async () => keyCells(root)[2].props.onClick())
      expect(JSON.stringify(root.toJSON())).toContain("Press keys…")

      await dispatchMouseDown(browser, act, { nodeType: 1 })
      expect(JSON.stringify(root.toJSON())).not.toContain("Press keys…")
      expect(storedBindings(browser, storageKey)).toBeNull()
      expect(keyCells(root)[2].props["aria-label"]).toBe(
        "Change keybind for Stash draft, currently Mod+S"
      )
    } finally {
      await mounted.restore()
    }
  })

  test("a conflicting combo is reported in its row and never persisted", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser, storageKey } = mounted
      // Send and start a fresh draft shares the composer scope with Stash draft.
      await act(async () => keyCells(root)[3].props.onClick())
      await dispatchKey(browser, act, { key: "s", metaKey: true })

      const alerts = root.root
        .findAllByProps({ role: "alert" })
        .map(nodeText)
        .filter((value) => value.length > 0)
      expect(alerts).toContain("Conflicts with Stash draft.")
      expect(storedBindings(browser, storageKey)).toBeNull()
      expect(JSON.stringify(root.toJSON())).toContain("Resolve duplicate shortcuts")
    } finally {
      await mounted.restore()
    }
  })

  test("Reset stays a separate control that clears stored overrides", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser, storageKey } = mounted
      await act(async () => keyCells(root)[0].props.onClick())
      await dispatchKey(browser, act, { key: "p", metaKey: true })
      expect(storedBindings(browser, storageKey)).not.toBeNull()

      const resetButton = root.root
        .findAllByType("button")
        .find((node) => nodeText(node) === "Reset")
      await act(async () => resetButton.props.onClick())
      await act(async () => {
        await Promise.resolve()
      })

      expect(browser.entries.has(storageKey)).toBe(false)
      expect(keyCells(root)[0].props["aria-label"]).toBe(
        "Change keybind for Open inspector Command, currently Mod+K"
      )
    } finally {
      await mounted.restore()
    }
  })
})

// ---------------------------------------------------------------------------
// Settings → Keys layout: one compact line per shortcut on narrow containers,
// no debug signature line, and a live announcement when a combo auto-saves.
// ---------------------------------------------------------------------------

const renderedText = (node) => {
  if (node === null || node === undefined) return ""
  if (typeof node === "string") return node
  return (node.children ?? []).map(renderedText).join("")
}

const statusTexts = (root) =>
  root.root.findAllByProps({ role: "status" }).map(nodeText)

describe("keybindings layout", () => {
  test("renders no debug signature line anywhere", async () => {
    const mounted = await mountKeybindings()
    try {
      const text = renderedText(mounted.root.toJSON())
      expect(text).not.toContain('["')
      expect(text).not.toContain("·")
      // The stored signature format starts with the command key, e.g. ["k",…
      expect(text).not.toMatch(/\["\w+","(global|conversation|composer)"/)
    } finally {
      await mounted.restore()
    }
  })

  test("keeps every shortcut on one compact line below 40rem", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root } = mounted
      const rows = root.root.findAllByProps({ role: "row" }).slice(1)
      expect(rows).toHaveLength(4)

      const expected = [
        ["Open inspector Command", "Works anywhere outside a dialog.", "global"],
        ["Find in conversation", "Works when the conversation or inspector has focus.", "conversation"],
        ["Stash draft", "In the composer; empty composer opens the stash menu.", "composer"],
        [
          "Send and start a fresh draft",
          "In the composer; sends and leaves a fresh draft (same admission as Send).",
          "composer",
        ],
      ]

      rows.forEach((row, index) => {
        const className = row.props.className
        // Mobile: three columns on one line, tight vertical padding.
        expect(className).toContain("grid-cols-[minmax(0,1fr)_auto_auto]")
        expect(className).toContain("items-center")
        expect(className).toContain("py-2.5")
        expect(className).not.toContain("gap-y")
        // Desktop keeps the aligned header columns.
        expect(className).toContain(
          "@min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,7rem)_auto]"
        )

        const cells = row.findAllByProps({ role: "cell" })
        expect(cells).toHaveLength(3)
        // The label cell no longer spans both columns, so nothing stacks under it.
        expect(cells[0].props.className).not.toContain("col-span")
        expect(nodeText(cells[0])).toContain(expected[index][0])
        expect(nodeText(cells[0])).toContain(expected[index][1])
        // Scope and key sit beside each other at the end of the same line.
        expect(nodeText(cells[1])).toBe(expected[index][2])
        expect(nodeText(cells[2])).toMatch(/^Mod\+/)

        const button = cells[2].findByType("button")
        expect(button.props.className).toContain("min-h-11")
      })

      const source = await Bun.file(
        new URL("../src/components/keybindings-settings.tsx", import.meta.url)
      ).text()
      expect(source).not.toContain("keybindingSignature")
      expect(source).not.toContain("·")
      expect(source).toContain("grid-cols-[minmax(0,1fr)_auto_auto]")
      expect(source).toContain("py-2.5")
    } finally {
      await mounted.restore()
    }
  })

  test("announces the saved combo and command without visible signature text", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser, storageKey } = mounted
      expect(statusTexts(root)).not.toContain(
        "Saved Mod+P for Open inspector Command."
      )

      await act(async () => keyCells(root)[0].props.onClick())
      expect(statusTexts(root)).toContain(
        "Press keys for Open inspector Command. Escape cancels."
      )

      await dispatchKey(browser, act, { key: "p", metaKey: true })
      expect(statusTexts(root)).toContain(
        "Saved Mod+P for Open inspector Command."
      )
      expect(storedBindings(browser, storageKey)[0].key).toBe("p")
      // The announcement lives in the sr-only live region, not as visible text.
      const announcement = root.root
        .findAllByProps({ role: "status" })
        .find((node) => nodeText(node) === "Saved Mod+P for Open inspector Command.")
      expect(announcement.props.className).toContain("sr-only")
    } finally {
      await mounted.restore()
    }
  })

  test("does not announce a save for a conflicting combo", async () => {
    const mounted = await mountKeybindings()
    try {
      const { root, act, browser } = mounted
      await act(async () => keyCells(root)[3].props.onClick())
      await dispatchKey(browser, act, { key: "s", metaKey: true })

      expect(
        statusTexts(root).some((text) => text.startsWith("Saved "))
      ).toBe(false)
      expect(
        root.root.findAllByProps({ role: "alert" }).map(nodeText)
      ).toContain("Conflicts with Stash draft.")
    } finally {
      await mounted.restore()
    }
  })
})
