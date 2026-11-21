import { expect, test, mock } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  createWorktreeSession,
  resolveWorktreeSelection,
} from "../src/lib/worktree-session.ts"

const dialogs = await readFile("src/components/integration-command-dialogs.tsx", "utf8")
const dialog = await readFile("src/components/new-session-dialog.tsx", "utf8")

test("the worktree browser starts a session in the resolved project or worktree path", () => {
  expect(dialogs).toContain('from "@/components/directory-browser"')
  expect(dialogs).toContain("<DirectoryBrowser")
  expect(dialogs).toContain('label="Project or worktree directory"')
  expect(dialogs).toContain("const target = useMemo(")
  expect(dialogs).toContain('await resolveWorktreeSelection(\n        target.directory,\n        target.projectID,\n        openCode\n      )')
  expect(dialogs).toContain(
    "const result = await createWorktreeSession(\n        preview.directory,\n        preview.projectID,\n        nav.createSession,\n        openCode,\n        preview.selection\n      )"
  )
  expect(dialogs).toContain("may incur costs")
  expect(dialogs).toContain("onClick={() => void startSession()}")
  expect(dialogs).toContain("New session here")
  expect(dialogs).toContain("sessionPending.current = true")
  expect(dialogs).toContain("sessionPending.current || nav.creating")
  expect(dialogs).not.toContain("<NewSessionDialog")
  expect(dialogs).toMatch(/onSessionCreated\?\.\(\)\s*onResult\(/)
  expect(dialogs).toContain("result.model.providerID}/${result.model.id}")
})

test("worktree session creation returns to chat through the shared guard", async () => {
  const navigation = await readFile("src/components/session-nav.tsx", "utf8")
  const commandCenter = await readFile("src/components/command-center.tsx", "utf8")
  expect(
    navigation.match(/onSessionCreated=\{\(\) => leaveToChat\(\(\) => \{\}\)\}/g)
  ).toHaveLength(2)
  expect(commandCenter).toContain("onSessionCreated={closeNotes}")
})

test("worktree rows show a derived name, the full path, and an icon-only 44px remove action", () => {
  expect(dialogs).toContain("name: worktreeDisplayName(entry.directory)")
  expect(dialogs).toContain("{row.name}")
  expect(dialogs).toMatch(
    /<span className="truncate text-xs text-muted-foreground" dir="auto" title=\{row\.directory\}>\s*\{row\.directory\}/
  )
  expect(dialogs).toMatch(
    /size="icon-lg"\s*className="size-11 shrink-0"\s*aria-label=\{`Remove \$\{row\.directory\}`\}/
  )
  expect(dialogs).toContain("data-worktree-worktree={row.directory}")
  expect(dialogs).toContain("openCode.worktree.list({ projectID: activeSourceProjectID })")
  expect(dialogs).toContain("No worktrees for this directory.")
  expect(dialogs).toContain("No saved worktrees.")
  expect(dialogs).toContain("Create worktree")
  expect(dialogs).not.toContain("data-worktree-project")
  expect(dialogs).not.toContain("data-worktree-base")
  expect(dialogs).not.toContain('data-worktree-back=""')
  expect(dialogs).not.toContain("Back to projects")
  expect(dialogs).not.toContain("browsedProjectID")
})

const MODEL = (id, variants = []) => ({
  id,
  providerID: "engine",
  name: id,
  enabled: true,
  status: "active",
  variants: variants.map((variant) => ({ id: variant })),
})
const AGENT = (model) => ({
  id: "build",
  name: "Build",
  mode: "primary",
  hidden: false,
  ...(model ? { model } : {}),
})

function fixture({
  project = "project",
  agents = [AGENT({ providerID: "engine", id: "agent-model" })],
  configEntries = [],
  models = [MODEL("agent-model"), MODEL("engine-default")],
  defaultModel = MODEL("engine-default"),
  locationFailure = null,
} = {}) {
  const calls = []
  const engine = {
    location: {
      get: mock(async (arg) => {
        calls.push(["location", arg])
        if (locationFailure) throw new Error(locationFailure)
        return { project: { id: project } }
      }),
    },
    agent: {
      list: mock(async (arg) => {
        calls.push(["agent", arg])
        return { data: agents }
      }),
    },
    config: {
      get: mock(async (arg) => {
        calls.push(["config", arg])
        return configEntries
      }),
    },
    model: {
      list: mock(async (arg) => {
        calls.push(["models", arg])
        return { data: models }
      }),
      default: mock(async (arg) => {
        calls.push(["default", arg])
        return { data: defaultModel }
      }),
    },
  }
  return { engine, calls }
}

const destinationCalls = (calls) =>
  calls.filter(([kind]) => kind !== "location").map(([kind, arg]) => [kind, arg.location.directory])

test("the worktree preview resolves the destination selection without creating a session", async () => {
  const { engine } = fixture({ agents: [AGENT(null)] })
  const preview = await resolveWorktreeSelection("/work/tree", "project", engine)
  expect(preview.error).toBeNull()
  expect(preview.selection).toEqual({
    agentID: "build",
    model: { providerID: "engine", id: "engine-default" },
    modelSource: "engine-default",
  })
  const create = mock(async () => true)
  const result = await createWorktreeSession(
    "/work/tree",
    "project",
    create,
    engine,
    preview.selection
  )
  expect(result.created).toBe(true)
  expect(create).toHaveBeenCalledTimes(1)
})

test("worktree creation validates the destination project before any catalog read", async () => {
  const { engine, calls } = fixture({ project: "other" })
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result.error).toContain("no longer belongs")
  expect(result.created).toBe(false)
  expect(create).not.toHaveBeenCalled()
  expect(calls).toEqual([
    ["location", { location: { directory: "/work/tree" } }],
  ])
})

