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
  const events = new EventTarget()
  globalThis.window = {
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: (event) => events.dispatchEvent(event),
  }
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

test("a configured plugin missing from this build offers disable, not enable", async () => {
  let configured = true
  const env = setup(async (url) => {
    if (url.endsWith("/disable")) {
      configured = false
      return json({ registered: false })
    }
    return json({
      engineAvailable: true,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          configured,
          installed: false,
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
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Not installed")
    expect(text).toContain("Configured but not installed in this build.")
    expect(button(root, "Enable Notes")).toBeUndefined()
    const disable = button(root, "Disable Notes")
    expect(disable).toBeDefined()
    expect(disable.props.disabled).toBe(false)
    await act(async () => disable.props.onClick())
    await flush()
    expect(env.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/ui/plugins",
      "POST /api/ui/plugins/notes/disable",
      "GET /api/ui/plugins",
    ])
    const after = JSON.stringify(root.toJSON())
    expect(after).toContain("Not installed in this build.")
    expect(button(root, "Disable Notes")).toBeUndefined()
    expect(button(root, "Enable Notes")).toBeUndefined()
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("an uninstalled plugin that is not configured offers no enable action", async () => {
  const env = setup(async () =>
    json({
      engineAvailable: true,
      plugins: [
        {
          id: "other",
          name: "Other",
          description: "Other",
          configured: false,
          installed: false,
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
    expect(text).toContain("Not installed in this build.")
    expect(button(root, "Enable Other")).toBeUndefined()
    expect(button(root, "Disable Other")).toBeUndefined()
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("configured and installed metadata keeps the registered action", async () => {
  const env = setup(async () =>
    json({
      engineAvailable: true,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          configured: true,
          installed: true,
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
    expect(button(root, "Enable Notes")).toBeUndefined()
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("refresh scope posts the dedicated endpoint and re-reads engine state", async () => {
  let state = {
    engineAvailable: true,
    plugins: [
      {
        id: "notes",
        name: "Notes",
        description: "Notes",
        configured: true,
        installed: true,
        registered: true,
        connected: true,
        restartRequired: false,
      },
    ],
  }
  const env = setup(async (url) => {
    if (url.endsWith("/refresh-scope")) return json({ registered: true, connected: true, restartRequired: false })
    return json(state)
  })
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    const refresh = button(root, "Refresh Notes connection scope")
    expect(refresh).toBeDefined()
    await act(async () => refresh.props.onClick())
    await flush()
    expect(env.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/ui/plugins",
      "POST /api/ui/plugins/notes/refresh-scope",
      "GET /api/ui/plugins",
    ])
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

test("a successful disable announces the plugin change once", async () => {
  let disabled = false
  const env = setup(async (url) => {
    if (url.endsWith("/disable")) {
      disabled = true
      return json({ registered: false })
    }
    return json(
      disabled
        ? {
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
        : connected
    )
  })
  const { NOTES_PLUGINS_CHANGED } = await import("../src/lib/notes-plugin-state")
  const seen = []
  globalThis.window.addEventListener(NOTES_PLUGINS_CHANGED, (event) => seen.push(event.type))
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    await act(async () => button(root, "Disable Notes").props.onClick())
    await flush()
    expect(seen).toEqual([NOTES_PLUGINS_CHANGED])
    expect(JSON.stringify(root.toJSON())).toContain("Not registered")
    // The section re-reads once for its own change, not twice.
    expect(env.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/ui/plugins",
      "POST /api/ui/plugins/notes/disable",
      "GET /api/ui/plugins",
    ])
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("a disabled plugin the engine still runs is surfaced with a retry", async () => {
  let disabled = false
  const env = setup(async (url) => {
    if (url.endsWith("/disable")) {
      disabled = true
      return json({ registered: false, connected: false, restartRequired: false, engineSynced: true })
    }
    return json({
      engineAvailable: true,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          configured: false,
          installed: true,
          registered: false,
          connected: !disabled,
          restartRequired: false,
          engineSynced: disabled,
        },
      ],
    })
  })
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Engine out of sync")
    expect(text).not.toContain("Connected")
    expect(text).toContain(
      "The engine still has this entry. Retry Disable or restart the OpenCode engine."
    )
    const disable = button(root, "Disable Notes")
    expect(disable).toBeDefined()
    expect(disable.props.disabled).toBe(false)
    await act(async () => disable.props.onClick())
    await flush()
    expect(env.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/ui/plugins",
      "POST /api/ui/plugins/notes/disable",
      "GET /api/ui/plugins",
    ])
    expect(JSON.stringify(root.toJSON())).toContain("Not registered")
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("a saved plugin missing from the engine asks for a restart", async () => {
  const env = setup(async () =>
    json({
      engineAvailable: true,
      plugins: [
        {
          id: "notes",
          name: "Notes",
          description: "Notes",
          configured: true,
          installed: true,
          registered: true,
          connected: false,
          restartRequired: true,
          engineSynced: false,
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
    expect(text).toContain("Engine out of sync")
    expect(text).toContain(
      "Saved, but the engine has no entry. Restart the OpenCode engine to apply."
    )
    expect(button(root, "Disable Notes")).toBeDefined()
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})

test("a change from elsewhere refreshes the section", async () => {
  const env = setup(async () => json(connected))
  const { NOTES_PLUGINS_CHANGED } = await import("../src/lib/notes-plugin-state")
  let root
  try {
    const { SettingsPluginsSection } = await import("../src/components/settings-plugins-section")
    await act(async () => { root = create(React.createElement(SettingsPluginsSection)) })
    await flush()
    expect(env.calls.filter((call) => call.url === "/api/ui/plugins")).toHaveLength(1)
    await act(async () => {
      globalThis.window.dispatchEvent(new Event(NOTES_PLUGINS_CHANGED))
    })
    await flush()
    expect(env.calls.filter((call) => call.url === "/api/ui/plugins")).toHaveLength(2)
  } finally {
    if (root) await act(async () => root.unmount())
    env.restore()
  }
})
