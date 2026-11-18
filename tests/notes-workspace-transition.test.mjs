import { afterAll, beforeAll, expect, mock, test } from "bun:test"

const note = {
  id: "one",
  title: "one",
  content: "",
  status: "todo",
  pinned: false,
  spaceID: null,
  revision: 1,
  attachments: [],
}

const adapter = {
  list: async () => ({ notes: [note], spaces: [], workspaceDirectory: "/project" }),
  createNote: async () => note,
  updateNote: async () => note,
  deleteNote: async () => {},
  createSpace: async () => null,
  updateSpace: async () => null,
  deleteSpace: async () => {},
}

const previousWindow = globalThis.window
const previousDocument = globalThis.document
globalThis.window = {
  location: { origin: "http://localhost" },
  matchMedia: () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = {
  activeElement: null,
  body: {},
  documentElement: {},
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
}

// Base UI's floating primitives probe `Element` during layout effects; Bun has
// no DOM constructors, so the test supplies the identity check they need.
class FakeElement {}
class FakeHTMLElement extends FakeElement {}
globalThis.Element = FakeElement
globalThis.HTMLElement = FakeHTMLElement
globalThis.window.Element = FakeElement
globalThis.window.HTMLElement = FakeHTMLElement

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")

mock.module("@/lib/notes-plugin-state", () => ({
  useNotesPluginState: () => ({ registered: true, available: true }),
}))

mock.module("@/lib/notes-api", () => ({
  createNotesAdapter: () => adapter,
  listNotesScoped: async () => ({ notes: [], total: 0 }),
  listSpacesScoped: async () => [],
  setNotesAuthHandler: () => {},
  subscribeNotesEvents: () => () => {},
}))

const { WorkspaceProvider, useWorkspace } = await import(
  "../src/components/workspace-context"
)
const {
  NotesProvider,
  NotesWorkspace,
  useNotesWorkspace,
} = await import("../src/components/notes-sidebar")

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  mock.restore()
})

const nav = {
  directory: "/project",
  activeSession: null,
  connection: "connected",
  streamStatus: "ready",
  projects: [],
}

const text = (node) =>
  (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("")
const button = (root, label) =>
  root.root.findAllByType("button").find((item) => text(item) === label)
const requiredInput = (root) =>
  root.root.findAllByType("input").find((item) => item.props.required)
const flush = async () => {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function Shell() {
  const workspace = useWorkspace()
  const notes = useNotesWorkspace()
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("span", { id: "active" }, workspace.active),
    React.createElement(
      "button",
      { id: "open-notes", type: "button", onClick: () => notes.openNotes("one") },
      "notes"
    ),
    React.createElement(
      "button",
      {
        id: "open-settings",
        type: "button",
        onClick: () => workspace.requestWorkspace("settings"),
      },
      "settings"
    ),
    notes.hasWorkspace
      ? React.createElement(
          "section",
          {
            id: "notes-pane",
            "aria-label": "Notes",
            className: notes.open ? "" : "hidden",
          },
          React.createElement(NotesWorkspace)
        )
      : null
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
          React.createElement(Shell)
        )
      )
    )
  })
  return root
}

test("a note draft survives leaving Notes for Settings and returning", async () => {
  const root = await mount()
  try {
    await act(async () => {
      root.root.findByProps({ id: "open-notes" }).props.onClick()
    })
    await flush()

    await act(async () => {
      root.root.findByProps({ "aria-label": "Open one" }).props.onClick()
    })
    await flush()

    await act(async () => button(root, "Edit").props.onClick())
    const input = requiredInput(root)
    expect(input).toBeDefined()
    await act(async () => {
      input.props.onChange({
        target: { value: "Draft survives" },
        currentTarget: { value: "Draft survives" },
      })
    })
    expect(requiredInput(root).props.value).toBe("Draft survives")

    // Settings takes the pane, but the Notes workspace stays mounted and hidden.
    await act(async () => {
      root.root.findByProps({ id: "open-settings" }).props.onClick()
    })
    expect(text(root.root.findByProps({ id: "active" }))).toBe("settings")
    const pane = root.root.findByProps({ id: "notes-pane" })
    expect(pane.props.className).toBe("hidden")

    // Reopening the same note must not discard the unsaved text.
    await act(async () => {
      root.root.findByProps({ id: "open-notes" }).props.onClick()
    })
    await flush()
    if (!requiredInput(root)) {
      await act(async () => button(root, "Edit").props.onClick())
    }
    expect(requiredInput(root).props.value).toBe("Draft survives")
  } finally {
    await act(async () => root.unmount())
  }
})
