import { afterEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { UiSyncSettings } from "../src/components/ui-sync-settings"
import {
  WebUiPreferencesProvider,
  useWebUiPreferences,
} from "../src/components/web-ui-preferences-provider"
import { preferencesStorageKey } from "../src/lib/web-ui-preferences"

const old = {
  fetch: globalThis.fetch,
  location: globalThis.location,
  localStorage: globalThis.localStorage,
  window: globalThis.window,
  act: globalThis.IS_REACT_ACT_ENVIRONMENT,
}
const origin = "https://example.test"
const version = "2.1.4"

function installBrowser(storage) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.location = { origin }
  globalThis.localStorage = storage
  globalThis.window = { location: { origin }, localStorage: storage }
}

function restoreBrowser() {
  globalThis.fetch = old.fetch
  if (old.location === undefined) delete globalThis.location
  else globalThis.location = old.location
  if (old.localStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = old.localStorage
  if (old.window === undefined) delete globalThis.window
  else globalThis.window = old.window
  if (old.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
  else globalThis.IS_REACT_ACT_ENVIRONMENT = old.act
}

function mapStorage(values) {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function PreferencesProbe() {
  const { preferences, setGlobal } = useWebUiPreferences()
  return React.createElement(
    "div",
    null,
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setGlobal({ worktreeParentDirectory: "/home/me/next" }),
      },
      "Edit worktree"
    ),
    React.createElement("output", null, JSON.stringify(preferences.global))
  )
}

function renderSettings() {
  return React.createElement(
    WebUiPreferencesProvider,
    { serverVersion: version },
    React.createElement(PreferencesProbe),
    React.createElement(UiSyncSettings, { backendVersion: version })
  )
}

function button(root, label) {
  return root.root
    .findAllByType("button")
    .find((item) => item.children.includes(label))
}

afterEach(restoreBrowser)

test("preference sharing requires preparation and explicit confirmation", async () => {
  const values = new Map()
  const requests = []
  installBrowser(mapStorage(values))
  globalThis.fetch = async (_url, options) => {
    requests.push(options?.method ?? "GET")
    return new Response(null, { status: options?.method === "PUT" ? 204 : 404 })
  }
  let root
  try {
    await act(async () => {
      root = create(renderSettings())
    })
    expect(requests).toEqual([])
    await act(async () => button(root, "Share this device").props.onClick())
    expect(requests).toEqual(["GET"])
    await act(async () => button(root, "Confirm ").props.onClick())
    expect(requests).toEqual(["GET", "PUT"])
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("a failed import restores storage without changing provider state", async () => {
  const key = preferencesStorageKey(origin, version)
  const saved = {
    schemaVersion: 1,
    origin,
    backendVersion: version,
    startup: { mode: "last" },
    global: {
      agentID: "old-agent",
      model: { providerID: "old-provider", modelID: "old-model" },
      thinkingLevel: "low",
      worktreeParentDirectory: "/home/me/worktrees",
    },
    projectOverrides: {},
  }
  const values = new Map([[key, JSON.stringify(saved)]])
  let failKey = null
  installBrowser({
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      if (name === failKey) {
        failKey = null
        throw new Error("storage unavailable")
      }
      values.set(name, value)
    },
    removeItem: (name) => values.delete(name),
  })
  globalThis.fetch = async (_url, options) => {
    if ((options?.method ?? "GET") === "GET") {
      return Response.json(
        {
          version: 1,
          backendVersion: version,
          preferences: {
            theme: "dark",
            global: { agentID: "imported-agent", model: null, thinkingLevel: null },
            startup: { mode: "last" },
          },
          presets: [],
          pins: [],
          labels: [],
        },
        { headers: { etag: '"revision"' } }
      )
    }
    return new Response(null, { status: 204 })
  }
  let root
  try {
    await act(async () => {
      root = create(renderSettings())
    })
    await act(async () => button(root, "Import shared settings").props.onClick())
    failKey = key
    await act(async () => button(root, "Confirm ").props.onClick())

    expect(JSON.parse(root.root.findByType("output").children.join(""))).toEqual(
      saved.global
    )
    expect(values.size).toBe(1)
    expect(JSON.parse(values.get(key))).toEqual(saved)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("a confirmed import refreshes the provider so later edits keep imported defaults", async () => {
  const key = preferencesStorageKey(origin, version)
  const values = new Map([
    [
      key,
      JSON.stringify({
        schemaVersion: 1,
        origin,
        backendVersion: version,
        startup: { mode: "last" },
        global: {
          agentID: "old-agent",
          model: { providerID: "old-provider", modelID: "old-model" },
          thinkingLevel: "low",
          worktreeParentDirectory: "/home/me/worktrees",
        },
        projectOverrides: {},
      }),
    ],
  ])
  const snapshot = {
    version: 1,
    backendVersion: version,
    preferences: {
      theme: "dark",
      global: {
        agentID: "imported-agent",
        model: { providerID: "provider", modelID: "model" },
        thinkingLevel: "high",
      },
      startup: { mode: "pinned", projectID: "project-1" },
    },
    presets: [],
    pins: [],
    labels: [],
  }
  installBrowser(mapStorage(values))
  globalThis.fetch = async (_url, options) => {
    if ((options?.method ?? "GET") === "GET") {
      return Response.json(snapshot, { headers: { etag: '"revision"' } })
    }
    return new Response(null, { status: 204 })
  }
  let root
  try {
    await act(async () => {
      root = create(renderSettings())
    })
    await act(async () => button(root, "Import shared settings").props.onClick())
    await act(async () => button(root, "Confirm ").props.onClick())

    expect(JSON.parse(root.root.findByType("output").children.join(""))).toEqual({
      ...snapshot.preferences.global,
      worktreeParentDirectory: "/home/me/worktrees",
    })

    // Editing a browser-local default before reload must build on the newly
    // imported globals, not write the pre-import provider snapshot back.
    await act(async () => button(root, "Edit worktree").props.onClick())
    expect(JSON.parse(values.get(key))).toEqual({
      schemaVersion: 1,
      origin,
      backendVersion: version,
      startup: { mode: "pinned", projectID: "project-1" },
      global: {
        ...snapshot.preferences.global,
        worktreeParentDirectory: "/home/me/next",
      },
      projectOverrides: {},
    })
  } finally {
    if (root) await act(async () => root.unmount())
  }
})
