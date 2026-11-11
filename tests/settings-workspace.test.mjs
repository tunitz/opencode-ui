import { afterAll, afterEach, beforeEach, expect, test, mock } from "bun:test"

// Product modules reach `window.location` at import time (the OpenCode client).
// Install a minimal browser surface before importing anything.
const previousWindow = globalThis.window
globalThis.window = {
  location: { origin: "http://localhost" },
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
}

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")

// The workspace defaults to Appearance; the real panel needs a ThemeProvider and
// a DOM, which this unit test does not mount. Its content is covered elsewhere.
mock.module("@/components/theme-select", () => ({
  AppearancePanel: () => React.createElement("p", null, "Appearance controls"),
}))
// Sections are separately tested; this suite targets the workspace chrome.
mock.module("@/components/agent-config-settings", () => ({
  AgentConfigSettings: () => React.createElement("p", null, "Agent controls"),
}))
mock.module("@/components/keybindings-settings", () => ({
  KeybindingsSettings: () => React.createElement("p", null, "Key controls"),
}))
mock.module("@/components/notifications-settings", () => ({
  NotificationsSettings: () => React.createElement("p", null, "Alert controls"),
}))

const { SettingsProvider, useSettingsWorkspace } = await import(
  "../src/components/settings-context"
)
const { SettingsWorkspace } = await import(
  "../src/components/settings-workspace"
)

afterAll(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
})

let previousActEnvironment

beforeEach(() => {
  previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (previousActEnvironment === undefined) {
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  } else {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  }
})

const text = (node) =>
  (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("")
const button = (root, label) =>
  root.root.findAllByType("button").find((item) => text(item) === label)
const tabs = (root) => root.root.findAllByProps({ role: "tab" })
const tabByID = (root, id) =>
  tabs(root).find((item) => item.props.id === `settings-tab-${id}`)
const selectedTabs = (root) =>
  tabs(root)
    .filter((item) => item.props["aria-selected"] === true)
    .map((item) => item.props.id)
const headings = (root) =>
  root.root.findAllByType("h2").map((item) => text(item))

function Harness() {
  const settings = useSettingsWorkspace()
  return React.createElement(
    React.Fragment,
    null,
    settings.open
      ? null
      : React.createElement(
          "button",
          { type: "button", id: "open-default", onClick: () => settings.openSettings() },
          "Open settings"
        ),
    React.createElement(
      "button",
      {
        type: "button",
        id: "open-plugins",
        onClick: () => settings.openSettings("plugins"),
      },
      "Open plugins"
    ),
    React.createElement(
      "button",
      { type: "button", id: "close-settings", onClick: settings.closeSettings },
      "Close settings"
    ),
    React.createElement(
      "button",
      {
        type: "button",
        id: "mark-dirty",
        onClick: () => settings.setAgentDirty(true),
      },
      "Mark dirty"
    ),
    React.createElement(
      "button",
      { type: "button", id: "request-close", onClick: settings.requestClose },
      "Request close"
    ),
    React.createElement(
      "button",
      { type: "button", id: "keep-editing", onClick: settings.keepEditing },
      "Keep editing"
    ),
    React.createElement(
      "button",
      { type: "button", id: "discard", onClick: settings.confirmDiscard },
      "Discard"
    ),
    React.createElement(
      "span",
      { id: "confirm-state" },
      settings.confirmOpen ? "confirming" : "idle"
    ),
    settings.open
      ? React.createElement(SettingsWorkspace, { nav: {} })
      : null
  )
}

async function mount(openID = "open-default", options) {
  let root
  await act(async () => {
    root = create(
      React.createElement(
        SettingsProvider,
        null,
        React.createElement(Harness)
      ),
      options
    )
  })
  await act(async () => root.root.findByProps({ id: openID }).props.onClick())
  return root
}

const pressKey = async (root, key) => {
  const tablist = root.root.findByProps({ role: "tablist" })
  await act(async () => {
    tablist.props.onKeyDown({ key, preventDefault() {} })
  })
}

test("opening Settings without a deep link always lands on Appearance", async () => {
  const root = await mount()
  try {
    expect(headings(root)).toEqual(["Appearance"])
    expect(selectedTabs(root)).toEqual(["settings-tab-appearance"])
    const panel = root.root.findByProps({ role: "tabpanel" })
    expect(panel.props["aria-labelledby"]).toBe("settings-tab-appearance")
    expect(panel.props.id).toBe("settings-panel-appearance")
  } finally {
    await act(async () => root.unmount())
  }
})

test("the tab bar renders every section in registry order with icon and label", async () => {
  const root = await mount()
  try {
    expect(tabs(root).map((item) => item.props.id)).toEqual([
      "settings-tab-appearance",
      "settings-tab-agents",
      "settings-tab-alerts",
      "settings-tab-keys",
      "settings-tab-plugins",
      "settings-tab-access",
    ])
    for (const [id, label] of [
      ["appearance", "Appearance"],
      ["agents", "Agents"],
      ["alerts", "Alerts"],
      ["keys", "Keys"],
      ["plugins", "Plugins"],
      ["access", "Access"],
    ]) {
      const tab = tabByID(root, id)
      expect(tab).toBeDefined()
      expect(text(tab)).toBe(label)
      expect(tab.findAllByType("svg")).toHaveLength(1)
      // 44px minimum touch target on every pill.
      expect(tab.props.className).toContain("min-h-11")
      expect(tab.props.className).toContain("rounded-full")
    }
    expect(
      root.root.findByProps({ role: "tablist" }).props["aria-label"]
    ).toBe("Settings sections")
  } finally {
    await act(async () => root.unmount())
  }
})

test("a deep link still opens its section", async () => {
  const root = await mount("open-plugins")
  try {
    expect(headings(root)).toEqual(["Plugins"])
    expect(selectedTabs(root)).toEqual(["settings-tab-plugins"])
    expect(JSON.stringify(root.toJSON())).toContain(
      "Plugins run inside the OpenCode engine."
    )
  } finally {
    await act(async () => root.unmount())
  }
})

test("clicking a tab switches content immediately with no back navigation", async () => {
  const root = await mount("open-plugins")
  try {
    await act(async () => button(root, "Access").props.onClick())
    expect(headings(root)).toEqual(["Access"])
    expect(selectedTabs(root)).toEqual(["settings-tab-access"])
    expect(text(root.toJSON())).not.toContain("All settings")
    // Every tab stays reachable in one tap.
    expect(tabs(root)).toHaveLength(6)
  } finally {
    await act(async () => root.unmount())
  }
})

test("reopening after visiting another section starts at Appearance again", async () => {
  const root = await mount()
  try {
    await act(async () => button(root, "Access").props.onClick())
    expect(headings(root)).toEqual(["Access"])

    await act(async () => root.root.findByProps({ id: "close-settings" }).props.onClick())
    await act(async () => root.root.findByProps({ id: "open-default" }).props.onClick())

    expect(headings(root)).toEqual(["Appearance"])
    expect(selectedTabs(root)).toEqual(["settings-tab-appearance"])
  } finally {
    await act(async () => root.unmount())
  }
})

test("unsaved agent edits guard tab switches until confirmed", async () => {
  const root = await mount()
  try {
    await act(async () => root.root.findByProps({ id: "mark-dirty" }).props.onClick())
    await act(async () => button(root, "Keys").props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "confirming",
    ])
    // The tab does not change while the confirmation is pending.
    expect(headings(root)).toEqual(["Appearance"])

    await act(async () => root.root.findByProps({ id: "keep-editing" }).props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "idle",
    ])
    expect(headings(root)).toEqual(["Appearance"])

    await act(async () => button(root, "Keys").props.onClick())
    await act(async () => root.root.findByProps({ id: "discard" }).props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "idle",
    ])
    expect(headings(root)).toEqual(["Keys"])
    expect(selectedTabs(root)).toEqual(["settings-tab-keys"])
  } finally {
    await act(async () => root.unmount())
  }
})

