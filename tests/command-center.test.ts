import { describe, expect, test } from "bun:test"
globalThis.window = { location: { origin: "http://localhost" } } as Window &
  typeof globalThis
const { isCommandShortcut, isComposerFocusShortcut, matchesCommand } = await import("../src/components/command-center")

describe("command center search", () => {
  test("matches all search words across labels and details without case sensitivity", () => {
    const entry = { label: "Fix compiler", detail: "Session · My Project" }
    expect(matchesCommand(entry, "PROJECT fix")).toBe(true)
    expect(matchesCommand(entry, "compiler missing")).toBe(false)
    expect(matchesCommand(entry, "  ")).toBe(true)
  })
})

describe("composer focus shortcut", () => {
  const key = { key: "C", keyCode: 67, ctrlKey: false, metaKey: false, altKey: true, shiftKey: true, isComposing: false, repeat: false, defaultPrevented: false }
  test("accepts Alt+Shift+C only in a safe context", () => {
    expect(isComposerFocusShortcut(key, false)).toBe(true)
    expect(isComposerFocusShortcut(key, true)).toBe(false)
    for (const change of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }, { altKey: false }, { shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { key: "k" }]) {
      expect(isComposerFocusShortcut({ ...key, ...change }, false)).toBe(false)
    }
  })
})

describe("command center shortcut", () => {
  const key = {
    key: "k",
    keyCode: 75,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
  }
  test("accepts Ctrl or Meta K only when the context is safe", () => {
    expect(isCommandShortcut(key, false)).toBe(true)
    expect(
      isCommandShortcut(
        { ...key, ctrlKey: false, metaKey: true, key: "K" },
        false
      )
    ).toBe(true)
    expect(isCommandShortcut(key, true)).toBe(false)
    for (const change of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { defaultPrevented: true },
      { altKey: true },
      { shiftKey: true },
      { metaKey: true },
      { ctrlKey: false },
    ]) {
      expect(isCommandShortcut({ ...key, ...change }, false)).toBe(false)
    }
  })
})
