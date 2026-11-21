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
const BETA_DIR = "/repo/beta"
const BETA_AGENTS = [{ id: "beta-agent", mode: "primary", hidden: false }]
const BETA_MODELS = [
  {
    id: "beta-model",
    providerID: "opencode",
    enabled: true,
    status: "active",
    variants: [],
  },
]
// Nested folders may carry their own .opencode config, agents and models even
// though location.get still resolves them to the same project.
const CHILD_AGENTS = [{ id: "nested-agent", mode: "primary", hidden: false }]
const CHILD_MODELS = [
  {
    id: "nested-model",
    providerID: "opencode",
    enabled: true,
    status: "active",
    variants: [],
  },
]
const AGENTS = [
  { id: "build", name: "Build", mode: "primary", hidden: false },
  { id: "plan", name: "Plan", mode: "primary", hidden: false },
  // Non-primary entries exist in the native catalog but must not be offered
  // for a new top-level session.
  { id: "research", name: "Research", mode: "subagent", hidden: false },
  { id: "review", name: "Review", mode: "all", hidden: false },
  { id: "secret", name: "Secret", mode: "primary", hidden: true },
]
const AGENT_IDS = AGENTS.filter(
  (agent) => agent.mode === "primary" && !agent.hidden
).map((agent) => agent.id)
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
  // The engine normalizes a trailing slash in the submitted folder.
  if (directory === `${PROJECT_DIR}/`) {
    return {
      directory: PROJECT_DIR,
      project: {
        id: "p-alpha",
        directory: PROJECT_DIR,
        canonical: PROJECT_DIR,
      },
    }
  }
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
  if (directory === BETA_DIR) {
    return {
      directory,
      project: {
        id: "p-beta",
        directory: BETA_DIR,
        canonical: BETA_DIR,
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
const catalogFor = (directory) => {
  if (directory === PROJECT_DIR) return { agents: AGENTS, models: MODELS, defaultAgent: null, defaultModel: MODELS[0] }
  if (directory === CHILD_DIR) return { agents: CHILD_AGENTS, models: CHILD_MODELS, defaultAgent: "nested-agent", defaultModel: CHILD_MODELS[0] }
  if (directory === BETA_DIR) return { agents: BETA_AGENTS, models: BETA_MODELS, defaultAgent: null, defaultModel: BETA_MODELS[0] }
  return { agents: [], models: [], defaultAgent: null, defaultModel: null }
}
const agentList = mock(async ({ location }) => ({
  data: catalogFor(location.directory).agents,
}))
const modelList = mock(async ({ location }) => ({
  data: catalogFor(location.directory).models,
}))
const configGet = mock(async ({ location }) => {
  const defaultAgent = catalogFor(location.directory).defaultAgent
  return defaultAgent
    ? [{ type: "document", info: { default_agent: defaultAgent } }]
    : []
})
const modelDefault = mock(async ({ location }) => ({
  data: catalogFor(location.directory).defaultModel,
}))

mock.module("@/lib/connections", () => ({
  ENGINE_CONNECTION_CHANGED: "opencode-ui:engine-connection-changed",
  listConnections: async () => ({ active: null, profiles: [] }),
}))
mock.module("@/lib/opencode", () => ({
  openCode: {
    location: { get: locationGet },
    file: { list: fileList },
    agent: { list: agentList },
    config: { get: configGet },
    model: { list: modelList, default: modelDefault },
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
    // Intentionally different from the destination catalog so a regression
    // that reads the current-location catalog is visible in the picker.
    configEntries: [],
    agents: [{ id: "current-agent", mode: "primary", hidden: false }],
    models: [
      {
        id: "current-model",
        providerID: "current",
        enabled: true,
        status: "active",
        variants: [],
      },
    ],
    agentsStatus: "ready",
    modelsStatus: "ready",
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

test("parent and nested destinations read their own location-scoped catalogs", async () => {
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
  await settle(6)
  const directoryInput = () =>
    root.root.findAll(
      (node) => node.type === "input" && node.props.id === "new-session-directory"
    )[0]
  const browseTo = async (directory) => {
    const input = directoryInput()
    expect(input, "directory input must exist").toBeDefined()
    await act(async () =>
      input.props.onChange({
        target: { value: directory },
        currentTarget: { value: directory },
      })
    )
    await settle(6)
  }
  const modelPicker = () =>
    root.root.findAll((node) => node.props["data-picker"] === "Model")[0]
  const modelOptionValues = () =>
    modelPicker()
      .findAll((node) => typeof node.props["data-option"] === "string")
      .map((node) => node.props["data-option"])
  try {
    // Parent folder: parent agents/models and the engine default model.
    expectAgentPickerReady(root, "parent folder")
    expect(modelOptionValues(root)).toEqual([
      "opencode/deepseek-v4.1-flash-free",
    ])
    expect(modelPicker().props["data-value"]).toBe(
      "opencode/deepseek-v4.1-flash-free"
    )
    expect(buttonByText(root, "Create session").props.disabled).toBe(false)

    // Nested folder: its own config selects a nested agent and model, even
    // though location.get still reports the same project id.
    await browseTo(CHILD_DIR)
    expect(agentOptionValues(root)).toEqual(["nested-agent"])
    expect(agentPicker(root).props["data-value"]).toBe("nested-agent")
    expect(modelOptionValues()).toEqual(["opencode/nested-model"])
    expect(modelPicker().props["data-value"]).toBe("opencode/nested-model")
    expect(buttonByText(root, "Create session").props.disabled).toBe(false)

    // All four catalogs were read at the exact nested destination directory.
    for (const read of [agentList, modelList, configGet, modelDefault]) {
      expect(
        read.mock.calls.some(
          ([arg]) => arg.location.directory === CHILD_DIR
        )
      ).toBe(true)
    }

    // Back to the parent restores the parent catalog.
    await browseTo(PROJECT_DIR)
    expectAgentPickerReady(root, "parent folder again")
    expect(modelPicker().props["data-value"]).toBe(
      "opencode/deepseek-v4.1-flash-free"
    )

    // An unresolvable folder keeps the previous preview visible but never
    // lets that stale catalog authorize creation.
    await browseTo("/repo")
    expect(buttonByText(root, "Create session").props.disabled).toBe(true)
    expect(textOf(root.toJSON())).toContain(
      "Selected session folder unavailable."
    )
  } finally {
    await act(async () => root.unmount())
  }
})

test("an engine-normalized destination still authorizes creation", async () => {
  const rawDirectory = `${PROJECT_DIR}/`
  let root
  await act(async () => {
    root = create(
      createElement(NewSessionDialog, {
        nav: nav(),
        open: true,
        onOpenChange: () => {},
        initialDirectory: rawDirectory,
      })
    )
  })
  await settle(6)
  try {
    expectAgentPickerReady(root, "trailing-slash destination")
    expect(buttonByText(root, "Create session").props.disabled).toBe(false)
    // Catalogs are read at the engine-resolved directory, not the raw input.
    expect(agentList.mock.calls.some(([arg]) => arg.location.directory === PROJECT_DIR)).toBe(true)
    expect(agentList.mock.calls.every(([arg]) => arg.location.directory !== rawDirectory)).toBe(true)
  } finally {
    await act(async () => root.unmount())
  }
})

test("the picker reads the destination catalog and makes the engine default explicit", async () => {
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
  await settle(6)
  try {
    expectAgentPickerReady(root, "destination catalog")
    for (const read of [agentList, modelList, configGet, modelDefault]) {
      expect(read.mock.calls.length).toBeGreaterThan(0)
      expect(read.mock.calls.some(([arg]) => arg.location.directory === PROJECT_DIR)).toBe(true)
    }
    const rendered = textOf(root.toJSON())
    expect(rendered).toContain("Engine default model: opencode/deepseek-v4.1-flash-free")
    expect(rendered).not.toContain("current-model")
  } finally {
    await act(async () => root.unmount())
  }
})

test("an explicit model choice is preserved only while it stays available at the destination", async () => {
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
  await settle(6)
  try {
    const modelPicker = () =>
      root.root.findAll((node) => node.props["data-picker"] === "Model")[0]
    const option = (value) =>
      modelPicker().findAll(
        (node) => node.props["data-option"] === value
      )[0]
    const choose = async (value) => {
      await act(async () => option(value).props.onClick())
      await settle(4)
    }
    const browseTo = async (directory) => {
      const input = root.root.findAll(
        (node) => node.type === "input" && node.props.id === "new-session-directory"
      )[0]
      await act(async () =>
        input.props.onChange({
          target: { value: directory },
          currentTarget: { value: directory },
        })
      )
      await settle(6)
    }

    // Make the engine default an explicit user choice before switching project.
    await choose("opencode/deepseek-v4.1-flash-free")
    await browseTo(BETA_DIR)
    expect(textOf(root.toJSON())).toContain(
      "Your Agent or Model choice is unavailable in this folder. Choose another."
    )
    expect(buttonByText(root, "Create session").props.disabled).toBe(true)
    expect(modelPicker().findAll((node) => typeof node.props["data-option"] === "string").map(
      (node) => node.props["data-option"]
    )).toEqual(["opencode/beta-model"])

    // Picking a valid agent and model in the new destination re-enables
    // creation without discarding the explicit model choice.
    const agentPickerNode = () =>
      root.root.findAll((node) => node.props["data-picker"] === "Agent")[0]
    await act(async () =>
      agentPickerNode()
        .findAll((node) => node.props["data-option"] === "beta-agent")[0]
        .props.onClick()
    )
    await settle(4)
    await choose("opencode/beta-model")
    expect(modelPicker().props["data-value"]).toBe("opencode/beta-model")
    expect(buttonByText(root, "Create session").props.disabled).toBe(false)
  } finally {
    await act(async () => root.unmount())
  }
})