test("unsaved agent edits guard closing the workspace", async () => {
  const root = await mount()
  try {
    await act(async () => root.root.findByProps({ id: "mark-dirty" }).props.onClick())
    await act(async () => root.root.findByProps({ id: "request-close" }).props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "confirming",
    ])
    expect(tabs(root)).toHaveLength(6)

    await act(async () => root.root.findByProps({ id: "discard" }).props.onClick())
    expect(button(root, "Open settings")).toBeDefined()
  } finally {
    await act(async () => root.unmount())
  }
})

test("arrow keys, Home and End move selection with roving tab focus", async () => {
  const root = await mount()
  try {
    const tabIndexes = () =>
      tabs(root).map((item) => [item.props.id, item.props.tabIndex])

    expect(tabIndexes()[0]).toEqual(["settings-tab-appearance", 0])
    expect(
      tabs(root).filter((item) => item.props.tabIndex === 0)
    ).toHaveLength(1)

    await pressKey(root, "ArrowRight")
    expect(selectedTabs(root)).toEqual(["settings-tab-agents"])
    expect(tabByID(root, "agents").props.tabIndex).toBe(0)
    expect(tabByID(root, "appearance").props.tabIndex).toBe(-1)

    await pressKey(root, "ArrowRight")
    expect(selectedTabs(root)).toEqual(["settings-tab-alerts"])

    await pressKey(root, "ArrowLeft")
    expect(selectedTabs(root)).toEqual(["settings-tab-agents"])

    await pressKey(root, "End")
    expect(selectedTabs(root)).toEqual(["settings-tab-access"])

    await pressKey(root, "Home")
    expect(selectedTabs(root)).toEqual(["settings-tab-appearance"])

    // Arrow keys wrap around the ends.
    await pressKey(root, "ArrowLeft")
    expect(selectedTabs(root)).toEqual(["settings-tab-access"])
  } finally {
    await act(async () => root.unmount())
  }
})

