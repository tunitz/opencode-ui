import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

const realFetch = globalThis.fetch

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const connected = {
  engineAvailable: true,
  plugins: [
    {
      id: "notes",
      name: "Notes",
      description: "Project notes, planning and daily logs for agents and humans.",
      registered: true,
      connected: true,
      restartRequired: false,
    },
  ],
}

function setup(handler) {
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  const previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  const calls = []
  globalThis.fetch = async (request, init) => {
    const url = typeof request === "string" ? request : String(request?.url ?? request)
    calls.push({ url, method: init?.method ?? "GET" })
    return await handler(url, init, calls)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch
      if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
      else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    },
  }
}

const flush = async () => {
  for (let index = 0; index < 12; index += 1) await act(async () => { await Promise.resolve() })
}

const button = (root, label) =>
  root.root.findAllByType("button").find((node) => node.props["aria-label"] === label)

test("a connected plugin shows its state and a disable action", async () => {
  const env = setup(async () => json(connected))
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Notes")
    expect(text).toContain("Connected")
    expect(text).toContain("Project notes")
    expect(text).not.toContain("Restart the OpenCode engine")
    expect(button(root, "Disable Notes")).toBeDefined()
    expect(button(root, "Disable Notes").props.disabled).toBe(false)
    expect(env.calls[0]).toEqual({ url: "/api/ui/plugins", method: "GET" })
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("a registered but disconnected plugin asks for an engine restart", async () => {
  const env = setup(async () =>
    json({
      engineAvailable: true,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          registered: true,
          connected: false,
          restartRequired: true,
        },
      ],
    })
  )
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Registered")
    expect(text).toContain("Restart the OpenCode engine to apply.")
    expect(button(root, "Disable Notes")).toBeDefined()
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("enabling a plugin posts once and re-reads the engine state", async () => {
  let state = {
    engineAvailable: true,
    plugins: [
      {
        id: "notes",
        name: "Notes",
        description: "Notes",
        registered: false,
        connected: false,
        restartRequired: false,
      },
    ],
  }
  const env = setup(async (url) => {
    if (url.endsWith("/enable")) {
      state = connected
      return json({ registered: true, connected: true, restartRequired: false })
    }
    return json(state)
  })
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    expect(JSON.stringify(root.toJSON())).toContain("Not registered")
    const enable = button(root, "Enable Notes")
    expect(enable.props.disabled).toBe(false)
    await act(async () => enable.props.onClick())
    await flush()
    expect(env.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/ui/plugins",
      "POST /api/ui/plugins/notes/enable",
      "GET /api/ui/plugins",
    ])
    expect(JSON.stringify(root.toJSON())).toContain("Connected")
    expect(button(root, "Disable Notes")).toBeDefined()
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("an unreachable engine disables the controls with one explanation", async () => {
  const env = setup(async () =>
    json({
      engineAvailable: false,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          registered: false,
          connected: false,
          restartRequired: false,
        },
      ],
    })
  )
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("The OpenCode engine is unreachable")
    expect(button(root, "Enable Notes").props.disabled).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("an engine rejection is reported inline and state is re-read", async () => {
  const env = setup(async (url) => {
    if (url.endsWith("/enable"))
      return json(
        { error: { code: "engine_rejected", message: "Engine said no." } },
        502
      )
    return json({
      engineAvailable: true,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          registered: false,
          connected: false,
          restartRequired: false,
        },
      ],
    })
  })
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    await act(async () => button(root, "Enable Notes").props.onClick())
    await flush()
    expect(JSON.stringify(root.toJSON())).toContain("rejected the plugin change")
    expect(env.calls.filter((call) => call.url === "/api/ui/plugins")).toHaveLength(2)
    expect(button(root, "Enable Notes").props.disabled).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("a failed plugin read offers a retry", async () => {
  let fail = true
  const env = setup(async () =>
    fail
      ? json({ error: { code: "engine_unavailable", message: "down" } }, 502)
      : json(connected)
  )
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    expect(JSON.stringify(root.toJSON())).toContain("The OpenCode engine is unreachable")
    const retry = root.root.findAllByType("button").find((node) => node.children.includes("Retry"))
    expect(retry).toBeDefined()
    fail = false
    await act(async () => retry.props.onClick())
    await flush()
    expect(JSON.stringify(root.toJSON())).toContain("Connected")
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})
