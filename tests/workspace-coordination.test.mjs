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

// The Base UI dialog needs a real DOM; this suite exercises the transition
// state machine, and the production AlertDialog is covered by Settings tests.
mock.module("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }) => React.createElement(React.Fragment, null, children)
  return {
    AlertDialog: ({ open, children }) =>
      open ? React.createElement("div", { role: "alertdialog" }, children) : null,
    AlertDialogAction: ({ children }) =>
      React.createElement("button", { type: "button" }, children),
    AlertDialogCancel: ({ children }) =>
      React.createElement("button", { type: "button" }, children),
    AlertDialogContent: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
  }
})

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

function Harness({ dirtyRef, log }) {
  const workspace = useWorkspace()
  React.useEffect(
    () => workspace.registerGuard("settings", () => dirtyRef.current),
    [workspace]
  )
  const transition = (id) =>
    workspace.requestWorkspace(id, {
      onCommit: () => log.push(`${id}:commit`),
      run: () => log.push(`${id}:run`),
    })
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("span", { id: "active" }, workspace.active),
    React.createElement("span", { id: "pending" }, workspace.pendingTarget ?? "none"),
      React.createElement(
        "button",
        { key: id, id, type: "button", onClick: () => transition(id) },
        id
      )
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
    ),
    React.createElement(
      "button",
      { id: "confirm", type: "button", onClick: workspace.confirmLeave },
      "Leave anyway"
    ),
    React.createElement(
      "button",
      { id: "keep", type: "button", onClick: workspace.keepEditing },
      "Keep editing"
    )
  )
}

async function mount(dirty = false) {
  const dirtyRef = { current: dirty }
  const log = []
  let root
  await act(async () => {
    root = create(
      React.createElement(
        WorkspaceProvider,
        null,
        React.createElement(Harness, { dirtyRef, log })
      )
    )
  })
  return { root, dirtyRef, log }
}

test("chat is the initial workspace and clean transitions commit immediately", async () => {
  const { root, log } = await mount()
  try {
    expect(state(root, "active")).toBe("chat")
    expect(state(root, "pending")).toBe("none")

    await click(root, "notes")
    expect(state(root, "active")).toBe("notes")
    expect(log).toEqual(["notes:commit", "notes:run"])

    await click(root, "settings")
    expect(state(root, "active")).toBe("settings")


    await click(root, "back")
    expect(state(root, "active")).toBe("chat")
    expect(log.at(-2)).toBe("chat:commit")
    expect(log.at(-1)).toBe("chat:run")
  } finally {
    await act(async () => root.unmount())
  }
})

test("a dirty workspace queues exactly one transition and runs nothing yet", async () => {
  const { root, dirtyRef, log } = await mount()
  try {
    await click(root, "settings")
    log.length = 0
    dirtyRef.current = true

    await click(root, "notes")
    expect(state(root, "active")).toBe("settings")
    expect(state(root, "pending")).toBe("notes")
    expect(log).toEqual([])

    await click(root, "keep")
    expect(state(root, "active")).toBe("settings")
    expect(state(root, "pending")).toBe("none")
    expect(log).toEqual([])

    await click(root, "notes")
    await click(root, "confirm")
    expect(state(root, "active")).toBe("notes")
    expect(state(root, "pending")).toBe("none")
    expect(log).toEqual(["notes:commit", "notes:run"])
  } finally {
    await act(async () => root.unmount())
  }
})

test("the guard belongs to the active workspace only", async () => {
  const { root, dirtyRef, log } = await mount(true)
  try {
    // Dirty Settings left behind: moving from Notes must not prompt.
    await click(root, "notes")
    expect(state(root, "pending")).toBe("none")
    dirtyRef.current = false
  } finally {
    await act(async () => root.unmount())
  }
})

test("forceWorkspace bypasses the guard for a surface that ceased to exist", async () => {
  const { root, dirtyRef } = await mount()
  try {
    await click(root, "settings")
    dirtyRef.current = true
    await click(root, "force-chat")
    expect(state(root, "active")).toBe("chat")
    expect(state(root, "pending")).toBe("none")
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
  }
  const { root } = await mount()
  try {
    expect(pane.focus).toHaveBeenCalledTimes(1)
    expect(trigger.focus).toHaveBeenCalledTimes(0)

    await click(root, "back")
    expect(trigger.focus).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
  }
})

test("a pending confirmation refuses retargeting and same-target work", async () => {
  const { root, dirtyRef, log } = await mount()
  try {
    await click(root, "settings")
    log.length = 0
    dirtyRef.current = true

    await click(root, "notes")
    expect(state(root, "pending")).toBe("notes")

    // Another destination must not silently replace the queued choice.
    expect(state(root, "active")).toBe("settings")
    expect(state(root, "pending")).toBe("notes")
    expect(log).toEqual([])

    // Re-requesting the current workspace must not run its callbacks either.
    await click(root, "settings")
    expect(state(root, "active")).toBe("settings")
    expect(state(root, "pending")).toBe("notes")
    expect(log).toEqual([])

    await click(root, "confirm")
    expect(state(root, "active")).toBe("notes")
    expect(log).toEqual(["notes:commit", "notes:run"])
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
  }
  const { root } = await mount()
  try {
    await click(root, "back")
    expect(chatMain.focus).toHaveBeenCalledTimes(1)
    expect(body.focus).toHaveBeenCalledTimes(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test("the confirmation dialog names the workspace being left", async () => {
  const { root, dirtyRef } = await mount()
  try {
    await click(root, "settings")
    dirtyRef.current = true
    await click(root, "notes")
    const dialog = root.root.findByProps({ role: "alertdialog" })
    expect(text(dialog)).toContain("Leave Settings anyway?")
  } finally {
    await act(async () => root.unmount())
  }
})
