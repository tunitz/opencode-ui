import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test"

// Product modules reach browser globals at import time; install the smallest
// surface the coordinator needs.
const previousWindow = globalThis.window
const previousDocument = globalThis.document
globalThis.window = {
  location: { origin: "http://localhost" },
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
}

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")

const { WorkspaceProvider, useWorkspace } = await import(
  "../src/components/workspace-context"
)

afterAll(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
})

let previousActEnvironment

beforeEach(() => {
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.document = {
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
  }
})

afterEach(() => {
  if (previousActEnvironment === undefined) {
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  } else {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  }
})

const text = (node) =>
  (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("")
const click = async (root, id) => {
  await act(async () => root.root.findByProps({ id }).props.onClick())
}
const state = (root, id) => text(root.root.findByProps({ id }))

function Harness({ log, returnFocusTarget }) {
  const workspace = useWorkspace()
  const transition = (id) =>
    workspace.requestWorkspace(id, {
      onCommit: () => log.push(`${id}:commit`),
      run: () => log.push(`${id}:run`),
    })
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("span", { id: "active" }, workspace.active),
    ["notes", "settings"].map((id) =>
      React.createElement(
        "button",
        { key: id, id, type: "button", onClick: () => transition(id) },
        id
      )
    ),
    React.createElement(
      "button",
      {
        id: "settings-with-return",
        type: "button",
        onClick: () =>
          workspace.requestWorkspace("settings", {
            returnFocus: returnFocusTarget,
          }),
      },
      "settings with return focus"
    ),
    React.createElement(
      "button",
      { id: "back", type: "button", onClick: () => transition("chat") },
      "chat"
    ),
    React.createElement(
      "button",
      { id: "force-chat", type: "button", onClick: () => workspace.forceWorkspace("chat") },
      "force chat"
    )
  )
}

async function mount(options = {}) {
  const log = []
  let root
  await act(async () => {
    root = create(
      React.createElement(
        WorkspaceProvider,
        null,
        React.createElement(Harness, { log, ...options })
      )
    )
  })
  return { root, log }
}

test("chat is the initial workspace and transitions commit callbacks in order", async () => {
  const { root, log } = await mount()
  try {
    expect(state(root, "active")).toBe("chat")

    await click(root, "notes")
    expect(state(root, "active")).toBe("notes")
    expect(log).toEqual(["notes:commit", "notes:run"])

    await click(root, "settings")
    expect(state(root, "active")).toBe("settings")
    expect(log.at(-2)).toBe("settings:commit")
    expect(log.at(-1)).toBe("settings:run")

    // Re-requesting the active workspace still runs its callbacks.
    log.length = 0
    await click(root, "settings")
    expect(state(root, "active")).toBe("settings")
    expect(log).toEqual(["settings:commit", "settings:run"])

    await click(root, "back")
    expect(state(root, "active")).toBe("chat")
    expect(log.at(-2)).toBe("chat:commit")
    expect(log.at(-1)).toBe("chat:run")
  } finally {
    await act(async () => root.unmount())
  }
})

test("forceWorkspace commits directly without running transition callbacks", async () => {
  const { root, log } = await mount()
  try {
    await click(root, "settings")
    log.length = 0
    await click(root, "force-chat")
    expect(state(root, "active")).toBe("chat")
    expect(log).toEqual([])
  } finally {
    await act(async () => root.unmount())
  }
})

test("focus enters the workspace pane and returns to the originating trigger", async () => {
  const trigger = { isConnected: true, focus: mock(() => {}) }
  const pane = { isConnected: true, focus: mock(() => {}) }
  globalThis.document = {
    activeElement: trigger,
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    querySelector: (selector) =>
      selector === '[data-workspace-focus="settings"]' ? pane : null,
  }
  const { root } = await mount()
  try {
    await click(root, "settings")
    expect(pane.focus).toHaveBeenCalledTimes(1)
    expect(trigger.focus).toHaveBeenCalledTimes(0)

    await click(root, "back")
    expect(trigger.focus).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
  }
})

test("an explicit returnFocus overrides the captured trigger", async () => {
  const trigger = { isConnected: true, focus: mock(() => {}) }
  const explicit = { isConnected: true, focus: mock(() => {}) }
  const pane = { isConnected: true, focus: mock(() => {}) }
  globalThis.document = {
    activeElement: trigger,
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    querySelector: (selector) =>
      selector === '[data-workspace-focus="settings"]' ? pane : null,
  }
  const { root } = await mount({ returnFocusTarget: explicit })
  try {
    await click(root, "settings-with-return")
    expect(pane.focus).toHaveBeenCalledTimes(1)

    await click(root, "back")
    expect(explicit.focus).toHaveBeenCalledTimes(1)
    expect(trigger.focus).toHaveBeenCalledTimes(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test("returning from a workspace ignores body as the return target", async () => {
  const body = { focus: mock(() => {}) }
  const chatMain = { isConnected: true, focus: mock(() => {}) }
  const pane = { isConnected: true, focus: mock(() => {}) }
  globalThis.document = {
    activeElement: body,
    body,
    documentElement: body,
    addEventListener() {},
    removeEventListener() {},
    getElementById: (id) => (id === "chat-main" ? chatMain : null),
    querySelector: (selector) =>
      selector === '[data-workspace-focus="settings"]' ? pane : null,
  }
  const { root } = await mount()
  try {
    await click(root, "settings")
    await click(root, "back")
    expect(chatMain.focus).toHaveBeenCalledTimes(1)
    expect(body.focus).toHaveBeenCalledTimes(0)
  } finally {
    await act(async () => root.unmount())
  }
})
