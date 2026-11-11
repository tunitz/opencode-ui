import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const navigation = await readFile("src/components/session-nav.tsx", "utf8")
const dialogs = await readFile("src/components/integration-command-dialogs.tsx", "utf8")

test("selecting a session closes Notes and the guarded Settings workspace in both surfaces", () => {
  // Desktop sidebar: inline handler on the shared session list.
  expect(navigation).toContain(
    "onSelect={(sessionID) => { notes.closeNotes(); settings?.requestClose(); nav.selectSession(sessionID) }}"
  )
  // Mobile sessions sheet: multi-line handler.
  expect(navigation).toContain(
    "notes.closeNotes()\n              settings?.requestClose()\n              nav.selectSession(sessionID)"
  )
  // The guarded close keeps unsaved agent edits prompting; the unguarded one is
  // not used for navigation.
  expect(navigation).not.toContain("settings?.closeSettings")
})

test("creating a worktree session from either surface closes Notes and Settings", () => {
  expect(
    navigation.match(
      /onSessionCreated=\{\(\) => \{ notes\.closeNotes\(\); settings\?\.requestClose\(\) \}\}/g
    )
  ).toHaveLength(2)
})

test("the pinned sessions group starts expanded and stays user-collapsible", () => {
  expect(navigation).toContain('<Accordion defaultValue={["pinned"]} className="space-y-2 py-1">')
  // Uncontrolled: no value/onValueChange on the pinned root, so toggling still
  // works after the default opens it.
  const pinned = navigation.slice(
    navigation.indexOf('<Accordion defaultValue={["pinned"]}'),
    navigation.indexOf("</Accordion>", navigation.indexOf('<Accordion defaultValue={["pinned"]}'))
  )
  expect(pinned).not.toContain("value={[")
  expect(pinned).not.toContain("onValueChange")
})

test("the worktree browser hides its option list until the directory field is used", () => {
  expect(dialogs).toContain("const [optionsOpen, setOptionsOpen] = useState(false)")
  expect(dialogs).toContain("onFocus={openOptions}")
  expect(dialogs).toContain("onClick={openOptions}")
  expect(dialogs).toContain("onBlur={(event) => {")
  expect(dialogs).toContain("event.currentTarget.contains(event.relatedTarget as Node | null)")
  expect(dialogs).toContain("setOptionsOpen(false)")
  expect(dialogs).toContain("{optionsOpen ? (")
  expect(dialogs).toContain("max-h-52 min-w-0 overflow-y-auto overscroll-contain rounded-lg border")
  expect(dialogs).toContain("Project or worktree directory")
  expect(dialogs).toContain('placeholder="Search or type an absolute path"')
})

test("picking an option keeps the list mounted", () => {
  expect(dialogs.match(/onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/g)).toHaveLength(3)
  expect(dialogs).toContain("holdOptionsOpen.current = true")
})

test("the worktree browser lists projects then the browsed project's worktrees", () => {
  expect(dialogs).toContain("data-worktree-project={project.directory}")
  expect(dialogs).toContain('data-worktree-back=""')
  expect(dialogs).toContain("<ArrowUpIcon")
  expect(dialogs).toContain("Back to projects")
  expect(dialogs).toContain("data-worktree-base={browsedProject.directory}")
  expect(dialogs).toContain("data-worktree-worktree={row.directory}")
  expect(dialogs).toMatch(
    /setBrowser\(\{\s*query: project\.directory,\s*level: "worktrees",\s*browsedProjectID: project\.id,\s*\}\)/
  )
})

test("the create, refresh, remove, and session actions stay reachable for the browsed project", () => {
  expect(dialogs).toContain("openCode.worktree.create({")
  expect(dialogs).toContain("openCode.worktree.refresh({ projectID: browser.browsedProjectID })")
  expect(dialogs).toContain("openCode.worktree.remove({")
  expect(dialogs).toContain("<AlertDialogTitle>Remove worktree?</AlertDialogTitle>")
  expect(dialogs).toContain("const result = await createWorktreeSession(")
  expect(dialogs).toContain("New session here")
})
