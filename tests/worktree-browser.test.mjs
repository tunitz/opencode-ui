import { afterAll, beforeEach, expect, mock, test } from "bun:test"
import { act, createElement } from "react"
import { resetWorktreeCacheForTests } from "../src/lib/worktree-cache.ts"

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
const resolveWorktreeSelection = mock(async () => ({
  selection: {
    agentID: "build",
    model: { providerID: "p", id: "m" },
    modelSource: "engine-default",
  },
  error: null,
}))

mock.module("@/lib/opencode", () => ({
  openCode: { worktree, location: { get: mock(async () => ({ project: { id: "p-alpha" } })) } },
  errorMessage: (failure) => String(failure?.message ?? failure),
}))
mock.module("@/lib/worktree-session", () => ({ createWorktreeSession, resolveWorktreeSelection }))
let activeConnectionId = "profile-a"
let activeConnectionGeneration = 0
mock.module("@/lib/use-active-connection", () => ({
  useActiveConnection: () => ({
    connectionId: activeConnectionId,
    ready: true,
    generation: activeConnectionGeneration,
  }),
}))
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

const textOf = (node) => {
  if (typeof node === "string") return node
  if (!node || typeof node !== "object") return ""
  return [].concat(node.children ?? []).map(textOf).join("")
}

const hostButton = (node) => node.type === "button"
const optionsList = (root) =>
  root.root.findAll(
    (node) => node.type === "div" && node.props["data-directory-options"] === true
  )
const directoryRows = (root) =>
  root.root.findAll(
    (node) => hostButton(node) && typeof node.props["data-directory"] === "string"
  )
const worktreeRow = (root, directory) =>
  root.root.findAll(
    (node) => hostButton(node) && node.props["data-worktree-worktree"] === directory
  )[0]

async function settle(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {})
  }
}

/** The browser fetches one level behind a small debounce. */
async function settleList() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260))
  })
}

const treeFetch = (trees) => {
  const requests = []
  const fetch = async (url) => {
    const parsed = new URL(String(url), "http://localhost")
    const location = parsed.searchParams.get("location[directory]") ?? "/"
    requests.push(location)
    return new Response(JSON.stringify({ data: trees[location] ?? [] }), {
      headers: { "content-type": "application/json" },
    })
  }
  return { requests, fetch }
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

beforeEach(() => {
  resetWorktreeCacheForTests()
  worktree.list.mockClear()
  worktree.list.mockImplementation(async () => [])
  worktree.create.mockClear()
  worktree.remove.mockClear()
  worktree.refresh.mockClear()
  createWorktreeSession.mockClear()
  createWorktreeSession.mockImplementation(async () => ({ created: true, error: null }))
  resolveWorktreeSelection.mockClear()
  resolveWorktreeSelection.mockImplementation(async () => ({
    selection: {
      agentID: "build",
      model: { providerID: "p", id: "m" },
      modelSource: "engine-default",
    },
    error: null,
  }))
})

afterAll(() => {
  mock.restore()
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
  else globalThis.window = previousWindow
})

test("the shared browser stays hidden until used and the contextual worktrees follow the project", async () => {
  const previousFetch = globalThis.fetch
  const { requests, fetch } = treeFetch({
    "/repo/alpha": [{ path: "src", type: "directory" }],
    "/repo/alpha/.wt/one": [{ path: "packages", type: "directory" }],
  })
  globalThis.fetch = fetch
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
    expect(root.root.findAllByType("label")[0].children).toContain(
      "Project or worktree directory"
    )
    expect(optionsList(root)).toHaveLength(0)

    // Worktrees are contextual, visible before the browser is opened, and the
    // browsed project's own directory is never a worktree row.
    expect(worktreeRow(root, "/repo/alpha/.wt/one")).toBeDefined()
    expect(worktreeRow(root, "/repo/alpha")).toBeUndefined()
    expect(worktree.list).toHaveBeenLastCalledWith({ projectID: "p-alpha" })

    await act(async () => input.props.onFocus())
    expect(optionsList(root)).toHaveLength(1)
    await settleList()
    expect(requests.at(-1)).toBe("/repo/alpha")
    expect(directoryRows(root).map((row) => row.props["data-directory"])).toEqual([
      "/repo/alpha/src",
    ])

    // Picking the worktree row fills the input and drills.
    const row = worktreeRow(root, "/repo/alpha/.wt/one")
    await act(async () => row.props.onClick())
    expect(root.root.findByType("input").props.value).toBe("/repo/alpha/.wt/one")
    expect(optionsList(root)).toHaveLength(1)
    await settleList()
    expect(requests.at(-1)).toBe("/repo/alpha/.wt/one")
    expect(directoryRows(root).map((row) => row.props["data-directory"])).toEqual([
      "/repo/alpha/.wt/one/packages",
    ])
    // The selected worktree still belongs to the project, so its siblings remain.
    expect(worktreeRow(root, "/repo/alpha/.wt/one")).toBeDefined()

    // Blur outside the field closes the options.
    const wrapper = root.root.findAll(
      (node) => node.type === "div" && typeof node.props.onBlur === "function"
    )[0]
    await act(async () => wrapper.props.onBlur({ relatedTarget: null }))
    expect(optionsList(root)).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
  }
})