test("honours horizontal tablist semantics and 44px targets", async () => {
  const source = await Bun.file(
    new URL("../src/components/settings-workspace.tsx", import.meta.url)
  ).text()
  expect(source).toContain('role="tablist"')
  expect(source).toContain('role="tab"')
  expect(source).toContain('role="tabpanel"')
  expect(source).toContain('aria-orientation="horizontal"')
  expect(source).toContain("aria-selected={selected}")
  expect(source).toContain("aria-labelledby={tabID(active.id)}")
  expect(source).toContain("min-h-11")
  expect(source).toContain("rounded-full")
  expect(source).toContain("sticky top-0")
  expect(source).toContain("bg-background/95 backdrop-blur")
  expect(source).toContain("[scrollbar-width:none]")
  expect(source).toContain("overflow-x-auto")
  expect(source).toContain("rtl:bg-linear-to-l")
  expect(source).toContain("motion-reduce:transition-none")
})

test("both Settings entry points left-align their footer", async () => {
  const navigation = await Bun.file(
    new URL("../src/components/session-nav.tsx", import.meta.url)
  ).text()

  expect(navigation).toContain('"justify-start gap-1 p-3"')
  expect(navigation).toContain(
    'SheetFooter className="flex-row items-center justify-start gap-1 border-t border-border p-4"'
  )
  expect(navigation).not.toContain('"justify-end gap-1 p-3"')
})

test("the retired dialog and sidebar theme entry points are gone", async () => {
  const dialog = await Bun.file(
    new URL("../src/components/settings-dialog.tsx", import.meta.url)
  ).text()
  const navigation = await Bun.file(
    new URL("../src/components/session-nav.tsx", import.meta.url)
  ).text()
  const header = await Bun.file(
    new URL("../src/components/app-header.tsx", import.meta.url)
  ).text()
  const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text()

  expect(dialog).not.toContain("@/components/ui/dialog")
  expect(dialog).not.toContain("@/components/ui/sheet")
  expect(navigation).not.toContain("ThemeSelect")
  expect(navigation).not.toContain("AppearanceDialog")
  expect(navigation).not.toContain("AppearanceTrigger")
  expect(header).toContain('aria-label="Back to conversation"')
  expect(app).toContain("notes.open || settings.open")
  expect(app).toContain("settings.open &&")
})

// --- Tab strip wheel scrolling ---------------------------------------------

function tabStripMock({ scrollWidth = 900, clientWidth = 300 } = {}) {
  const listeners = new Map()
  const strip = {
    scrollWidth,
    clientWidth,
    scrollLeft: 0,
    addEventListener(type, handler, options) {
      listeners.set(type, { handler, options })
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    scrollTo() {},
    focus() {},
  }
  return { strip, listeners }
}

const mountWithTabStrip = (strip) =>
  mount("open-default", {
    createNodeMock: (element) =>
      element.type === "div" && element.props.role === "tablist" ? strip : {},
  })

function wheelEvent(overrides = {}) {
  return {
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    ctrlKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    ...overrides,
  }
}

test("a vertical mouse wheel scrolls the overflowing tab strip", async () => {
  const { strip, listeners } = tabStripMock()
  const root = await mountWithTabStrip(strip)
  try {
    const wheel = listeners.get("wheel")
    expect(wheel).toBeDefined()
    expect(wheel.options).toEqual({ passive: false })

    const event = wheelEvent()
    await act(async () => wheel.handler(event))
    expect(event.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(120)

    // Line-mode deltas are translated to pixels rather than swallowed.
    const lines = wheelEvent({ deltaY: 3, deltaMode: 1 })
    await act(async () => wheel.handler(lines))
    expect(strip.scrollLeft).toBe(168)
  } finally {
    await act(async () => root.unmount())
  }
})

test("trackpad horizontal gestures and pinch zoom stay native", async () => {
  const { strip, listeners } = tabStripMock()
  const root = await mountWithTabStrip(strip)
  try {
    const wheel = listeners.get("wheel")
    const horizontal = wheelEvent({ deltaX: 120, deltaY: 8 })
    await act(async () => wheel.handler(horizontal))
    expect(horizontal.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(0)

    const zoom = wheelEvent({ ctrlKey: true })
    await act(async () => wheel.handler(zoom))
    expect(zoom.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test("a tab strip with no horizontal overflow ignores wheel input", async () => {
  const { strip, listeners } = tabStripMock({ scrollWidth: 300, clientWidth: 300 })
  const root = await mountWithTabStrip(strip)
  try {
    const event = wheelEvent()
    await act(async () => listeners.get("wheel").handler(event))
    expect(event.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test("RTL keeps wheel scrolling pointing at the end of the strip", async () => {
  const previousDocument = globalThis.document
  globalThis.document = {
    documentElement: { getAttribute: () => "rtl" },
  }
  const { strip, listeners } = tabStripMock()
  const root = await mountWithTabStrip(strip)
  try {
    const event = wheelEvent()
    await act(async () => listeners.get("wheel").handler(event))
    expect(event.defaultPrevented).toBe(true)
    // RTL scroll offsets run negative from the start edge.
    expect(strip.scrollLeft).toBe(-120)
  } finally {
    await act(async () => root.unmount())
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})
