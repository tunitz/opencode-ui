import { expect, test } from "bun:test"
import { isCommandShortcut, isComposerFocusShortcut } from "../src/lib/command-center-shortcuts.ts"

test("composer shortcut respects IME, keyboard modifiers and blocked surfaces", () => {
  const key = { key: "C", keyCode: 67, ctrlKey: false, metaKey: false, altKey: true, shiftKey: true, isComposing: false, repeat: false, defaultPrevented: false }
  expect(isComposerFocusShortcut(key, false)).toBe(true)
  expect(isComposerFocusShortcut(key, true)).toBe(false)
  for (const change of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }, { altKey: false }, { shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { key: "k" }]) {
    expect(isComposerFocusShortcut({ ...key, ...change }, false)).toBe(false)
  }
  expect(isCommandShortcut({ ...key, key: "k", altKey: false, shiftKey: false, ctrlKey: true }, false)).toBe(true)
})