test("the directory browser drills through folders and up rows with no project level", async () => {
  const previousFetch = globalThis.fetch
  const { requests, fetch } = treeFetch({
    "/repo/alpha": [{ path: "src", type: "directory" }],
    "/repo": [
      { path: "alpha", type: "directory" },
      { path: "beta", type: "directory" },
    ],
    "/repo/beta": [{ path: "packages", type: "directory" }],
  })
  globalThis.fetch = fetch
  worktree.list.mockImplementation(async ({ projectID }) =>
    projectID === "p-alpha"
      ? [{ directory: "/repo/alpha/.wt/one", strategy: "worktree" }]
      : [{ directory: "/repo/beta/.wt/two", strategy: "worktree" }]
  )
  const { root } = await mountDialog()
  try {
    const input = root.root.findByType("input")
    await act(async () => input.props.onFocus())
    await settleList()
    const up = root.root
      .findAllByType("button")
      .find((node) => node.props["data-directory-parent"] === "/repo")
    expect(up).toBeDefined()
    expect(root.root.findAllByProps({ "data-worktree-back": "" })).toHaveLength(0)
    expect(root.root.findAllByProps({ "data-worktree-project": "/repo/beta" })).toHaveLength(0)

    await act(async () => up.props.onClick())
    expect(root.root.findByType("input").props.value).toBe("/repo")
    await settleList()
    expect(requests.at(-1)).toBe("/repo")
    expect(directoryRows(root).map((row) => row.props["data-directory"])).toEqual([
      "/repo/alpha",
      "/repo/beta",
    ])
    expect(
      root.root.findAllByType("button").find(
        (node) => node.props["data-directory-parent"] === "/"
      )
    ).toBeDefined()
    const beta = root.root
      .findAllByType("button")
      .find((node) => node.props["data-directory"] === "/repo/beta")
    await act(async () => beta.props.onClick())
    expect(root.root.findByType("input").props.value).toBe("/repo/beta")
    await settle()
    expect(worktree.list).toHaveBeenLastCalledWith({ projectID: "p-beta" })
    expect(worktreeRow(root, "/repo/beta/.wt/two")).toBeDefined()
    expect(worktreeRow(root, "/repo/alpha/.wt/one")).toBeUndefined()
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
  }
})

