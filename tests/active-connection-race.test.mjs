import { afterAll, expect, mock, test } from "bun:test"

const previousWindow = globalThis.window
const listeners = new Map()
globalThis.window = {
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

let resolveLookup
const listConnections = mock(
  () =>
    new Promise((resolve) => {
      resolveLookup = resolve
    })
)
mock.module("@/lib/connections", () => ({
  ENGINE_CONNECTION_CHANGED: "opencode-ui:engine-connection-changed",
  listConnections,
}))

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")
const { useActiveConnection } = await import(
  "../src/lib/use-active-connection.ts"
)

afterAll(() => {
  mock.restore()
  if (previousActEnvironment === undefined)
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
  else globalThis.window = previousWindow
})

function Probe({ onState }) {
  onState(useActiveConnection())
  return null
}

async function settle(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function emitSwitch(id) {
  window.dispatchEvent(
    new CustomEvent("opencode-ui:engine-connection-changed", {
      detail: { id },
    })
  )
}

test("a late initial lookup cannot overwrite a newer connection-change event", async () => {
  let latest
  let root
  await act(async () => {
    root = create(
      React.createElement(Probe, {
        onState: (state) => {
          latest = state
        },
      })
    )
  })
  expect(latest.ready).toBe(false)
  expect(latest.generation).toBe(0)

  await act(async () => {
    emitSwitch("profile-b")
  })
  expect(latest.connectionId).toBe("profile-b")
  expect(latest.ready).toBe(true)
  expect(latest.generation).toBe(1)

  await act(async () => {
    resolveLookup({ active: { id: "profile-a" }, profiles: [] })
    await Promise.resolve()
  })
  await settle()
  expect(latest.connectionId).toBe("profile-b")
  expect(latest.generation).toBe(1)
  await act(async () => root.unmount())
})

test("without a switch the initial lookup still supplies the active profile", async () => {
  let latest
  let root
  await act(async () => {
    root = create(
      React.createElement(Probe, {
        onState: (state) => {
          latest = state
        },
      })
    )
  })
  expect(latest.ready).toBe(false)
  await act(async () => {
    resolveLookup({ active: { id: "profile-a" }, profiles: [] })
    await Promise.resolve()
  })
  await settle()
  expect(latest.ready).toBe(true)
  expect(latest.connectionId).toBe("profile-a")
  expect(latest.generation).toBe(0)
  await act(async () => root.unmount())
})

test("A→B→A advances the generation so stale previews cannot be reused", async () => {
  let latest
  let root
  await act(async () => {
    root = create(
      React.createElement(Probe, {
        onState: (state) => {
          latest = state
        },
      })
    )
  })
  await act(async () => {
    resolveLookup({ active: { id: "profile-a" }, profiles: [] })
    await Promise.resolve()
  })
  await settle()
  const firstScope = {
    connectionId: latest.connectionId,
    generation: latest.generation,
  }
  await act(async () => emitSwitch("profile-b"))
  await act(async () => emitSwitch("profile-a"))
  expect(latest.connectionId).toBe("profile-a")
  expect(latest.generation).toBe(firstScope.generation + 2)
  expect({
    connectionId: latest.connectionId,
    generation: latest.generation,
  }).not.toEqual(firstScope)
  await act(async () => root.unmount())
})
