import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { mock } from "bun:test"
import { createWorktreeSession } from "../src/lib/worktree-session.ts"
import { createDefaultPreferences } from "../src/lib/web-ui-preferences.ts"

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

function fixture(project = "project", models = [{ providerID: "p", id: "m", variants: [] }]) {
  const calls = []
  const client = {
    location: { get: mock(async (arg) => { calls.push(arg); return { project: { id: project } } }) },
    agent: { list: mock(async (arg) => { calls.push(arg); return { data: [] } }) },
    model: { list: mock(async (arg) => { calls.push(arg); return { data: models } }) },
  }
  const preferences = createDefaultPreferences("https://example.test", "2.1.4")
  preferences.global.model = { providerID: "p", modelID: "m" }
  return { client, preferences, calls }
}

test("worktree creation validates project before loading the catalog", async () => {
  const { client, preferences } = fixture("other")
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", preferences, create, client)
  expect(result.error).toContain("no longer belongs")
  expect(client.model.list).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation blocks an unavailable saved model", async () => {
  const { client, preferences } = fixture("project", [])
  const create = mock(async () => true)
  const result = await createWorktreeSession("/work/tree", "project", preferences, create, client)
  expect(result.error).toContain("unavailable")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation does not submit when the target catalog fails", async () => {
  const { client, preferences } = fixture()
  client.model.list = mock(async () => { throw new Error("Catalog unavailable") })
  const create = mock(async () => true)
  await expect(createWorktreeSession("/work/tree", "project", preferences, create, client)).rejects.toThrow("Catalog unavailable")
  expect(create).not.toHaveBeenCalled()
})

test("worktree creation uses the target catalog and propagates success and failure", async () => {
  const { client, preferences, calls } = fixture()
  const create = mock(async () => true)
  expect(await createWorktreeSession("/work/tree", "project", preferences, create, client)).toEqual({ created: true, error: null })
  expect(calls).toEqual(Array(3).fill({ location: { directory: "/work/tree" } }))
  expect(create).toHaveBeenCalledWith("project", { agentID: null, model: { providerID: "p", id: "m" } }, "/work/tree")
  expect((await createWorktreeSession("/work/tree", "project", preferences, async () => false, client)).error).toBe("Session creation failed.")
})

test("the shared new-session dialog accepts a preselected worktree directory", () => {
  expect(dialog).toContain("initialDirectory?: string")
  expect(dialog).toContain("expectedProjectID?: string")
  expect(dialog).toContain("newSessionProjectError(selectedID, expectedProjectID)")
  expect(dialog).toMatch(
    /const created = await createSession\(\s*selectedID,\s*\{ agentID: resolution\.agentID, model: resolution\.model \},\s*directory\s*\)/
  )
})

test("the create form prefills the saved parent directory without clobbering edits", () => {
  expect(dialogs).toContain("useWebUiPreferences()")
  expect(dialogs).toContain("worktreeParentDirectoryPrefill(")
  expect(dialogs).toMatch(
    /const savedWorktreeParentDirectory = preferencesStore\.ready\s*\?\s*worktreeParentDirectoryPrefill\(\s*preferencesStore\.preferences\.global\.worktreeParentDirectory\s*\)\s*:\s*""/
  )
  expect(dialogs).toContain("const directory = directoryDraft ?? savedWorktreeParentDirectory")
  expect(dialogs).toMatch(/function openCreate\(\) \{\s*setDirectoryDraft\(null\)\s*setMode\("create"\)\s*\}/)
  expect(dialogs).toContain("setDirectoryDraft(event.target.value)")
  expect(dialogs).toMatch(/setDirectoryDraft\(null\)\s*setMode\("list"\)/)
  expect(dialogs).toMatch(
    /if \(!projectID \|\| creating \|\| invalidDirectory \|\| !preferencesStore\.ready\) return/
  )
  expect(dialogs).toContain("disabled={creating || invalidDirectory || !preferencesStore.ready}")
  expect(dialogs).toContain("Loading saved directory defaults…")
})

test("preset overrides retain non-model global defaults", () => {
  expect(dialog).toContain("...preferencesStore.preferences.global")
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