test("a custom path resolves to the nearest known project and gates the session action", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
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
    expect(JSON.stringify(root.toJSON())).toContain("No worktrees for this directory.")

    await act(async () =>
      input.props.onChange({ target: { value: "/repo/alpha/worktrees/two" } })
    )
    expect(primaryButton().props.disabled).toBe(false)
    // One active project now drives the list, Create/Refresh and session start.
    const actionButton = (name) =>
      root.root
        .findAllByType("button")
        .find((button) => textOf(button).includes(name))
    expect(actionButton("Refresh").props.disabled).toBe(false)
    expect(actionButton("Create worktree").props.disabled).toBe(false)
    expect(JSON.stringify(root.toJSON())).toContain("No saved worktrees.")

    await act(async () => primaryButton().props.onClick())
    await settle(4)
    // The engine choice is shown before any session creation.
    expect(createWorktreeSession).not.toHaveBeenCalled()
    expect(actionButton("Start session")).toBeDefined()
    const previewText = textOf(root.root)
    expect(previewText).toContain("Model:")
    expect(previewText).toContain("p/m")
    expect(previewText).toContain("may incur costs")
    await act(async () => actionButton("Start session").props.onClick())
    await settle(4)
    expect(createWorktreeSession).toHaveBeenLastCalledWith(
      "/repo/alpha/worktrees/two",
      "p-alpha",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: { providerID: "p", id: "m" } })
    )
    expect(onSessionCreated).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
  }
})

test("removing a contextual worktree keeps the confirmation and force opt-in", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
  worktree.list.mockImplementation(async () => [
    { directory: "/repo/alpha/.wt/one", strategy: "worktree" },
  ])
  const { root } = await mountDialog()
  try {
    const remove = root.root.findByProps({
      "aria-label": "Remove /repo/alpha/.wt/one",
    })
    await act(async () => remove.props.onClick())
    expect(JSON.stringify(root.toJSON())).toContain("Remove worktree?")

    const checkbox = root.root
      .findAllByType("input")
      .find((node) => node.props.type === "checkbox")
    await act(async () => checkbox.props.onCheckedChange(true))

    const confirm = root.root
      .findAllByType("button")
      .find((button) => textOf(button).includes("Remove worktree"))
    await act(async () => confirm.props.onClick())
    await settle(4)
    expect(worktree.remove).toHaveBeenCalledWith({
      projectID: "p-alpha",
      directory: "/repo/alpha/.wt/one",
      force: true,
    })
    expect(worktree.list.mock.calls.length).toBeGreaterThan(0)
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
  }
})

function worktreeButtons(root) {
  return root.root.findAllByType("button")
}
function worktreeButton(root, label) {
  return worktreeButtons(root).find((button) => textOf(button).includes(label))
}

test("a connection switch invalidates an unconfirmed worktree preview", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
  activeConnectionId = "profile-a"
  activeConnectionGeneration = 7
  const navA = nav()
  const { root } = await mountDialog({ nav: navA })
  try {
    const input = root.root.findByType("input")
    await act(async () =>
      input.props.onChange({ target: { value: "/repo/alpha/worktrees/two" } })
    )
    await act(async () => worktreeButton(root, "New session here").props.onClick())
    await settle(4)
    expect(createWorktreeSession).not.toHaveBeenCalled()
    expect(worktreeButton(root, "Start session")).toBeDefined()

    // Same path and project, different engine profile/generation.
    activeConnectionId = "profile-b"
    activeConnectionGeneration = 8
    await act(async () =>
      root.update(
        createElement(IntegrationCommandDialogs, {
          kind: "worktrees",
          nav: navA,
          worktreeProjectID: "p-alpha",
          onClose: () => {},
          onResult: () => {},
          onSessionCreated: () => {},
        })
      )
    )
    await settle(2)
    expect(worktreeButton(root, "Start session")).toBeUndefined()
    expect(createWorktreeSession).not.toHaveBeenCalled()

    // A fresh preview under the new profile still works.
    await act(async () => worktreeButton(root, "New session here").props.onClick())
    await settle(4)
    const start = worktreeButton(root, "Start session")
    expect(start).toBeDefined()
    await act(async () => start.props.onClick())
    await settle(4)
    expect(createWorktreeSession).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    activeConnectionId = "profile-a"
    activeConnectionGeneration = 0
  }
})

