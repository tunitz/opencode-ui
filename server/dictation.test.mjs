import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { Dictation } from "../src/components/dictation"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test("dictation starts only on click, emits final text and aborts on unmount", async () => {
  let current
  class FakeRecognition {
    constructor() { current = this }
    start() { this.started = true }
    stop() { this.stopped = true }
    abort() { this.aborted = true }
  }
  globalThis.window = { SpeechRecognition: FakeRecognition }
  const texts = []
  let view
  await act(async () => { view = create(React.createElement(Dictation, { enabled: true, onText: (text) => texts.push(text) })) })
  expect(current).toBeUndefined()
  await act(async () => { view.root.findByType("button").props.onClick() })
  expect(current.started).toBe(true)
  await act(async () => { current.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "interim" } }, { isFinal: true, 0: { transcript: "hello" } }] }) })
  expect(texts).toEqual(["hello"])
  await act(async () => { view.unmount() })
  expect(current.aborted).toBe(true)
  expect(current.onresult).toBeNull()
  delete globalThis.window
})

test("unsupported browser offers disabled fallback", async () => {
  globalThis.window = {}
  let view
  await act(async () => { view = create(React.createElement(Dictation, { enabled: true, onText: () => {} })) })
  expect(view.root.findByType("button").props.disabled).toBe(true)
  expect(JSON.stringify(view.toJSON())).toContain("unavailable")
  await act(async () => { view.unmount() })
  delete globalThis.window
})
