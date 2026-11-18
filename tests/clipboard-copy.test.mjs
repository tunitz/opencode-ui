import { expect, test } from "bun:test"

import { copyText } from "../src/lib/clipboard"

function withFallbackEnv(execResult) {
  const calls = { commands: [], selected: false, removed: false }
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
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
    value: undefined,
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      activeElement: null,
      body: { appendChild() {} },
      createElement() {
        return textarea
      },
      execCommand(command) {
        calls.commands.push(command)
        return execResult
      },
    },
  })

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
  const env = withFallbackEnv(true)
  try {
    await copyText("docker exec control-center-1")
    expect(env.calls.commands).toEqual(["copy"])
    expect(env.textarea.value).toBe("docker exec control-center-1")
    expect(env.calls.selected).toBe(true)
    expect(env.calls.removed).toBe(true)
  } finally {
    env.restore()
  }
})

test("rejects and cleans up when no clipboard mechanism succeeds", async () => {
  const env = withFallbackEnv(false)
  try {
    await expect(copyText("hello")).rejects.toThrow()
    expect(env.calls.removed).toBe(true)
  } finally {
    env.restore()
  }
})
