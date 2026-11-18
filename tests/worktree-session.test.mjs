import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { mock } from "bun:test"
import { createWorktreeSession } from "../src/lib/worktree-session.ts"

const dialogs = await readFile("src/components/integration-command-dialogs.tsx", "utf8")
const dialog = await readFile("src/components/new-session-dialog.tsx", "utf8")

test("the worktree browser starts a session in the resolved project or worktree path", () => {
  expect(dialogs).toContain('from "@/components/directory-browser"')
  expect(dialogs).toContain("<DirectoryBrowser")
  expect(dialogs).toContain('label="Project or worktree directory"')
  expect(dialogs).toContain("const target = useMemo(")
  expect(dialogs).toContain('const result = await createWorktreeSession(\n        target.directory,\n        target.projectID,')
  expect(dialogs).toContain("onClick={() => void startSession()}")
  expect(dialogs).toContain("New session here")
  expect(dialogs).toContain("sessionPending.current = true")
  expect(dialogs).toContain("sessionPending.current || nav.creating")
  expect(dialogs).not.toContain("<NewSessionDialog")
  expect(dialogs).toMatch(/onSessionCreated\?\.\(\)\s*onResult\("Session created in the worktree\."\)/)
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
  // The old two-level projects→worktrees navigation is gone.
  expect(dialogs).not.toContain("data-worktree-project")
  expect(dialogs).not.toContain("data-worktree-base")
  expect(dialogs).not.toContain('data-worktree-back=""')
  expect(dialogs).not.toContain("Back to projects")
  expect(dialogs).not.toContain("browsedProjectID")
})

function fixture(
  project = "project",
  agents = [{ id: "build", name: "build", model: { providerID: "p", id: "m" }, mode: "primary", hidden: false }]
) {
  const calls = []
  const location = {
    get: mock(async (arg) => {
      calls.push(arg)
      return { project: { id: project } }
    }),
  }
  return { location, agents, configEntries: [], calls }
}

test("worktree creation validates project before resolving the default agent", async () => {
  const { location, agents, configEntries } = fixture("other")
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", agents, configEntries, create, location)
  expect(result.error).toContain("no longer belongs")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation blocks when the default agent has no model", async () => {
  const { location, configEntries } = fixture("project", [
    { id: "build", name: "build", model: undefined, mode: "primary", hidden: false },
  ])
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", [{ id: "build", mode: "primary", hidden: false }], configEntries, create, location)
  expect(result.error).toContain("No model is configured")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation does not submit when the location fails", async () => {
  const location = { get: mock(async () => { throw new Error("Catalog unavailable") }) }
  const create = mock(async () => true)
  await expect(
    createWorktreeSession("/work/tree", "project", [], [], create, location)
  ).rejects.toThrow("Catalog unavailable")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation uses the default agent's configured model and propagates success", async () => {
  const { location, agents, configEntries, calls } = fixture()
  const create = mock(async () => true)
  expect(await createWorktreeSession("/work/tree", "project", agents, configEntries, create, location)).toEqual({ created: true, error: null })
  expect(calls).toEqual([{ location: { directory: "/work/tree" } }])
  expect(create).toHaveBeenCalledWith(
    "project",
    { agentID: "build", model: { providerID: "p", id: "m" } },
    "/work/tree"
  )
  expect((await createWorktreeSession("/work/tree", "project", agents, configEntries, async () => false, location)).error).toBe("Session creation failed.")
})

test("the shared new-session dialog accepts a preselected worktree directory", () => {
  expect(dialog).toContain("initialDirectory?: string")
  expect(dialog).toContain("expectedProjectID?: string")
  expect(dialog).toContain("newSessionProjectError(selectedID, expectedProjectID)")
  expect(dialog).toContain("selected?.directory === directory ? selected.id : null")
  expect(dialog).toContain('aria-label="New session agent and model"')
  expect(dialog).toContain("agentModelDefaults(agent, targetCatalog.models)")
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
  // Reopening must not remount the dialog (that forced fresh native catalog
  // calls). The new contract is a single batched reset driven by the open
  // transition, with every transient field in one state object.
  expect(dialog).not.toContain("key={sessionKey}")
  expect(dialog).not.toContain("sessionKey")
  expect(dialog).toContain("wasOpenRef")
  expect(dialog).toContain("initialTarget(initialDirectory)")
  expect(dialog).toContain("type TargetState")
})

test("the agent picker stays available when folder location cannot resolve", () => {
  // Browsing into a subfolder or up above the project root makes location.get
  // reject, which nulls selectedID. The picker preview (draft + options) must
  // come from the directory-scoped catalog alone, never from selectedID,
  // otherwise the picker silently vanished during folder navigation.
  const draftBlock = dialog.match(
    /const draft = useMemo<SessionDraft \| null>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);?/
  )?.[0]
  expect(draftBlock).toBeDefined()
  expect(draftBlock).not.toContain("selectedID")
  expect(draftBlock).toContain("defaults")
  expect(draftBlock).toContain("override?.directory === directory")

  // Neither the render guard nor the reason chain may gate the picker on a
  // resolved project; the picker is shown from the ready, directory-scoped
  // catalog and an unavailable folder is surfaced as an honest reason instead.
  expect(dialog).toContain('targetCatalog.status === "ready" && draft')
  expect(dialog).not.toMatch(/selectedID\s*&&\s*draft/)
  expect(dialog).not.toMatch(/draft\s*&&\s*selectedID/)
  expect(dialog).toContain("folder === \"unavailable\"")
  expect(dialog).toContain("Selected session folder unavailable.")

  // Safety preserved: creation still requires a resolved project id.
  const canCreateBlock =
    dialog.match(
      /const canCreate =([\s\S]*?)\n\n  async function handleAgentChange/
    )?.[1] ?? ""
  expect(canCreateBlock).toContain("Boolean(selectedID)")
  expect(canCreateBlock).toContain('targetCatalog.status === "ready"')
  expect(dialog).toMatch(/if \(!canCreate \|\| !selectedID \|\| !draft\?\.model\)/)
})
