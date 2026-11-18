import { expect, test } from "bun:test"

import { copyText } from "../src/lib/clipboard"

/**
 * Install a minimal DOM/navigator environment for the legacy copy path.
 * `writeText` set to a function installs navigator.clipboard; leaving it
 * undefined simulates a non-secure HTTP/LAN origin. `noExecCommand` removes
 * document.execCommand entirely.
 */
function installClipboardEnv({ writeText, execResult = true, noExecCommand = false } = {}) {
  const calls = {
    commands: [],
    selected: false,
    removed: false,
    focused: false,
    activeRestored: false,
  }
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    focus() {
      calls.focused = true
    },
    select() {
      calls.selected = true
    },
    setSelectionRange() {},
    remove() {
      calls.removed = true
    },
  }
  const previousDocument = globalThis.document
  const nav = globalThis.navigator
  const previousClipboard = Object.getOwnPropertyDescriptor(nav, "clipboard")

  Object.defineProperty(nav, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
  const doc = {
    activeElement: { focus() { calls.activeRestored = true } },
    body: { appendChild() {} },
    createElement() {
      return textarea
    },
  }
  if (!noExecCommand) {
    doc.execCommand = (command) => {
      calls.commands.push(command)
      return execResult
    }
  }
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc })

  return {
    calls,
    textarea,
    restore() {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      })
      if (previousClipboard) {
        Object.defineProperty(nav, "clipboard", previousClipboard)
      } else {
        delete nav.clipboard
      }
    },
  }
}

test("copies via the legacy path when navigator.clipboard is unavailable", async () => {
  const env = installClipboardEnv()
  try {
    await copyText("docker exec control-center-1")
    expect(env.calls.commands).toEqual(["copy"])
    expect(env.textarea.value).toBe("docker exec control-center-1")
    expect(env.calls.focused).toBe(true)
    expect(env.calls.selected).toBe(true)
    expect(env.calls.removed).toBe(true)
    expect(env.calls.activeRestored).toBe(true)
  } finally {
    env.restore()
  }
})

test("falls through to the legacy path when writeText is present but rejects", async () => {
  const env = installClipboardEnv({
    writeText: () => Promise.reject(new Error("NotAllowedError")),
  })
  try {
    await copyText("fallback text")
    expect(env.calls.commands).toEqual(["copy"])
    expect(env.textarea.value).toBe("fallback text")
  } finally {
    env.restore()
  }
})

test("uses navigator.clipboard directly when it succeeds", async () => {
  const writes = []
  const env = installClipboardEnv({
    writeText: (value) => {
      writes.push(value)
      return Promise.resolve()
    },
  })
  try {
    await copyText("native text")
    expect(writes).toEqual(["native text"])
    expect(env.calls.commands).toEqual([])
    expect(env.calls.removed).toBe(false)
  } finally {
    env.restore()
  }
})

test("rejects and cleans up when no clipboard mechanism succeeds", async () => {
  const env = installClipboardEnv({ execResult: false })
  try {
    await expect(copyText("hello")).rejects.toThrow("Clipboard unavailable")
    expect(env.calls.removed).toBe(true)
    expect(env.calls.activeRestored).toBe(true)
  } finally {
    env.restore()
  }
})

test("rejects cleanly when document.execCommand is absent", async () => {
  const env = installClipboardEnv({ noExecCommand: true })
  try {
    await expect(copyText("hello")).rejects.toThrow("Clipboard unavailable")
    expect(env.calls.removed).toBe(true)
    expect(env.calls.activeRestored).toBe(true)
  } finally {
    env.restore()
  }
})
