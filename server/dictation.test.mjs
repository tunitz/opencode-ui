import { afterAll, expect, mock, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The unit test exercises dictation behavior, not Base UI's floating tooltip.
// The real tooltip and its accessible disclosure are covered in the browser
// fixture; here it is reduced to its trigger.
mock.module("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ render, children }) => React.cloneElement(render, null, children),
  TooltipContent: () => null,
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
}))

const { Dictation } = await import("../src/components/dictation")

afterAll(() => {
  mock.restore()
})

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
  const errors = []
  let view
  await act(async () => {
    view = create(
      React.createElement(Dictation, {
        enabled: true,
        onText: (text) => texts.push(text),
        onError: (message) => errors.push(message),
      })
    )
  })
  expect(current).toBeUndefined()
  const button = view.root.findByType("button")
  expect(button.props["aria-label"]).toBe("Dictate")
  const description = view.root.findAll(
    (node) => node.props.id === button.props["aria-describedby"]
  )[0]
  expect(JSON.stringify(description.children)).toContain("may send audio")
  await act(async () => { button.props.onClick() })
  expect(current.started).toBe(true)
  expect(errors).toEqual([null])
  await act(async () => { current.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "interim" } }, { isFinal: true, 0: { transcript: "hello" } }] }) })
  expect(texts).toEqual(["hello"])
  await act(async () => { current.onerror({ error: "not-allowed" }) })
  expect(errors.at(-1)).toContain("not-allowed")
  await act(async () => { view.unmount() })
  expect(current.aborted).toBe(true)
  expect(current.onresult).toBeNull()
  delete globalThis.window
})

test("unsupported browsers render no persistent dictation control", async () => {
  globalThis.window = {}
  let view
  await act(async () => {
    view = create(
      React.createElement(Dictation, {
        enabled: true,
        onText: () => {},
        onError: () => {},
      })
    )
  })
  expect(view.toJSON()).toBeNull()
  await act(async () => { view.unmount() })
  delete globalThis.window
})

test("privacy disclosure stays assistive-only instead of a persistent description row", async () => {
  class FakeRecognition {
    start() {}
    stop() {}
    abort() {}
  }
  globalThis.window = { SpeechRecognition: FakeRecognition }
  let view
  await act(async () => {
    view = create(
      React.createElement(Dictation, {
        enabled: true,
        onText: () => {},
        onError: () => {},
      })
    )
  })
  expect(view.root.findAllByType("p")).toHaveLength(0)
  const disclosure = view.root.findAll(
    (node) => node.props.className === "sr-only"
  )
  expect(disclosure).toHaveLength(1)
  expect(JSON.stringify(disclosure[0].children)).toContain("may send audio")
  await act(async () => { view.unmount() })
  delete globalThis.window
})
