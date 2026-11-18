import { afterAll, expect, mock, test } from "bun:test"
import { act, createElement } from "react"

const previousWindow = globalThis.window
globalThis.window = {
  location: { origin: "http://localhost" },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
}
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_DIR = "/repo/alpha"
const CHILD_DIR = "/repo/alpha/src"
const AGENTS = [
  { id: "build", name: "Build", mode: "primary", hidden: false },
  { id: "plan", name: "Plan", mode: "primary", hidden: false },
]
const AGENT_IDS = AGENTS.map((agent) => agent.id)
const MODELS = [
  {
    id: "deepseek-v4.1-flash-free",
    providerID: "opencode",
    name: "Flash",
    enabled: true,
    status: "active",
    variants: [],
  },
]

const locationGet = mock(async ({ location }) => {
  const directory = location.directory
  if (directory === PROJECT_DIR || directory.startsWith(`${PROJECT_DIR}/`)) {
    return {
      directory,
      project: {
        id: "p-alpha",
        directory: PROJECT_DIR,
        canonical: PROJECT_DIR,
      },
    }
  }
  // Folders above the project root are not registered projects.
  throw new Error(`No project for ${directory}`)
})
const fileList = mock(async ({ location }) => {
  const listings = {
    [PROJECT_DIR]: [{ path: "src", type: "directory" }],
    [CHILD_DIR]: [{ path: "deep", type: "directory" }],
    "/repo": [
      { path: "alpha", type: "directory" },
      { path: "beta", type: "directory" },
    ],
  }
  return { data: listings[location.directory] ?? [] }
})
const agentList = mock(async ({ location }) => ({
  // Only the canonical project directory has a real catalog. Subfolders and
  // parents return an empty catalog, reproducing the reported picker failure.
  data: location.directory === PROJECT_DIR ? AGENTS : [],
}))
const modelList = mock(async ({ location }) => ({
  data: location.directory === PROJECT_DIR ? MODELS : [],
}))

mock.module("@/lib/opencode", () => ({
  openCode: {
    location: { get: locationGet },
    file: { list: fileList },
    agent: { list: agentList },
    model: { list: modelList },
  },
  errorMessage: (failure) => String(failure?.message ?? failure),
}))
mock.module("@/lib/model-favorites", () => ({
  useModelFavorites: () => ({ favorites: new Set(), toggle: () => {} }),
}))
mock.module("@/components/ui/button", () => ({
  Button: ({ children, ...props }) =>
    createElement("button", { type: "button", ...props }, children),
}))
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) =>
    open ? createElement("div", { "data-dialog": true }, children) : null,
  DialogClose: ({ children, render, ...props }) =>
    createElement("button", { type: "button", ...props }, children),
  DialogFooter: ({ children }) => createElement("div", null, children),
  DialogHeader: ({ children }) => createElement("div", null, children),
  DialogTitle: ({ children }) => createElement("div", null, children),
}))
mock.module("@/components/ui/responsive-dialog-content", () => ({
  ResponsiveDialogContent: ({ children }) => createElement("div", null, children),
}))
mock.module("@/components/ui/picker-select", () => ({
  PickerSelect: ({ label, value, options, onValueChange }) =>
    createElement(
      "div",
      { "data-picker": label, "data-value": value },
      ...(options ?? []).map((option) =>
        createElement(
          "button",
          {
            type: "button",
            key: option.value,
            "data-option": option.value,
            onClick: () => onValueChange(option.value),
          },
          option.label
        )
      )
    ),
}))

const { create } = await import("react-test-renderer")
const { NewSessionDialog } = await import(
  "../src/components/new-session-dialog"
)

function nav() {
  return {
    createSession: mock(async () => true),
    configEntries: [],
    connection: "connected",
    creating: false,
    createError: null,
  }
}

async function settle(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {})
  }
}

const textOf = (node) => {
  if (typeof node === "string") return node
  if (!node || typeof node !== "object") return ""
  return [].concat(node.children ?? []).map(textOf).join("")
}
const agentPicker = (root) =>
  root.root.findAll((node) => node.props["data-picker"] === "Agent")[0]
const agentOptionValues = (root) =>
  agentPicker(root)
    .findAll((node) => typeof node.props["data-option"] === "string")
    .map((node) => node.props["data-option"])
const buttonByText = (root, text) =>
  root.root
    .findAll((node) => node.type === "button")
    .find((node) => textOf(node).includes(text))

function expectAgentPickerReady(root, step) {
  const picker = agentPicker(root)
  expect(picker, `${step}: agent picker must be rendered`).toBeDefined()
  expect(agentOptionValues(root), `${step}: agent options must stay selectable`).toEqual(
    AGENT_IDS
  )
}

async function selectDifferentAgent(root, step) {
  const current = agentPicker(root).props["data-value"]
  const next = AGENT_IDS.find((id) => id !== current)
  const option = agentPicker(root).findAll(
    (node) => node.props["data-option"] === next
  )[0]
  expect(option, `${step}: ${next} option must exist`).toBeDefined()
  await act(async () => option.props.onClick())
  expect(
    agentPicker(root).props["data-value"],
    `${step}: selecting an agent must update the value`
  ).toBe(next)
}

afterAll(() => {
  mock.restore()
  if (previousActEnvironment === undefined)
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
  else globalThis.window = previousWindow
})

test("agent picker stays populated while browsing deeper and up to parent folders", async () => {
  let root
  await act(async () => {
    root = create(
      createElement(NewSessionDialog, {
        nav: nav(),
        open: true,
        onOpenChange: () => {},
        initialDirectory: PROJECT_DIR,
      })
    )
  })
  await settle()
  try {
    expectAgentPickerReady(root, "initial project folder")
    await selectDifferentAgent(root, "initial project folder")

    // Deeper: location.get still resolves the project, but agent/model.list
    // for this subfolder return an empty catalog.
    const child = buttonByText(root, "src")
    expect(child, "child folder row must exist").toBeDefined()
    await act(async () => child.props.onClick())
    await settle()
    expectAgentPickerReady(root, "after drilling into subfolder")
    await selectDifferentAgent(root, "after drilling into subfolder")

    // Parent once: back to the project root.
    let parent = buttonByText(root, "Parent folder")
    await act(async () => parent.props.onClick())
    await settle()
    expectAgentPickerReady(root, "after one parent click")
    await selectDifferentAgent(root, "after one parent click")

    // Parent twice: above the project root, where location.get rejects.
    parent = buttonByText(root, "Parent folder")
    await act(async () => parent.props.onClick())
    await settle()
    expectAgentPickerReady(root, "after two parent clicks")
    await selectDifferentAgent(root, "after two parent clicks")

    // Creation stays gated on a resolvable folder even though the picker
    // (agent/model preview) remains bound to the project catalog.
    const createButton = buttonByText(root, "Create session")
    expect(createButton.props.disabled).toBe(true)
    expect(JSON.stringify(root.toJSON())).toContain(
      "Selected session folder unavailable."
    )
  } finally {
    await act(async () => root.unmount())
  }
})
