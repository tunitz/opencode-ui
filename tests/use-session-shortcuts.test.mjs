import { afterEach, expect, test } from "bun:test"
import { act, create } from "react-test-renderer"
import { createElement } from "react"

import { useSessionShortcuts } from "../src/lib/use-session-shortcuts.ts"

const previousWindow = globalThis.window
const previousFetch = globalThis.fetch
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT

function installFetch() {
  const calls = []
  const pending = []
  globalThis.fetch = (url, init) => {
    let resolve
    const promise = new Promise((res) => { resolve = res })
    pending.push({ url: String(url), init, resolve })
    calls.push({ url: String(url), init })
    return promise
  }
  return { calls, pending }
}

function respond({ ok: okValue = true, shortcuts = {}, legacyCount = 0 } = {}) {
  return {
    ok: okValue,
    json: async () => ({ shortcuts, legacyCount }),
  }
}

afterEach(() => {
  globalThis.fetch = previousFetch
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

function setup() {
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const network = installFetch()
  let latest
  function Harness({ connectionId }) {
    latest = useSessionShortcuts(connectionId)
    return null
  }
  const mount = async (connectionId) => {
    let renderer
    await act(async () => {
      renderer = create(createElement(Harness, { connectionId }))
    })
    return renderer
  }
  const switchTo = async (renderer, connectionId) => {
    await act(async () => {
      renderer.update(createElement(Harness, { connectionId }))
    })
  }
  return { network, get: () => latest, mount, switchTo }
}

test("a connection switch clears the previous pins before the new load resolves", async () => {
  const { network, get, mount, switchTo } = setup()
  const renderer = await mount("conn-a")
  expect(network.calls[0].url).toContain("connectionId=conn-a")

  await act(async () => {
    network.pending[0].resolve(respond({ shortcuts: { "a-pin": { pinned: true, label: "" } } }))
  })
  expect(Object.keys(get().shortcuts)).toEqual(["a-pin"])

  await switchTo(renderer, "conn-b")
  // Cleared synchronously on switch; the new response has not arrived yet.
  expect(Object.keys(get().shortcuts)).toEqual([])
  expect(get().legacyCount).toBe(0)
  expect(network.calls.at(-1).url).toContain("connectionId=conn-b")

  await act(async () => {
    network.pending.at(-1).resolve(respond({ shortcuts: { "b-pin": { pinned: true, label: "B" } } }))
  })
  expect(Object.keys(get().shortcuts)).toEqual(["b-pin"])
  expect(get().shortcuts["b-pin"].label).toBe("B")
})

test("in-flight responses from a previous connection are discarded", async () => {
  const { network, get, mount, switchTo } = setup()
  const renderer = await mount("conn-a")

  // Move on to conn-b while conn-a's response is still in flight.
  await switchTo(renderer, "conn-b")
  const stale = network.pending[0]
  const current = network.pending[1]

  await act(async () => {
    current.resolve(respond({ shortcuts: { "b-pin": { pinned: true, label: "" } } }))
  })
  expect(Object.keys(get().shortcuts)).toEqual(["b-pin"])

  await act(async () => {
    stale.resolve(respond({ shortcuts: { "a-pin": { pinned: true, label: "Stale A" } } }))
  })
  expect(Object.keys(get().shortcuts)).toEqual(["b-pin"])
  expect(get().shortcuts["a-pin"]).toBeUndefined()
})

test("switching back reloads the original connection's pins", async () => {
  const { network, get, mount, switchTo } = setup()
  const renderer = await mount("conn-a")
  await act(async () => {
    network.pending[0].resolve(respond({ shortcuts: { "a-pin": { pinned: true, label: "A" } } }))
  })

  await switchTo(renderer, "conn-b")
  await act(async () => {
    network.pending.at(-1).resolve(respond({ shortcuts: {} }))
  })
  expect(Object.keys(get().shortcuts)).toEqual([])

  await switchTo(renderer, "conn-a")
  await act(async () => {
    network.pending.at(-1).resolve(respond({ shortcuts: { "a-pin": { pinned: true, label: "A" } }, legacyCount: 1 }))
  })
  expect(get().shortcuts["a-pin"].label).toBe("A")
  expect(get().legacyCount).toBe(1)
})
