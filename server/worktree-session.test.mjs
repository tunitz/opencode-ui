import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { mock } from "bun:test"
import { createWorktreeSession } from "../src/lib/worktree-session.ts"

const dialogs = await readFile("src/components/integration-command-dialogs.tsx", "utf8")
const dialog = await readFile("src/components/new-session-dialog.tsx", "utf8")

test("each saved worktree can start a session in that worktree", () => {
  expect(dialogs).toContain("onClick={() => void startSession(entry)}")
  expect(dialogs).toContain('aria-label={`New session in ${entry.directory}`}')
  expect(dialogs).toContain("sessionPending.current = true")
  expect(dialogs).toContain("sessionPending.current || nav.creating")
  expect(dialogs).not.toContain("<NewSessionDialog")
  expect(dialogs).toMatch(/onSessionCreated\?\.\(\)\s*onResult\("Session created in the worktree\."\)/)
})

test("worktree session creation closes Notes from navigation and command center", async () => {
  const navigation = await readFile("src/components/session-nav.tsx", "utf8")
  const commandCenter = await readFile("src/components/command-center.tsx", "utf8")
  expect(navigation.match(/onSessionCreated=\{notes\.closeNotes\}/g)).toHaveLength(2)
  expect(commandCenter).toContain("onSessionCreated={closeNotes}")
})

test("worktree rows show a derived name, the full path, and an icon-only 44px action", () => {
  expect(dialogs).toContain("{worktreeDisplayName(entry.directory)}")
  expect(dialogs).toMatch(
    /<p dir="ltr" className="[^"]*break-all[^"]*">\{entry\.directory\}/
  )
  expect(dialogs).toMatch(
    /size="icon-lg"\s*className="size-11"\s*aria-label=\{`New session in \$\{entry\.directory\}`\}/
  )
  expect(dialogs).not.toMatch(/<PlusIcon[^>]*\/>\s*New session/)
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
  expect(dialog).toMatch(
    /const created = await createSession\(\s*selectedID,\s*\{ agentID: resolution\.agentID, model: resolution\.model \},\s*directory\s*\)/
  )
})

test("the sidebar trigger still opens the shared dialog with the default folder", () => {
  expect(dialog).toContain("export function NewSessionButton")
  expect(dialog).toContain("<NewSessionDialog")
  expect(dialog).toContain("initialDirectory={DEFAULT_SESSION_DIRECTORY}")
})

test("the trigger remounts the dialog on open instead of resetting state in an effect", () => {
  expect(dialog).not.toContain("useLayoutEffect")
  expect(dialog).toContain("key={sessionKey}")
})
