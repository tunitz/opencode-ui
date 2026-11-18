import { expect, mock, test } from "bun:test"
import { act, cloneElement, createElement } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
}

const copyText = mock(async () => {})
mock.module("@/lib/clipboard", () => ({ copyText }))

mock.module("@/components/ui/button", () => ({
  Button: ({ children, ...props }) =>
    createElement("button", { type: "button", ...props }, children),
}))
mock.module("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }) => createElement("div", null, children),
  TooltipTrigger: ({ render, children, ...props }) =>
    render
      ? cloneElement(render, props)
      : createElement("button", { type: "button", ...props }, children),
  TooltipContent: ({ children }) => createElement("span", null, children),
}))

const { create } = await import("react-test-renderer")
const { CopyMessageAction } = await import("../src/components/conversation")

const buttonOf = (root) => root.root.findAllByType("button")[0]

async function settle(times = 2) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {})
  }
}

test("CopyMessageAction copies through copyText and shows Copied", async () => {
  copyText.mockImplementation(async () => {})
  let root
  try {
    await act(async () => {
      root = create(createElement(CopyMessageAction, { value: "hello message" }))
    })
    expect(buttonOf(root).props["aria-label"]).toBe("Copy message")

    await act(async () => {
      buttonOf(root).props.onClick()
    })
    await settle()

    expect(copyText).toHaveBeenCalledWith("hello message")
    expect(buttonOf(root).props["aria-label"]).toBe("Copied")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("CopyMessageAction surfaces a failure state instead of silently doing nothing", async () => {
  copyText.mockImplementation(async () => {
    throw new Error("Clipboard unavailable")
  })
  let root
  try {
    await act(async () => {
      root = create(createElement(CopyMessageAction, { value: "hello message" }))
    })
    await act(async () => {
      buttonOf(root).props.onClick()
    })
    await settle()

    const button = buttonOf(root)
    expect(button.props["aria-label"]).toBe("Copy failed")
    expect(button.props["title"]).toBe(
      "Could not copy — select the message and copy manually"
    )
    expect(JSON.stringify(root.toJSON())).toContain(
      "Could not copy. Select the message and copy manually."
    )
  } finally {
    if (root) await act(async () => root.unmount())
  }
})
