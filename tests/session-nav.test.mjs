import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const navigation = await readFile("src/components/session-nav.tsx", "utf8")
const dialogs = await readFile("src/components/integration-command-dialogs.tsx", "utf8")
const browser = await readFile("src/components/directory-browser.tsx", "utf8")
const shell = await readFile("src/components/session-command-dialogs.tsx", "utf8")

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

test("the worktree dialog delegates to the shared focus-gated directory browser", () => {
  expect(dialogs).toContain("<DirectoryBrowser")
  expect(dialogs).toContain('id="worktree-browser-directory"')
  expect(dialogs).toContain('label="Project or worktree directory"')
  expect(dialogs).toContain('placeholder="Search or type an absolute path"')
  expect(browser).toContain("const [open, setOpen] = useState(false)")
  expect(browser).toContain("onFocus={() => setOpen(true)}")
  expect(browser).toContain("onBlur={(event) => {")
  expect(browser).toContain("event.relatedTarget as Node | null")
  expect(browser).toContain("max-h-52 min-w-0 overflow-y-auto overscroll-contain rounded-lg border")
})

test("the worktree dialog opens without focusing the directory input and keeps options above the keyboard", () => {
  expect(shell).toContain("initialFocusContent = false")
  expect(shell).toContain("const initialFocus = initialFocusContent ? contentRef : undefined")
  expect(dialogs).toContain("initialFocusContent")
  expect(browser).toContain("window.visualViewport")
  expect(browser).toContain("optionsMaxHeight ? { maxHeight: optionsMaxHeight } : undefined")
})

test("picking an option keeps the list mounted", () => {
  expect(browser.match(/onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
})

test("the dialog is plain directory navigation with contextual worktrees", () => {
  expect(dialogs).toContain("function resolveNearestProject(")
  expect(dialogs).toContain("openCode.worktree.list({ projectID: activeSourceProjectID })")
  expect(dialogs).toContain("data-worktree-worktree={row.directory}")
  expect(dialogs).toContain("No worktrees for this directory.")
  expect(dialogs).not.toContain("Back to projects")
  expect(dialogs).not.toContain('level: "projects"')
})

test("the create, refresh, remove, and session actions stay reachable for the browsed project", () => {
  expect(dialogs).toContain("openCode.worktree.create({")
  expect(dialogs).toContain("openCode.worktree.refresh({ projectID: activeProject.id })")
  expect(dialogs).toContain("openCode.worktree.remove({")
  expect(dialogs).toContain("<AlertDialogTitle>Remove worktree?</AlertDialogTitle>")
  expect(dialogs).toContain("const result = await createWorktreeSession(")
  expect(dialogs).toContain("New session here")
})