test("an unrelated catalog epoch update leaves the worktree preview open", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
  activeConnectionId = "profile-a"
  activeConnectionGeneration = 11
  const navA = { ...nav(), catalogEpoch: 1 }
  const { root } = await mountDialog({ nav: navA })
  try {
    const input = root.root.findByType("input")
    await act(async () =>
      input.props.onChange({ target: { value: "/repo/alpha/worktrees/two" } })
    )
    await act(async () => worktreeButton(root, "New session here").props.onClick())
    await settle(4)
    expect(worktreeButton(root, "Start session")).toBeDefined()

    // Slash-command catalog loads bump catalogEpoch; connection is unchanged.
    await act(async () =>
      root.update(
        createElement(IntegrationCommandDialogs, {
          kind: "worktrees",
          nav: { ...navA, catalogEpoch: 9 },
          worktreeProjectID: "p-alpha",
          onClose: () => {},
          onResult: () => {},
          onSessionCreated: () => {},
        })
      )
    )
    await settle(2)
    expect(worktreeButton(root, "Start session")).toBeDefined()
    expect(createWorktreeSession).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    activeConnectionGeneration = 0
  }
})

test("an in-flight worktree preview cannot resurrect after a connection switch", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
  activeConnectionId = "profile-a"
  activeConnectionGeneration = 20
  const navA = nav()
  let release
  resolveWorktreeSelection.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const { root } = await mountDialog({ nav: navA })
  try {
    const input = root.root.findByType("input")
    await act(async () =>
      input.props.onChange({ target: { value: "/repo/alpha/worktrees/two" } })
    )
    await act(async () => worktreeButton(root, "New session here").props.onClick())

    activeConnectionId = "profile-b"
    activeConnectionGeneration = 21
    await act(async () =>
      root.update(
        createElement(IntegrationCommandDialogs, {
          kind: "worktrees",
          nav: navA,
          worktreeProjectID: "p-alpha",
          onClose: () => {},
          onResult: () => {},
          onSessionCreated: () => {},
        })
      )
    )
    await act(async () => {
      release({
        selection: {
          agentID: "build",
          model: { providerID: "old-engine", id: "stale-model" },
          modelSource: "engine-default",
        },
        error: null,
      })
      await Promise.resolve()
    })
    await settle(4)
    expect(worktreeButton(root, "Start session")).toBeUndefined()
    expect(createWorktreeSession).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    activeConnectionId = "profile-a"
    activeConnectionGeneration = 0
  }
})

test("A→B→A still invalidates a worktree preview from the first profile", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
  activeConnectionId = "profile-a"
  activeConnectionGeneration = 30
  const { root } = await mountDialog()
  const rerender = () =>
    root.update(
      createElement(IntegrationCommandDialogs, {
        kind: "worktrees",
        nav: nav(),
        worktreeProjectID: "p-alpha",
        onClose: () => {},
        onResult: () => {},
        onSessionCreated: () => {},
      })
    )
  try {
    const input = root.root.findByType("input")
    await act(async () =>
      input.props.onChange({ target: { value: "/repo/alpha/worktrees/two" } })
    )
    await act(async () => worktreeButton(root, "New session here").props.onClick())
    await settle(4)
    expect(worktreeButton(root, "Start session")).toBeDefined()

    await act(async () => {
      activeConnectionId = "profile-b"
      activeConnectionGeneration = 31
      rerender()
    })
    await act(async () => {
      activeConnectionId = "profile-a"
      activeConnectionGeneration = 32
      rerender()
    })
    await settle(2)
    expect(worktreeButton(root, "Start session")).toBeUndefined()
    expect(createWorktreeSession).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    activeConnectionId = "profile-a"
    activeConnectionGeneration = 0
  }
})