test("worktree creation reports a destination location failure without creating", async () => {
  const { engine, calls } = fixture({ locationFailure: "Catalog unavailable" })
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result.created).toBe(false)
  expect(result.error).toBe("Catalog unavailable")
  expect(result.model).toBeNull()
  expect(create).not.toHaveBeenCalled()
  expect(calls).toHaveLength(1)
})

test("worktree creation reads agents, config, models and default from the worktree directory", async () => {
  const { engine, calls } = fixture()
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result).toEqual({
    created: true,
    error: null,
    model: { providerID: "engine", id: "agent-model" },
  })
  expect(destinationCalls(calls)).toEqual([
    ["agent", "/work/tree"],
    ["config", "/work/tree"],
    ["models", "/work/tree"],
    ["default", "/work/tree"],
  ])
  expect(create).toHaveBeenCalledWith(
    "project",
    { agentID: "build", model: { providerID: "engine", id: "agent-model" } },
    "/work/tree"
  )
})

test("worktree creation uses the pinned engine default when the agent has no model", async () => {
  const { engine } = fixture({ agents: [AGENT(null)] })
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result.model).toEqual({ providerID: "engine", id: "engine-default" })
  expect(create).toHaveBeenCalledWith(
    "project",
    { agentID: "build", model: { providerID: "engine", id: "engine-default" } },
    "/work/tree"
  )
})

test("worktree creation preserves the configured variant when it is supported", async () => {
  const { engine } = fixture({
    agents: [
      AGENT({ providerID: "engine", id: "agent-model", variant: "high" }),
    ],
    models: [MODEL("agent-model", ["low", "high"])],
  })
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result.model).toEqual({
    providerID: "engine",
    id: "agent-model",
    variant: "high",
  })
})

test("worktree creation preserves an unsupported variant and blocks instead of substituting", async () => {
  const { engine } = fixture({
    agents: [
      AGENT({ providerID: "engine", id: "agent-model", variant: "missing" }),
    ],
    models: [MODEL("agent-model", ["low"])],
    defaultModel: MODEL("engine-default"),
  })
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result.created).toBe(false)
  expect(result.error).toContain("unavailable at this folder")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation never falls back to a hardcoded model", async () => {
  const { engine } = fixture({
    agents: [AGENT(null)],
    defaultModel: null,
    models: [MODEL("some-paid-model")],
  })
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", create, engine)
  expect(result.created).toBe(false)
  expect(result.error).toContain("No model is configured")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation surfaces a failed create without inventing a model", async () => {
  const { engine } = fixture()
  const result = await createWorktreeSession(
    "/work/tree",
    "project",
    async () => false,
    engine
  )
  expect(result.created).toBe(false)
  expect(result.error).toBe("Session creation failed.")
  expect(result.model).toEqual({ providerID: "engine", id: "agent-model" })
})

test("the shared new-session dialog selects from the destination catalog", () => {
  expect(dialog).toContain("initialDirectory?: string")
  expect(dialog).toContain("expectedProjectID?: string")
  expect(dialog).toContain("newSessionProjectError(selectedID, expectedProjectID)")
  expect(dialog).toContain("selected.location?.project.id ?? null")
  expect(dialog).toContain('aria-label="New session agent and model"')
  expect(dialog).toContain("useTargetCatalog(catalogDirectory)")
  expect(dialog).toContain("const catalogDirectory = resolved?.directory ?? null")
  expect(dialog).toContain("configEntries: catalog.configEntries")
  expect(dialog).toContain("agentModelDefaults(agent)")
  expect(dialog).toContain('catalog.status === "ready"')
  expect(dialog).toContain("catalogMatchesTarget")
  expect(dialog).toContain("catalog.directory === selected?.location?.directory")
  expect(dialog).toContain("selected?.directory === directory &&")
  expect(dialog).toContain("Engine default model:")
  expect(dialog).toMatch(
    /const created = await createSession\(\s*selectedID,\s*\{ agentID: draft\.agentID, model: draft\.model \},\s*directory\s*\)/
  )
})

test("the sidebar trigger still opens the shared dialog with the default folder", () => {
  expect(dialog).toContain("export function NewSessionButton")
  expect(dialog).toContain("<NewSessionDialog")
  expect(dialog).toContain('initialDirectory={nav.location?.directory ?? ""}')
})

test("the dialog resets transient state on open instead of remounting", () => {
  expect(dialog).not.toContain("key={sessionKey}")
  expect(dialog).not.toContain("sessionKey")
  expect(dialog).toContain("wasOpenRef")
  expect(dialog).toContain("initialTarget(initialDirectory)")
  expect(dialog).toContain("type TargetState")
})

test("an unavailable folder is surfaced honestly while the picker stays mounted", () => {
  expect(dialog).toContain("resolveNewSessionDefaults")
  expect(dialog).toContain("catalogDirectory")
  expect(dialog).toContain("setModified(true)")
  expect(dialog).toContain("catalogMatchesTarget")

  expect(dialog).toContain("{draft ? (")
  expect(dialog).not.toMatch(/selectedID\s*&&\s*draft/)
  expect(dialog).not.toMatch(/draft\s*&&\s*selectedID/)
  expect(dialog).toContain('folder === "unavailable"')
  expect(dialog).toContain("Selected session folder unavailable.")

  const canCreateBlock =
    dialog.match(
      /const canCreate =([\s\S]*?)\n\n  function handleAgentChange/
    )?.[1] ?? ""
  expect(canCreateBlock).toContain("Boolean(selectedID)")
  expect(canCreateBlock).toContain('catalog.status === "ready"')
  expect(canCreateBlock).toContain("!draftUnavailable")
  expect(dialog).toMatch(/if \(!canCreate \|\| !selectedID \|\| !draft\?\.model\)/)
})
