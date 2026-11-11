import { afterAll, afterEach, beforeEach, expect, test } from "bun:test"

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
  root.root.findAllByType("button").find((item) => text(item).includes(label))
const headings = (root) =>
  root.root.findAllByType("h2").map((item) => text(item))
const currentSection = (root) =>
  root.root.findAllByProps({ "aria-current": "page" }).map((item) => text(item))

function Harness() {
  const settings = useSettingsWorkspace()
  return React.createElement(
    React.Fragment,
    null,
    settings.open
      ? null
      : React.createElement(
          "button",
          { type: "button", onClick: () => settings.openSettings("plugins") },
          "Open settings"
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
      { id: "view-state" },
      settings.detailView ? "detail" : "list"
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

async function mount() {
  let root
  await act(async () => {
    root = create(
      React.createElement(
        SettingsProvider,
        null,
        React.createElement(Harness)
      )
    )
  })
  await act(async () => button(root, "Open settings").props.onClick())
  return root
}

test("deep-opened section shows its detail with the section list preserving aria-current", async () => {
  const root = await mount()
  try {
    expect(headings(root)).toContain("Plugins")
    expect(JSON.stringify(root.toJSON())).toContain("Plugins run inside the OpenCode engine.")
    expect(currentSection(root)).toContain("Plugins")
    expect(currentSection(root)).not.toContain("Access")
    expect(root.root.findByProps({ id: "view-state" }).children).toEqual([
      "detail",
    ])
  } finally {
    await act(async () => root.unmount())
  }
})

test("selecting a section updates the detail, and All settings returns to the list", async () => {
  const root = await mount()
  try {
    await act(async () => button(root, "Access").props.onClick())
    expect(headings(root)).toContain("Access")
    expect(currentSection(root)).toContain("Access")
    expect(currentSection(root)).not.toContain("Plugins")

    await act(async () => button(root, "All settings").props.onClick())
    expect(root.root.findByProps({ id: "view-state" }).children).toEqual([
      "list",
    ])
    // The section list stays rendered at every width; only the detail pane hides.
    expect(button(root, "Plugins")).toBeDefined()
  } finally {
    await act(async () => root.unmount())
  }
})

test("all registered sections are reachable from the list", async () => {
  const root = await mount()
  try {
    for (const label of [
      "Appearance",
      "Agents",
      "Alerts",
      "Keys",
      "Plugins",
      "Access",
    ]) {
      expect(button(root, label)).toBeDefined()
    }
  } finally {
    await act(async () => root.unmount())
  }
})

test("unsaved agent edits guard close until confirmed", async () => {
  const root = await mount()
  try {
    await act(async () => root.root.findByProps({ id: "mark-dirty" }).props.onClick())
    await act(async () => root.root.findByProps({ id: "request-close" }).props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "confirming",
    ])
    // Still open while the confirmation is pending.
    expect(root.root.findAllByProps({ id: "view-state" })).not.toHaveLength(0)

    await act(async () => root.root.findByProps({ id: "keep-editing" }).props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "idle",
    ])

    await act(async () => root.root.findByProps({ id: "request-close" }).props.onClick())
    await act(async () => root.root.findByProps({ id: "discard" }).props.onClick())
    expect(root.root.findByProps({ id: "confirm-state" }).children).toEqual([
      "idle",
    ])
    expect(button(root, "Open settings")).toBeDefined()
  } finally {
    await act(async () => root.unmount())
  }
})

test("workspace chrome uses the container-query layout and in-pane back button", async () => {
  const source = await Bun.file(
    new URL("../src/components/settings-workspace.tsx", import.meta.url)
  ).text()
  expect(source).toContain("@container")
  expect(source).toContain("@[40rem]:flex")
  expect(source).toContain("rtl:rotate-180")
  expect(source).toContain("min-h-11")
  expect(source).toContain("All settings")
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
