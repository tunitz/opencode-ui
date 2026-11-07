import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { UiSyncSettings } from "../src/components/ui-sync-settings"

test("preference sharing requires preparation and explicit confirmation", async () => {
  const oldFetch = globalThis.fetch, oldLocation = globalThis.location, oldStorage = globalThis.localStorage, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  const values = new Map(), requests = []
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.location = { origin: "https://example.test" }
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  globalThis.fetch = async (_url, options) => { requests.push(options?.method ?? "GET"); return new Response(null, { status: options?.method === "PUT" ? 204 : 404 }) }
  let root
  try {
    await act(async () => { root = create(React.createElement(UiSyncSettings, { backendVersion: "2.1.4" })) })
    expect(requests).toEqual([])
    const button = (label) => root.root.findAllByType("button").find((item) => item.children.includes(label))
    await act(async () => button("Share this device").props.onClick())
    expect(requests).toEqual(["GET"])
    await act(async () => button("Confirm ").props.onClick())
    expect(requests).toEqual(["GET", "PUT"])
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
})
