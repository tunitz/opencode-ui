import { afterAll, expect, mock, test } from "bun:test"
import { act, createElement } from "react"

const previousWindow = globalThis.window
globalThis.window = { location: { origin: "http://localhost" } }
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const worktree = {
  list: mock(async () => []),
  create: mock(async () => undefined),
  remove: mock(async () => undefined),
  refresh: mock(async () => undefined),
}
const createWorktreeSession = mock(async () => ({ created: true, error: null }))

mock.module("@/lib/opencode", () => ({
  openCode: { worktree, location: { get: mock(async () => ({ project: { id: "p-alpha" } })) } },
  errorMessage: (failure) => String(failure?.message ?? failure),
}))
mock.module("@/lib/worktree-session", () => ({ createWorktreeSession }))
mock.module("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => createElement("button", { type: "button", ...props }, children),
}))
mock.module("@/components/ui/input", () => ({
  Input: (props) => createElement("input", props),
}))
mock.module("@/components/ui/label", () => ({
  Label: ({ children, ...props }) => createElement("label", props, children),
}))
mock.module("@/components/ui/checkbox", () => ({
  Checkbox: (props) => createElement("input", { type: "checkbox", ...props }),
}))
mock.module("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }) => (open ? createElement("div", null, children) : null),
  AlertDialogContent: ({ children }) => createElement("div", null, children),
  AlertDialogHeader: ({ children }) => createElement("div", null, children),
  AlertDialogTitle: ({ children }) => createElement("div", null, children),
  AlertDialogDescription: ({ children }) => createElement("div", null, children),
  AlertDialogFooter: ({ children }) => createElement("div", null, children),
  AlertDialogCancel: ({ children, ...props }) => createElement("button", { type: "button", ...props }, children),
  AlertDialogAction: ({ children, ...props }) => createElement("button", { type: "button", ...props }, children),
}))
mock.module("@/components/session-command-dialogs", () => ({
  CommandDialogShell: ({ title, description, children, footer }) =>
    createElement("div", null, createElement("h2", null, title), createElement("p", null, description), children, footer),
  ErrorNotice: ({ error }) => (error ? createElement("p", { role: "alert" }, error) : null),
}))
mock.module("@openuidev/react-ui/MetricIndicator", () => ({ MetricIndicatorInline: () => null }))
mock.module("@openuidev/react-ui/Tag", () => ({ Tag: () => null }))
mock.module("@/components/stats-token-chart", () => ({ StatsTokenChart: () => null }))
mock.module("@/components/connect-dialog", () => ({ ConnectDialog: () => null }))

const { create } = await import("react-test-renderer")
const { IntegrationCommandDialogs } = await import("../src/components/integration-command-dialogs")

const projects = [
  { id: "p-alpha", canonical: "/repo/alpha", time: {} },
  { id: "p-beta", canonical: "/repo/beta", time: {} },
  // Duplicate canonical directory: the browser must list it once.
  { id: "p-alpha-alias", canonical: "/repo/alpha/", time: {} },
]

function nav() {
  return {
    projects,
    activeSession: null,
    location: { project: { id: "p-alpha" } },
    agents: [{ id: "build", name: "build", mode: "primary", hidden: false }],
    configEntries: [],
    createSession: mock(async () => true),
    creating: false,
    connection: "connected",
    createError: null,
  }
}

const textOf = (node) =>
  [].concat(node.children ?? []).map((child) => (typeof child === "string" ? child : "")).join("")

const hostButton = (node) => node.type === "button"
const optionsList = (root) =>
  root.root.findAll((node) => node.type === "div" && node.props["data-worktree-options"] === "")

async function settle(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {})
  }
}

async function mountDialog(props = {}) {
  const onClose = mock(() => {})
  const onSessionCreated = mock(() => {})
  let root
  await act(async () => {
    root = create(
      createElement(IntegrationCommandDialogs, {
        kind: "worktrees",
        nav: nav(),
        worktreeProjectID: "p-alpha",
        onClose,
        onResult: () => {},
        onSessionCreated,
        ...props,
      })
    )
  })
  await settle()
  return { root, onClose, onSessionCreated }
}

afterAll(() => {
  mock.restore()
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
  else globalThis.window = previousWindow
})

