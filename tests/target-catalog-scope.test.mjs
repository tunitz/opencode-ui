import { afterAll, expect, mock, test } from "bun:test"

const previousWindow = globalThis.window
const listeners = new Map()
let activeId = null
globalThis.window = {
  location: { origin: "http://localhost" },
  addEventListener(type, listener) {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  },
  removeEventListener(type, listener) {
    listeners.get(type)?.delete(listener)
  },
  dispatchEvent(event) {
    for (const listener of listeners.get(event.type) ?? []) listener(event)
    return true
  },
}
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DIRECTORY = "/repo/alpha"
const agentFor = (id) => ({ id, mode: "primary", hidden: false })
const modelFor = (id) => ({
  id,
  providerID: "p",
  enabled: true,
  status: "active",
  variants: [],
})

let slowFirstAgentRead = false
let agentReadCount = 0
const agentList = mock(async () => {
  agentReadCount += 1
  if (slowFirstAgentRead && agentReadCount === 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return {
    data: [agentFor(activeId === "profile-b" ? "beta-agent" : "alpha-agent")],
  }
})
const readArgs = []
mock.module("@/lib/opencode", () => ({
  openCode: {
    agent: {
      list: (arg) => {
        readArgs.push(arg)
        return agentList(arg)
      },
    },
    model: {
      list: async () => ({ data: [modelFor("shared-model")] }),
      default: async () => ({ data: modelFor("shared-model") }),
    },
    config: { get: async () => [] },
  },
  errorMessage: (failure) => String(failure?.message ?? failure),
}))
let holdConnections = false
let releaseConnections = null
mock.module("@/lib/connections", () => ({
  ENGINE_CONNECTION_CHANGED: "opencode-ui:engine-connection-changed",
  listConnections: async () => {
    if (holdConnections) {
      await new Promise((resolve) => {
        releaseConnections = resolve
      })
    }
    return {
      active: activeId ? { id: activeId } : null,
      profiles: [],
    }
  },
}))

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")
const { catalogCacheKey, setCatalogConnection, useTargetCatalog } = await import(
  "../src/lib/use-target-catalog.ts"
)

afterAll(() => {
  mock.restore()
  if (previousActEnvironment === undefined)
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
  else globalThis.window = previousWindow
})

function Probe({ directory, onCatalog }) {
  onCatalog(useTargetCatalog(directory))
  return null
}

async function settle(times = 5) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function switchProfile(id) {
  activeId = id
  window.dispatchEvent(
    new CustomEvent("opencode-ui:engine-connection-changed", {
      detail: { id },
    })
  )
}

test("catalog cache keys are isolated by active profile for the same folder", () => {
  setCatalogConnection("profile-a")
  const first = catalogCacheKey(DIRECTORY)
  setCatalogConnection("profile-b")
  const second = catalogCacheKey(DIRECTORY)
  expect(first).not.toBe(second)
  expect(first).toContain("profile-a")
  expect(second).toContain("profile-b")
  setCatalogConnection(null)
})

test("switching profiles with the same folder reloads from the new engine", async () => {
  activeId = "profile-a"
  setCatalogConnection("profile-a")
  let latest
  let root
  await act(async () => {
    root = create(
      React.createElement(Probe, {
        directory: DIRECTORY,
        onCatalog: (catalog) => {
          latest = catalog
        },
      })
    )
  })
  await settle()
  expect(latest.status).toBe("ready")
  expect(latest.agents.map((agent) => agent.id)).toEqual(["alpha-agent"])

  const readsBefore = agentList.mock.calls.length
  await act(async () => {
    switchProfile("profile-b")
  })
  await settle()
  expect(agentList.mock.calls.length).toBeGreaterThan(readsBefore)
  expect(latest.connection).toBe("profile-b")
  expect(latest.agents.map((agent) => agent.id)).toEqual(["beta-agent"])
  expect(latest.agents.map((agent) => agent.id)).not.toContain("alpha-agent")
  expect(readArgs.every((arg) => arg.location.directory === DIRECTORY)).toBe(true)

  await act(async () => root.unmount())
})

test("a slow response from the previous profile cannot overwrite the new one", async () => {
  activeId = "profile-a"
  setCatalogConnection("profile-a")
  slowFirstAgentRead = true
  agentReadCount = 0
  let latest
  let root
  await act(async () => {
    root = create(
      React.createElement(Probe, {
        directory: DIRECTORY,
        onCatalog: (catalog) => {
          latest = catalog
        },
      })
    )
  })
  await act(async () => {
    switchProfile("profile-b")
  })
  await settle(8)
  expect(latest.connection).toBe("profile-b")
  expect(latest.agents.map((agent) => agent.id)).toEqual(["beta-agent"])
  slowFirstAgentRead = false
  await act(async () => root.unmount())
})

test("an unresolved profile lookup uses a pending namespace, then invalidates it", async () => {
  activeId = "profile-c"
  holdConnections = true
  releaseConnections = null
  setCatalogConnection(undefined)
  let latest
  let root
  await act(async () => {
    root = create(
      React.createElement(Probe, {
        directory: DIRECTORY,
        onCatalog: (catalog) => {
          latest = catalog
        },
      })
    )
  })
  await settle(4)
  expect(catalogCacheKey(DIRECTORY)).toContain("pending")
  const readsBefore = agentList.mock.calls.length
  await act(async () => {
    releaseConnections?.()
    await Promise.resolve()
  })
  await settle(6)
  expect(catalogCacheKey(DIRECTORY)).toContain("profile-c")
  expect(agentList.mock.calls.length).toBeGreaterThan(readsBefore)
  expect(latest.connection).toBe("profile-c")
  holdConnections = false
  await act(async () => root.unmount())
})
