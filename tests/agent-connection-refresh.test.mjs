import { afterAll, beforeEach, expect, test, mock } from "bun:test"

const previousWindow = globalThis.window
const windowListeners = new Map()
globalThis.window = {
  location: { origin: "http://localhost" },
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener(type, listener) {
    const set = windowListeners.get(type) ?? new Set()
    set.add(listener)
    windowListeners.set(type, set)
  },
  removeEventListener(type, listener) {
    windowListeners.get(type)?.delete(listener)
  },
  dispatchEvent(event) {
    for (const listener of windowListeners.get(event.type) ?? []) {
      listener(event)
    }
    return true
  },
  localStorage: {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  },
}

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")

const catalogs = [
  {
    scope: "global",
    project: null,
    sourceLabel: "Global configuration",
    agents: [
      {
        id: "alpha-agent",
        name: "Alpha agent",
        effective: { mode: "primary", hidden: false },
        source: null,
        target: null,
        readonly: true,
        permissionsReadOnly: true,
        warnings: [],
      },
    ],
    warnings: [],
  },
  {
    scope: "global",
    project: null,
    sourceLabel: "Global configuration",
    agents: [
      {
        id: "beta-agent",
        name: "Beta agent",
        effective: { mode: "primary", hidden: false },
        source: null,
        target: null,
        readonly: true,
        permissionsReadOnly: true,
        warnings: [],
      },
    ],
    warnings: [],
  },
]

let catalogCalls = 0
mock.module("@/lib/agent-config", () => ({
  AgentConfigRequestError: class extends Error {},
  agentConfigModelFromKey: () => null,
  deleteAgentDefinition: async () => ({}),
  fetchAgentConfigCatalog: async () => catalogs[Math.min(catalogCalls++, 1)],
  saveAgentConfig: async () => ({}),
  saveDefaultAgent: async () => ({}),
}))
mock.module("@/lib/model-favorites", () => ({
  useModelFavorites: () => ({ favorites: new Set(), toggle() {} }),
}))

const { AgentConfigSettings } = await import(
  "../src/components/agent-config-settings.tsx"
)
const { ENGINE_CONNECTION_CHANGED } = await import("../src/lib/connections.ts")

afterAll(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
})

beforeEach(() => {
  catalogCalls = 0
  windowListeners.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

function nav(epoch) {
  return {
    agents: [],
    configEntries: [],
    models: [],
    catalogEpoch: epoch,
  }
}

test("switching engines reloads the agent catalog and drops the old selection", async () => {
  let renderer
  await act(async () => {
    renderer = create(
      React.createElement(AgentConfigSettings, { nav: nav(0), active: true })
    )
  })
  expect(catalogCalls).toBe(1)
  expect(
    JSON.stringify(renderer.toJSON()) ?? ""
  ).toContain("Alpha agent")

  await act(async () => {
    renderer.update(
      React.createElement(AgentConfigSettings, { nav: nav(1), active: true })
    )
  })
  await act(async () => {
    await Promise.resolve()
  })

  expect(catalogCalls).toBe(2)
  expect(JSON.stringify(renderer.toJSON()) ?? "").toContain("Beta agent")
  expect(JSON.stringify(renderer.toJSON()) ?? "").not.toContain("Alpha agent")
  await act(async () => {
    renderer.unmount()
  })
})

test("a connection-changed event reloads the catalog even when the epoch is unchanged", async () => {
  let renderer
  await act(async () => {
    renderer = create(
      React.createElement(AgentConfigSettings, { nav: nav(7), active: true })
    )
  })
  expect(catalogCalls).toBe(1)
  expect(JSON.stringify(renderer.toJSON()) ?? "").toContain("Alpha agent")

  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(ENGINE_CONNECTION_CHANGED, {
        detail: { id: "other", isActive: true },
      })
    )
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })

  expect(catalogCalls).toBe(2)
  expect(JSON.stringify(renderer.toJSON()) ?? "").toContain("Beta agent")
})