test("project options stay hidden until the directory field is focused or clicked", async () => {
  worktree.list.mockImplementation(async ({ projectID }) =>
    projectID === "p-alpha"
      ? [
          { directory: "/repo/alpha/.wt/one", strategy: "worktree" },
          { directory: "/repo/alpha", strategy: "root" },
        ]
      : [{ directory: "/repo/beta/.wt/two", strategy: "worktree" }]
  )
  const { root } = await mountDialog()
  try {
    const input = root.root.findByType("input")
    expect(input.props.value).toBe("/repo/alpha")
    expect(input.props.placeholder).toBe("Search or type an absolute path")
    expect(optionsList(root)).toHaveLength(0)

    await act(async () => input.props.onFocus())
    expect(optionsList(root)).toHaveLength(1)

    // The browsed project's base directory is its own row, never duplicated by
    // the native worktree inventory.
    expect(root.root.findAll((node) => hostButton(node) && node.props["data-worktree-base"] === "/repo/alpha")).toHaveLength(1)
    expect(root.root.findAll((node) => hostButton(node) && node.props["data-worktree-worktree"] === "/repo/alpha")).toHaveLength(0)
    const worktreeRow = root.root.findAll(
      (node) => hostButton(node) && node.props["data-worktree-worktree"] === "/repo/alpha/.wt/one"
    )[0]
    expect(worktreeRow).toBeDefined()
    // Picking an option keeps the list mounted: its mousedown never blurs the
    // field.
    let prevented = false
    worktreeRow.props.onMouseDown({ preventDefault: () => { prevented = true } })
    expect(prevented).toBe(true)
    await act(async () => worktreeRow.props.onClick())
    expect(root.root.findByType("input").props.value).toBe("/repo/alpha/.wt/one")
    expect(optionsList(root)).toHaveLength(1)

    // Blur outside the field closes the options.
    const wrapper = root.root.findAll(
      (node) => node.type === "div" && typeof node.props.onBlur === "function"
    )[0]
    await act(async () =>
      wrapper.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
    )
    expect(optionsList(root)).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test("back returns to a de-duplicated project level and selecting a project drills in", async () => {
  worktree.list.mockImplementation(async () => [])
  const { root } = await mountDialog()
  try {
    const input = root.root.findByType("input")
    await act(async () => input.props.onFocus())
    await act(async () => root.root.findByProps({ "data-worktree-back": "" }).props.onClick())

    expect(root.root.findByType("input").props.value).toBe("")
    const projectRows = root.root.findAll(
      (node) => hostButton(node) && typeof node.props["data-worktree-project"] === "string"
    )
    expect(projectRows.map((row) => row.props["data-worktree-project"])).toEqual([
      "/repo/alpha",
      "/repo/beta",
    ])

    const beta = projectRows.find((row) => row.props["data-worktree-project"] === "/repo/beta")
    await act(async () => beta.props.onClick())
    expect(root.root.findByType("input").props.value).toBe("/repo/beta")
    expect(worktree.list).toHaveBeenLastCalledWith({ projectID: "p-beta" })
    expect(optionsList(root)).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
  }
})

test("a custom path resolves to the nearest known project and gates the session action", async () => {
  worktree.list.mockImplementation(async () => [])
  const { root, onClose, onSessionCreated } = await mountDialog()
  try {
    let input = root.root.findByType("input")
    await act(async () => input.props.onFocus())

    const primaryButton = () =>
      root.root
        .findAllByType("button")
        .find((button) => textOf(button).includes("New session here"))

    await act(async () =>
      input.props.onChange({ target: { value: "/elsewhere/unrelated" } })
    )
    expect(primaryButton().props.disabled).toBe(true)
    expect(JSON.stringify(root.toJSON())).toContain("No project matches this path.")

    await act(async () =>
      input.props.onChange({ target: { value: "/repo/alpha/worktrees/two" } })
    )
    expect(primaryButton().props.disabled).toBe(false)

    await act(async () => primaryButton().props.onClick())
    await settle(4)
    expect(createWorktreeSession).toHaveBeenLastCalledWith(
      "/repo/alpha/worktrees/two",
      "p-alpha",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    expect(onSessionCreated).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(worktree.list.mock.calls.length).toBeGreaterThan(0)
  } finally {
    await act(async () => root.unmount())
  }
})
