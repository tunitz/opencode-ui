import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test"

// Notes are definitively disabled for this suite: the shared registry hook is
// replaced before the provider tree imports.
mock.module("@/lib/notes-plugin-state", () => ({
  useNotesPluginState: () => ({ registered: false, available: true }),
}))

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
const { NotesProvider, useNotesWorkspace } = await import(
  "../src/components/notes-sidebar"
)
const { SettingsProvider, useSettingsWorkspace } = await import(
  "../src/components/settings-context"
)

afterAll(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  mock.restore()
})

let previousActEnvironment

beforeEach(() => {
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.document = {
    activeElement: null,
    body: {},
    documentElement: {},
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

const nav = {
  directory: "/project",
  activeSession: null,
  connection: "connected",
  streamStatus: "ready",
  projects: [],
}

function Harness() {
  const workspace = useWorkspace()
  const notes = useNotesWorkspace()
  const settings = useSettingsWorkspace()
  const pending = settings.confirmChange
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("span", { id: "active" }, workspace.active),
    React.createElement("span", { id: "pending" }, workspace.pendingTarget ?? "none"),
    React.createElement("span", { id: "section" }, settings.section),
    React.createElement("span", { id: "dirty" }, settings.agentDirty ? "dirty" : "clean"),
    React.createElement(
      "span",
      { id: "confirm" },
      pending
        ? pending.kind === "section"
          ? `section:${pending.id}`
          : "close"
        : "none"
    ),
    React.createElement("span", { id: "notes-open" }, notes.open ? "open" : "closed"),
    React.createElement(
      "button",
      { id: "open-settings", type: "button", onClick: () => settings.openSettings() },
      "settings"
    ),
    React.createElement(
      "button",
      { id: "open-workspace", type: "button", onClick: () => workspace.requestWorkspace("notes") },
      "settings"
    ),
    React.createElement(
      "button",
      { id: "open-notes", type: "button", onClick: () => notes.openNotes() },
      "notes"
    ),
    React.createElement(
      "button",
      { id: "open-keys", type: "button", onClick: () => settings.openSettings("keys") },
      "keys"
    ),
    React.createElement(
      "button",
      { id: "mark-dirty", type: "button", onClick: () => settings.setAgentDirty(true) },
      "dirty"
    )
  )
}

async function mount() {
  let root
  await act(async () => {
    root = create(
      React.createElement(
        WorkspaceProvider,
        null,
        React.createElement(
          NotesProvider,
          { nav },
          React.createElement(
            SettingsProvider,
            null,
            React.createElement(Harness)
          )
        )
      )
    )
  })
  return root
}

test("reopening an active dirty Settings keeps edits and routes sections through the guard", async () => {
  const root = await mount()
  try {
    await click(root, "open-settings")
    await click(root, "mark-dirty")
    expect(state(root, "dirty")).toBe("dirty")

    await click(root, "open-keys")
    expect(state(root, "section")).toBe("appearance")
    expect(state(root, "dirty")).toBe("dirty")
    expect(state(root, "confirm")).toBe("section:keys")

    // A plain reopen must not reset the section or discard the pending edit.
    await click(root, "open-settings")
    expect(state(root, "section")).toBe("appearance")
    expect(state(root, "dirty")).toBe("dirty")

    // The shared guard still protects leaving Settings afterwards.
    await click(root, "open-workspace")
    expect(state(root, "active")).toBe("settings")
    expect(state(root, "pending")).toBe("notes")
    expect(state(root, "dirty")).toBe("dirty")
  } finally {
    await act(async () => root.unmount())
  }
})

test("openNotes remains unavailable while the plugin is disabled", async () => {
  const root = await mount()
  try {
    await click(root, "open-notes")
    expect(state(root, "active")).toBe("chat")
    expect(state(root, "notes-open")).toBe("closed")
  } finally {
    await act(async () => root.unmount())
  }
})
