import { afterAll, expect, mock, test } from "bun:test"

// Visibility is the subject; Base UI's floating tooltip is covered elsewhere.

const previousWindow = globalThis.window
const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = {
  location: { origin: "http://localhost" },
  matchMedia: () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }),
  addEventListener() {},
  removeEventListener() {},
}

const React = await import("react")
const { act } = React
const { create } = await import("react-test-renderer")

const Panel = () => React.createElement("div", { "data-testid": "panel" }, "panel")
const TabIcon = () => null
const TABS = [
  {
    id: "command",
    label: "Command",
    icon: TabIcon,
    badge: () => 0,
    component: Panel,
  },
]

mock.module("@/components/inspector/registry", () => ({
  INSPECTOR_TABS: TABS,
  getInspectorTab: () => TABS[0],
}))

mock.module("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }) => React.createElement(React.Fragment, null, children),
}))

mock.module("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ render, children }) =>
    React.cloneElement(render, null, children),
  TooltipContent: () => null,
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
}))

const { SessionInspectorPanel } = await import(
  "../src/components/session-inspector"
)

afterAll(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
  mock.restore()
})

const nav = {
  activeSession: { id: "s1" },
  activeSessionID: "s1",
  inspectorOpen: false,
  inspectorTab: "command",
  inbox: [],
  pendingPermissions: [],
  pendingForms: [],
  runningSessionIDs: {},
  models: [],
  openInspector() {},
  closeInspector() {},
  setInspectorTab() {},
  refreshSessions() {},
  loadInbox() {},
  loadArchivedSessions() {},
}

const fullSession = {
  id: "s1",
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  model: null,
}

async function render(hidden, overrides = {}) {
  let root
  await act(async () => {
    root = create(
      React.createElement(SessionInspectorPanel, {
        nav: { ...nav, ...overrides },
        onOpenSettings() {},
        onOpenWorktrees() {},
        hidden,
      })
    )
  })
  return root
}

const rail = (root) =>
  root.root.find((node) => node.props["data-inspector-mode"] === "rail")
const full = (root) =>
  root.root.find((node) => node.props["data-inspector-mode"] === "full")

test("hiding the inspector keeps its root mounted but inert", async () => {
  const root = await render(true)
  try {
    const aside = rail(root)
    expect(aside.props.hidden).toBe(true)
    expect(aside.props["aria-hidden"]).toBe(true)
    expect(aside.props.inert).toBe(true)
    expect(aside.props.className.split(" ")).toContain("hidden")
    expect(aside.props.className.split(" ")).not.toContain("flex")
  } finally {
    await act(async () => root.unmount())
  }
})

test("showing the inspector restores its flex root", async () => {
  const root = await render(false)
  try {
    const aside = rail(root)
    expect(aside.props.hidden).toBeUndefined()
    expect(aside.props["aria-hidden"]).toBeUndefined()
    expect(aside.props.inert).toBeUndefined()
    expect(aside.props.className.split(" ")).toContain("flex")
  } finally {
    await act(async () => root.unmount())
  }
})

  const root = await render(true, {
    inspectorOpen: true,
    activeSession: fullSession,
    activeSessionID: fullSession.id,
  })
  try {
    const aside = full(root)
    expect(aside.props.hidden).toBe(true)
    expect(aside.props["aria-hidden"]).toBe(true)
    expect(aside.props.inert).toBe(true)
    expect(aside.props.className.split(" ")).toContain("hidden")
    expect(aside.props.className.split(" ")).not.toContain("flex")
  } finally {
    await act(async () => root.unmount())
  }

  const visible = await render(false, {
    inspectorOpen: true,
    activeSession: fullSession,
    activeSessionID: fullSession.id,
  })
  try {
    const aside = full(visible)
    expect(aside.props.hidden).toBeUndefined()
    expect(aside.props.className.split(" ")).toContain("flex")
  } finally {
    await act(async () => visible.unmount())
  }
})

  const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text()
  expect(app).toContain('<SessionInspectorPanel')
})
