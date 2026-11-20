import { afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import {
  NOTE_ATTACHMENT_LIMITS,
  NotesPanel,
  SpaceScopeBadge,
  insertNoteText,
  isDirtyNoteDraft,
  mergeNoteDraft,
  mergeSpaceDraft,
  noteAttachmentError,
  noteAttachmentMarkdown,
  noteFileReference,
  notePreviewText,
  pinnedNoteInput,
  removeNoteAttachmentReference,
  spaceFilterOptions,
} from "../src/components/notes-panel"
import {
  SpaceDirectoryField,
  browseDirectory,
  canonicalDirectory,
  parentDirectory,
  spaceDirectoryError,
  spaceDirectoryValue,
  subdirectoryPaths,
} from "../src/components/notes-space-editor"
import { NoteStatusLabel } from "../src/components/note-status-label"
import {
  NOTE_STATUSES,
  NOTE_STATUS_CATEGORIES,
  noteStatusCategory,
} from "../src/lib/notes-types"

let previousDocument
beforeEach(() => { previousDocument = globalThis.document; globalThis.document = { addEventListener() {}, removeEventListener() {} } })
afterEach(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })

function environment() {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
  const previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  return () => {
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

const note = (overrides = {}) => ({
  id: "n1",
  title: "Original",
  content: "",
  status: "todo",
  pinned: false,
  spaceID: null,
  revision: 1,
  attachments: [],
  ...overrides,
})

const snapshot = (notes, overrides = {}) => ({
  notes,
  spaces: [],
  workspaceDirectory: "/project",
  ...overrides,
})

test("conflict recovery keeps concurrent moves while preserving user edits", () => {
  const original = { id: "n", title: "Old", content: "Body", status: "todo", pinned: false, spaceID: "first" }
  const latest = { ...original, spaceID: "second", status: "finished", revision: 2 }
  const draft = { title: "My edit", content: "Body", status: "todo", pinned: false, spaceID: "first" }
  expect(mergeNoteDraft(original, draft, latest)).toEqual({ ...draft, spaceID: "second", status: "finished" })
  expect(mergeSpaceDraft({ id: "s", name: "Before", projectDir: "/one" }, { name: "My name", projectDir: "/one" }, { id: "s", name: "Before", projectDir: "/two" })).toEqual({ name: "My name", projectDir: "/two" })
  expect(mergeSpaceDraft({ id: "s", name: "Before", projectDir: null }, { name: "Mine", projectDir: null }, { id: "s", name: "Before", projectDir: null })).toEqual({ name: "Mine", projectDir: null })
})

test("notes panel shows saved notes and distinguishes an empty space", async () => {
  const restore = environment()
  let root
  const adapter = {
    list: async () => snapshot([note({ title: "A plan", content: "Next steps", status: "in-progress", pinned: true })]),
  }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("A plan")
    expect(text).toContain("In progress")
    expect(text).toContain("Pinned")
    expect(text).toContain("No space")
    const row = root.root.findAllByType("button").find((button) => button.props["aria-label"] === "Open A plan")
    expect(row.props["aria-describedby"]).toBe("note-preview-n1 note-meta-n1")
    expect(root.root.findAllByProps({ id: "note-preview-n1" })[0].children).toContain("Next steps")
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("an older list response cannot replace a newer refresh", async () => {
  const restore = environment()
  let root, notify
  const pending = []
  const adapter = {
    list: () => new Promise((resolve) => pending.push(resolve)),
    subscribe: (callback) => { notify = callback; return () => {} },
  }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => notify())
    expect(pending).toHaveLength(2)
    await act(async () => pending[1](snapshot([note({ title: "New version" })])))
    await act(async () => pending[0](snapshot([note({ title: "Old version" })])))
    const rendered = JSON.stringify(root.toJSON())
    expect(rendered).toContain("New version")
    expect(rendered).not.toContain("Old version")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("clicking a note opens a read-only preview and Edit opens the editor", async () => {
  const restore = environment()
  let root
  const adapter = { list: async () => snapshot([note({ content: "Read this body" })]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => root.root.findByProps({ "aria-label": "Open Original" }).props.onClick())
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    expect(JSON.stringify(root.toJSON())).toContain("Read this body")
    expect(JSON.stringify(root.toJSON())).toContain("Back to Notes")
    const edit = root.root.findAllByType("button").find((button) => button.children.includes("Edit"))
    await act(async () => edit.props.onClick())
    expect(root.root.findByType("textarea")).toBeDefined()
    expect(JSON.stringify(root.toJSON())).toContain("Markdown supported")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("a saved note returns to its preview and the editor keeps unsaved drafts", async () => {
  const restore = environment()
  let root, saved
  let notes = [note({ content: "Body" })]
  const adapter = {
    list: async () => snapshot(notes),
    updateNote: async (...args) => {
      saved = args
      notes = notes.map((item) => item.id === args[0] ? { ...item, ...args[1], revision: 2 } : item)
    },
  }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => root.root.findByProps({ "aria-label": "Open Original" }).props.onClick())
    await act(async () => root.root.findAllByType("button").find((button) => button.children.includes("Edit")).props.onClick())
    await act(async () => root.root.findByType("textarea").props.onChange({ target: { value: "My draft" } }))
    expect(JSON.stringify(root.toJSON())).toContain("Unsaved changes")
    const back = root.root.findAllByType("button").find((button) => button.children.includes("Back to Notes"))
    await act(async () => back.props.onClick())
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    await act(async () => root.root.findByProps({ "aria-label": "Open Original" }).props.onClick())
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    await act(async () => root.root.findAllByType("button").find((button) => button.children.includes("Edit")).props.onClick())
    expect(root.root.findByType("textarea").props.value).toBe("My draft")
    await act(async () => root.root.findByType("form").props.onSubmit({ preventDefault() {} }))
    expect(saved).toEqual(["n1", { title: "Original", content: "My draft", status: "todo", pinned: false, spaceID: null }, 1])
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    expect(JSON.stringify(root.toJSON())).toContain("My draft")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("new note opens the editor and a created note returns to its preview", async () => {
  const restore = environment()
  let root
  let notes = []
  const adapter = {
    list: async () => snapshot(notes),
    createNote: async (input) => {
      const created = note({ id: "new-1", ...input })
      notes = [created]
      return { note: created }
    },
  }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const newButton = root.root.findAllByType("button").find((button) => button.children.includes("New note"))
    await act(async () => newButton.props.onClick())
    expect(root.root.findByType("textarea")).toBeDefined()
    const title = root.root.findAllByType("input").find((input) => input.props.required)
    await act(async () => title.props.onChange({ target: { value: "Fresh idea" }, currentTarget: { value: "Fresh idea" } }))
    await act(async () => root.root.findByType("form").props.onSubmit({ preventDefault() {} }))
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    expect(JSON.stringify(root.toJSON())).toContain("Fresh idea")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("an untouched new note is pristine until something is entered", () => {
  const pristine = {
    original: null,
    value: { title: "", content: "", status: "todo", pinned: false, spaceID: null },
  }
  expect(isDirtyNoteDraft(pristine)).toBe(false)
  expect(isDirtyNoteDraft({ ...pristine, value: { ...pristine.value, title: "Idea" } })).toBe(true)
  expect(isDirtyNoteDraft({ ...pristine, value: { ...pristine.value, content: "Body" } })).toBe(true)
  expect(isDirtyNoteDraft({ ...pristine, value: { ...pristine.value, status: "finished" } })).toBe(true)
  expect(isDirtyNoteDraft({ ...pristine, value: { ...pristine.value, pinned: true } })).toBe(true)
  expect(isDirtyNoteDraft({ ...pristine, value: { ...pristine.value, spaceID: "s1" } })).toBe(true)
  const existing = { original: note(), value: { title: "Original", content: "", status: "todo", pinned: false, spaceID: null } }
  expect(isDirtyNoteDraft(existing)).toBe(false)
  expect(isDirtyNoteDraft({ ...existing, value: { ...existing.value, content: "Edited" } })).toBe(true)
})

test("note previews are compact plain text without Markdown syntax", () => {
  expect(notePreviewText("# Notes audit follow-up\n\n---\n\n**Bold** plan")).toBe("Notes audit follow-up — Bold plan")
  expect(notePreviewText("## Plan\n\n- First step\n- [x] Done step\n\n> quoted")).toBe("Plan — First step Done step…")
  expect(notePreviewText("**bold** and [a link](https://example.com) and `code`")).toBe("bold and a link and code")
  expect(notePreviewText("![shot.png](attachment://a1) report")).toBe("shot.png report")
  expect(notePreviewText("")).toBe("")
  expect(notePreviewText("  \n\n  ")).toBe("")
  expect(notePreviewText("use my_var and 2*3")).toBe("use my_var and 2*3")
  expect(notePreviewText("_emphasis_ stays readable")).toBe("emphasis stays readable")
  expect(notePreviewText("Body only")).toBe("Body only")
  const long = "word ".repeat(60).trim()
  const preview = notePreviewText(long)
  expect(preview.endsWith("…")).toBe(true)
  expect(preview.length).toBeLessThanOrEqual(160)
  expect(preview).not.toContain("  ")
  expect(preview).not.toMatch(/\s…$/)
  expect(notePreviewText(long, 40).length).toBeLessThanOrEqual(40)
})

test("note previews skip a repeated title and summarize the first section", () => {
  expect(notePreviewText(
    "HealthVault enhancement — continuous execution\n\nStatus: implemented and verified",
    160,
    "HealthVault enhancement — continuous execution"
  )).toBe("Status: implemented and verified")
  expect(notePreviewText(
    "Implementation prompt\n\nYou are implementing a single, continuous change in opencode-ui at the repository root.",
    160,
    "Inspector prompt"
  )).toBe("Implementation prompt — You are implementing a single, continuous change in opencode-ui at the repository root.")
  expect(notePreviewText("# Plan\n\n# Plan\n\nSecond", 160, "Plan")).toBe("Plan — Second")
})

test("list rows show the plain-text preview instead of the note body", async () => {
  const restore = environment()
  let root
  const content = "# Plan\n\n---\n\n**Ship** [it](https://example.com)\n\n" + "detail ".repeat(300) + "UNIQUETAIL"
  const adapter = { list: async () => snapshot([note({ title: "Long plan", content })]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Plan — Ship it")
    expect(text).not.toContain("**Ship**")
    expect(text).not.toContain("---")
    expect(text).not.toContain("UNIQUETAIL")
    const preview = root.root.findAllByProps({ id: "note-preview-n1" })[0].children[0]
    expect(preview.length).toBeLessThanOrEqual(160)
    expect(preview).not.toContain("\n")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("the notes split layout follows its container, not the viewport", async () => {
  const restore = environment()
  let root
  const adapter = { list: async () => snapshot([note()]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("@container")
    expect(text).toContain("@[40rem]:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.5fr)]")
    expect(text).toContain("@[40rem]:border-s")
    expect(text).not.toContain("md:grid-cols")
    // Only the status-pill row scrolls sideways; the page itself never does.
    const scrollers = root.root.findAll(
      (node) => typeof node.props.className === "string" && node.props.className.includes("overflow-x-auto")
    )
    expect(scrollers).toHaveLength(1)
    expect(scrollers[0].props.className).toContain("min-w-0")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("a new note does not report unsaved changes before typing", async () => {
  const restore = environment()
  let root
  const adapter = { list: async () => snapshot([]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const newButton = root.root.findAllByType("button").find((button) => button.children.includes("New note"))
    await act(async () => newButton.props.onClick())
    expect(JSON.stringify(root.toJSON())).not.toContain("Unsaved changes")
    const title = root.root.findAllByType("input").find((input) => input.props.required)
    await act(async () => title.props.onChange({ target: { value: "Draft" }, currentTarget: { value: "Draft" } }))
    expect(JSON.stringify(root.toJSON())).toContain("Unsaved changes")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("status labels pair text with colour for every state", async () => {
  const restore = environment()
  let root
  try {
    await act(async () => {
      root = create(React.createElement(React.Fragment, null,
        React.createElement(NoteStatusLabel, { status: "idea" }),
        React.createElement(NoteStatusLabel, { status: "todo" }),
        React.createElement(NoteStatusLabel, { status: "in-progress" }),
        React.createElement(NoteStatusLabel, { status: "blocked" }),
        React.createElement(NoteStatusLabel, { status: "finished" }),
        React.createElement(NoteStatusLabel, { status: "cancelled" }),
        React.createElement(NoteStatusLabel, { status: "archived" })))
    })
    const text = JSON.stringify(root.toJSON())
    for (const label of ["Idea", "To do", "In progress", "Blocked", "Finished", "Cancelled", "Archived"])
      expect(text).toContain(label)
    for (const colour of ["text-violet-600", "text-amber-600", "text-sky-600", "text-rose-600", "text-emerald-600", "text-slate-600", "text-stone-600"])
      expect(text).toContain(colour)
    for (const aria of ["Status: Idea", "Status: To do", "Status: In progress", "Status: Blocked", "Status: Finished", "Status: Cancelled", "Status: Archived"])
      expect(text).toContain(aria)
    expect(text).toContain('"role":"img"')
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("status categories group the seven statuses for filters and menus", () => {
  expect(NOTE_STATUSES).toEqual([
    "idea", "todo", "in-progress", "blocked", "finished", "cancelled", "archived",
  ])
  expect(NOTE_STATUS_CATEGORIES.map((category) => [category.label, category.statuses])).toEqual([
    ["Backlog", ["idea", "todo"]],
    ["Active", ["in-progress", "blocked"]],
    ["Done", ["finished", "cancelled", "archived"]],
  ])
  expect(noteStatusCategory("idea")).toBe("backlog")
  expect(noteStatusCategory("blocked")).toBe("active")
  expect(noteStatusCategory("archived")).toBe("done")
})

test("pin input preserves note values and flips only the pin", () => {
  expect(pinnedNoteInput(note({ spaceID: "work", status: "finished" }), true)).toEqual({
    title: "Original", content: "", status: "finished", pinned: true, spaceID: "work",
  })
})

test("attachment validation enforces active types and note limits", () => {
  const existing = [
    { id: "a", name: "a.png", mime: "image/png", size: 3 * 1024 * 1024 },
    { id: "b", name: "b.png", mime: "image/png", size: 3 * 1024 * 1024 },
  ]
  expect(noteAttachmentError({ name: "vector.svg", mime: "image/svg+xml", size: 100 }, [])).toContain("SVG")
  expect(noteAttachmentError({ name: "page.html", mime: "text/html", size: 100 }, [])).toContain("SVG")
  expect(noteAttachmentError({ name: "script.js", mime: "text/javascript", size: 100 }, [])).toContain("SVG")
  expect(noteAttachmentError({ name: "big.png", mime: "image/png", size: 4 * 1024 * 1024 + 1 }, [])).toContain("4 MiB")
  expect(noteAttachmentError({ name: "ok.png", mime: "image/png", size: 100 }, existing)).toBeNull()
  expect(noteAttachmentError({ name: "next.png", mime: "image/png", size: 3 * 1024 * 1024 }, existing)).toContain("8 MiB")
  expect(noteAttachmentError({ name: "five.png", mime: "image/png", size: 1 }, new Array(4).fill(existing[0]))).toContain("at most 4")
})

test("attachment references are inserted at the cursor and removed exactly", () => {
  expect(noteAttachmentMarkdown("shot.png", "image/png", "attachment_1")).toBe("![shot.png](attachment://attachment_1)")
  expect(noteAttachmentMarkdown("report.pdf", "application/pdf", "attachment_2")).toBe("[report.pdf](attachment://attachment_2)")
  expect(noteFileReference("docs/pic.png")).toBe("![pic.png](docs/pic.png)")
  expect(noteFileReference("docs/notes.md")).toBe("[notes.md](docs/notes.md)")
  expect(noteFileReference("docs/my notes.md")).toBe("[my notes.md](<docs/my notes.md>)")
  const inserted = insertNoteText("First\nLast", "![shot](attachment://a1)", 5)
  expect(inserted.value).toBe("First\n![shot](attachment://a1)\nLast")
  const body = "Before\n![shot](attachment://a1)\n[report](attachment://a10)\nAfter"
  expect(removeNoteAttachmentReference(body, "a1")).toBe("Before\n[report](attachment://a10)\nAfter")
  expect(removeNoteAttachmentReference("Before\n![a\\]b](attachment://a1)\nAfter", "a1")).toBe("Before\nAfter")
})

test("attachment limits are advertised and shared by validation", () => {
  expect(NOTE_ATTACHMENT_LIMITS).toEqual({
    count: 4,
    fileSize: 4 * 1024 * 1024,
    totalSize: 8 * 1024 * 1024,
  })
})

test("removing an attachment persists the body reference cleanup", async () => {
  const restore = environment()
  let root, deleted, updated
  const initial = note({
    title: "Files",
    content: "![shot](attachment://a1)\nBody",
    revision: 2,
    attachments: [{ id: "a1", name: "shot.png", mime: "image/png", size: 10 }],
  })
  const adapter = {
    list: async () => snapshot([initial]),
    deleteAttachment: async (...args) => {
      deleted = args
      return { note: { ...initial, attachments: [], revision: 3 } }
    },
    updateNote: async (...args) => {
      updated = args
      return {}
    },
  }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => root.root.findByProps({ "aria-label": "Open Files" }).props.onClick())
    const edit = root.root.findAllByType("button").find((item) => item.children.includes("Edit"))
    await act(async () => edit.props.onClick())
    await act(async () => root.root.findByProps({ "aria-label": "Remove shot.png" }).props.onClick())
    expect(deleted).toEqual(["n1", "a1", 2])
    expect(updated).toEqual([
      "n1",
      { title: "Files", content: "Body", status: "todo", pinned: false, spaceID: null },
      3,
    ])
    expect(root.root.findAllByType("textarea")[0].props.value).toBe("Body")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("space rows are de-duplicated and carry Global/project badges", async () => {
  const restore = environment()
  let root
  const spaces = [
    { id: "global", name: "Ideas", projectDir: null, pinned: true, revision: 1 },
    { id: "work", name: "Work", projectDir: "/synthetic/work", pinned: false, revision: 1 },
    { id: "work", name: "Work", projectDir: "/synthetic/work", pinned: false, revision: 1 },
  ]
  const adapter = { list: async () => snapshot([note()], { spaces }) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    expect(JSON.stringify(root.toJSON())).toContain("Spaces")
    const rows = root.root.findAll((node) => node.type === "p")
    const ideas = rows.filter((row) => row.children.includes("Ideas"))
    const work = rows.filter((row) => row.children.includes("Work"))
    expect(ideas).toHaveLength(1)
    expect(work).toHaveLength(1)
    const badges = root.root.findAllByType(SpaceScopeBadge)
    expect(badges).toHaveLength(2)
    expect(badges.map((badge) => badge.props.space.id).sort()).toEqual(["global", "work"])
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Global")
    expect(text).toContain("work")
    expect(text).toContain('"data-space-scope":"global"')
    expect(text).toContain('"data-space-scope":"project"')
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("status filters are one row of pills with colour dots and no category headers", async () => {
  const restore = environment()
  let root
  const adapter = { list: async () => snapshot([
    { ...note({ id: "one" }), title: "Draft plan" },
    { ...note({ id: "two" }), title: "Shipped feature", status: "finished" },
    { ...note({ id: "three" }), title: "Stuck", status: "blocked" },
  ]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const group = root.root.findAllByProps({ role: "group", "aria-label": "Filter by status" })[0]
    expect(group.props["data-notes-status-filters"]).toBe(true)
    expect(group.props.className).toContain("overflow-x-auto")
    expect(group.props.className).toContain("[scrollbar-width:none]")
    // The first pill must never be clipped; edge buttons replace the old
    // always-on mask once the row actually overflows.
    expect(group.props.className).not.toContain("mask-image")

    const statusGroup = () => root.root.findAllByProps({ role: "group", "aria-label": "Filter by status" })[0]
    const pill = (label) => statusGroup().findAllByType("button").find((button) => button.props["aria-label"] === label)

    const pills = statusGroup().findAllByType("button")
    expect(pills).toHaveLength(8)
    expect(pills.map((item) => item.props["aria-label"] ?? item.children.filter((child) => typeof child === "string").join(""))).toEqual([
      "All",
      "Filter by status: Idea (Backlog)",
      "Filter by status: To do (Backlog)",
      "Filter by status: In progress (Active)",
      "Filter by status: Blocked (Active)",
      "Filter by status: Finished (Done)",
      "Filter by status: Cancelled (Done)",
      "Filter by status: Archived (Done)",
    ])
    expect(pills[0].children).toContain("All")

    // Category reaches assistive technology through the pill name, never a header row.
    for (const category of ["Backlog statuses", "Active statuses", "Done statuses"])
      expect(root.root.findAllByProps({ "aria-label": category })).toHaveLength(0)
    expect(JSON.stringify(root.toJSON())).not.toContain("uppercase")

    const dots = statusGroup().findAll((node) => node.props["data-status-dot"] !== undefined)
    expect(dots.map((dot) => dot.props["data-status-dot"])).toEqual([
      "idea", "todo", "in-progress", "blocked", "finished", "cancelled", "archived",
    ])
    const blockedDot = dots.find((dot) => dot.props["data-status-dot"] === "blocked")
    expect(blockedDot.props.className).toContain("bg-rose-600")
    expect(blockedDot.props.className).toContain("size-1.5")
    expect(blockedDot.props["aria-hidden"]).toBe("true")

    expect(pills[0].props["aria-pressed"]).toBe(true)
    expect(pill("Filter by status: Blocked (Active)").props["aria-pressed"]).toBe(false)

    await act(async () => pill("Filter by status: Blocked (Active)").props.onClick())
    expect(pill("Filter by status: Blocked (Active)").props["aria-pressed"]).toBe(true)
    expect(pills[0].props["aria-pressed"]).toBe(false)
    expect(root.root.findAllByProps({ "aria-label": "Open Stuck" }).length).toBeGreaterThan(0)
    expect(root.root.findAllByProps({ "aria-label": "Open Draft plan" })).toHaveLength(0)

    await act(async () => pill("Filter by status: Finished (Done)").props.onClick())
    expect(root.root.findAllByProps({ "aria-label": "Open Shipped feature" }).length).toBeGreaterThan(0)
    expect(root.root.findAllByProps({ "aria-label": "Open Stuck" })).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("the live note count and space pill replace the full-width space select", async () => {
  const restore = environment()
  let root
  const spaces = [
    { id: "global", name: "Ideas", projectDir: null, pinned: true, revision: 1 },
    { id: "work", name: "Work", projectDir: "/synthetic/work", pinned: false, revision: 1 },
  ]
  const adapter = { list: async () => snapshot([note(), note({ id: "n2", title: "Second" })], { spaces }) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("2 notes")
    expect(text).toContain('"aria-live":"polite"')
    const trigger = root.root.findAllByType("button").find((button) => String(button.props["aria-label"] ?? "").startsWith("Filter by space:"))
    expect(trigger.props["aria-label"]).toBe("Filter by space: All spaces")
    expect(trigger.props.className).toContain("rounded-full")
    expect(trigger.props.className).toContain("h-11")
    expect(trigger.props.className).toContain("max-w-[65%]")
    // No standalone combobox select is left behind.
    expect(root.root.findAllByProps({ role: "combobox" })).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("space filter options list each space once with its scope", () => {
  const spaces = [
    { id: "global", name: "Ideas", projectDir: null, pinned: true, revision: 1 },
    { id: "work", name: "Work", projectDir: "/synthetic/work", pinned: false, revision: 1 },
    { id: "work", name: "Work", projectDir: "/synthetic/work", pinned: false, revision: 1 },
  ]
  expect(spaceFilterOptions(spaces)).toEqual([
    { value: "all", label: "All spaces" },
    { value: "__notes_none__", label: "No space" },
    { value: "global", label: "Ideas", projectDir: null },
    { value: "work", label: "Work", projectDir: "/synthetic/work" },
  ])
})

test("drafts survive leaving the panel when the adapter instance is reused", async () => {
  const restore = environment()
  let root
  const adapter = { list: async () => snapshot([note({ content: "Body" })]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => root.root.findByProps({ "aria-label": "Open Original" }).props.onClick())
    await act(async () => root.root.findAllByType("button").find((button) => button.children.includes("Edit")).props.onClick())
    await act(async () => root.root.findByType("textarea").props.onChange({ target: { value: "Survives a switch" } }))
    await act(async () => root.root.findAllByType("button").find((button) => button.children.includes("Back to Notes")).props.onClick())
    await act(async () => root.unmount())
    root = undefined

    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => root.root.findByProps({ "aria-label": "Open Original" }).props.onClick())
    await act(async () => root.root.findAllByType("button").find((button) => button.children.includes("Edit")).props.onClick())
    expect(root.root.findByType("textarea").props.value).toBe("Survives a switch")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

async function renderDirectoryField(props) {
  let root
  await act(async () => {
    root = create(
      React.createElement(SpaceDirectoryField, {
        id: "space-directory",
        value: "",
        onChange() {},
        ...props,
      })
    )
  })
  return root
}

const directoryRows = (root) =>
  root.root
    .findAllByType("button")
    .filter((node) => typeof node.props["data-directory"] === "string")

const directoryPaths = (root) =>
  directoryRows(root).map((row) => row.props["data-directory"])

const optionsOpen = (root) =>
  root.root.findAllByProps({ "data-directory-options": true }).length > 0

/** The drill-down fetches one level behind a small debounce. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

const treeFetch = (trees) => {
  const requests = []
  const fetch = async (url) => {
    const parsed = new URL(String(url), "http://localhost")
    const location = parsed.searchParams.get("location[directory]") ?? "/"
    requests.push({ url: parsed.pathname, location })
    return new Response(JSON.stringify({ data: trees[location] ?? [] }), {
      headers: { "content-type": "application/json" },
    })
  }
  return { requests, fetch }
}

test("the space editor hides options until used and browses one level at a time", async () => {
  const restore = environment()
  const previousFetch = globalThis.fetch
  const { requests, fetch } = treeFetch({
    "/": [
      { path: "home", type: "directory" },
      { path: "synthetic", type: "directory" },
      { path: "notes.txt", type: "file" },
    ],
    "/synthetic": [
      { path: "alpha", type: "directory" },
      { path: "notes", type: "directory" },
      { path: ".git", type: "directory" },
    ],
    "/synthetic/alpha": [{ path: "src", type: "directory" }],
  })
  globalThis.fetch = fetch
  const changes = []
  let root
  try {
    root = await renderDirectoryField({ onChange: (next) => changes.push(next) })
    expect(optionsOpen(root)).toBe(false)
    const input = root.root.findByType("input")
    expect(input.props.value).toBe("")
    expect(input.props.placeholder).toBe("Empty = Global (every project)")
    expect(input.props.dir).toBe("ltr")
    expect(root.root.findAllByType("label")[0].children).toContain("Project directory")
    expect(requests).toHaveLength(0)

    await act(async () => input.props.onFocus())
    expect(optionsOpen(root)).toBe(true)
    await settle()
    expect(requests.at(-1)).toEqual({ url: "/api/fs/list", location: "/" })
    expect(directoryPaths(root)).toEqual(["", "/home", "/synthetic"])

    await act(async () =>
      directoryRows(root)
        .find((row) => row.props["data-directory"] === "/synthetic")
        .props.onClick()
    )
    expect(changes.at(-1)).toBe("/synthetic")
    await settle()
    expect(requests.at(-1).location).toBe("/synthetic")
    expect(directoryPaths(root)).toEqual(["", "/synthetic/alpha", "/synthetic/notes"])
    const up = root.root
      .findAllByType("button")
      .find((node) => node.props["data-directory-parent"] === "/")
    expect(up).toBeDefined()

    await act(async () => up.props.onClick())
    expect(changes.at(-1)).toBe("/")
    await settle()
    expect(requests.at(-1).location).toBe("/")
    expect(directoryPaths(root)).toEqual(["", "/home", "/synthetic"])
    expect(
      root.root.findAllByType("button").some(
        (node) => node.props["data-directory-parent"] !== undefined
      )
    ).toBe(false)

    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Visible in every project")
    expect(text).toContain("Any absolute path works, even before the folder exists.")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    restore()
  }
})

test("editing a space starts browsing its parent and keeps siblings visible", async () => {
  const restore = environment()
  const previousFetch = globalThis.fetch
  const { requests, fetch } = treeFetch({
    "/synthetic": [
      { path: "alpha", type: "directory" },
      { path: "notes", type: "directory" },
    ],
  })
  globalThis.fetch = fetch
  let root
  try {
    root = await renderDirectoryField({ value: "/synthetic/notes" })
    await act(async () => root.root.findByType("input").props.onFocus())
    await settle()
    expect(requests.at(-1).location).toBe("/synthetic")
    expect(directoryPaths(root)).toEqual([
      "",
      "/synthetic/alpha",
      "/synthetic/notes",
    ])
    const notes = directoryRows(root).find(
      (row) => row.props["data-directory"] === "/synthetic/notes"
    )
    expect(notes.props["aria-pressed"]).toBe(true)
    expect(
      root.root.findAllByType("button").filter(
        (node) => node.props["data-directory-custom"] !== undefined
      )
    ).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    restore()
  }
})

test("typing filters the current level and offers an exact custom path", async () => {
  const restore = environment()
  const previousFetch = globalThis.fetch
  const { fetch } = treeFetch({
    "/synthetic": [
      { path: "alpha", type: "directory" },
      { path: "notes", type: "directory" },
      { path: "work", type: "directory" },
      { path: "worktrees", type: "directory" },
    ],
  })
  globalThis.fetch = fetch
  let root
  try {
    root = await renderDirectoryField({ value: "/synthetic/alp" })
    await act(async () => root.root.findByType("input").props.onFocus())
    await settle()
    expect(directoryPaths(root)).toEqual(["", "/synthetic/alpha"])
    expect(
      root.root.findAllByType("button").some(
        (node) => node.props["data-directory-custom"] === "/synthetic/alp"
      )
    ).toBe(true)
    await act(async () => root.unmount())
    root = undefined

    const changes = []
    root = await renderDirectoryField({
      value: "/synthetic/work",
      onChange: (next) => changes.push(next),
    })
    await act(async () => root.root.findByType("input").props.onFocus())
    await settle()
    // An exact match is the current selection, so every sibling stays in reach.
    expect(directoryPaths(root)).toEqual([
      "",
      "/synthetic/alpha",
      "/synthetic/notes",
      "/synthetic/work",
      "/synthetic/worktrees",
    ])
    await act(async () => directoryRows(root)[2].props.onClick())
    expect(changes.at(-1)).toBe("/synthetic/notes")
    await act(async () => directoryRows(root)[0].props.onClick())
    expect(changes.at(-1)).toBe("")
    await act(async () => root.unmount())
    root = undefined

    root = await renderDirectoryField({
      value: "/synthetic/not-built-yet",
      onChange: (next) => changes.push(next),
    })
    await act(async () => root.root.findByType("input").props.onFocus())
    await settle()
    expect(
      root.root.findAllByType("button").some(
        (node) => node.props["data-directory-custom"] === "/synthetic/not-built-yet"
      )
    ).toBe(true)
    const custom = root.root
      .findAllByType("button")
      .find(
        (node) =>
          node.props["data-directory-custom"] === "/synthetic/not-built-yet"
      )
    await act(async () => custom.props.onClick())
    expect(changes.at(-1)).toBe("/synthetic/not-built-yet")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    restore()
  }
})

test("a failed directory listing keeps Global and custom paths usable", async () => {
  const restore = environment()
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("unavailable", { status: 503 })
  const changes = []
  let root
  try {
    root = await renderDirectoryField({
      value: "/synthetic/new-space",
      onChange: (next) => changes.push(next),
    })
    await act(async () => root.root.findByType("input").props.onFocus())
    await settle()
    expect(optionsOpen(root)).toBe(true)
    expect(JSON.stringify(root.toJSON())).toContain("Could not list this directory.")
    expect(directoryPaths(root)).toContain("")
    const custom = root.root
      .findAllByType("button")
      .find(
        (node) => node.props["data-directory-custom"] === "/synthetic/new-space"
      )
    await act(async () => custom.props.onClick())
    expect(changes.at(-1)).toBe("/synthetic/new-space")
    await act(async () => directoryRows(root)[0].props.onClick())
    expect(changes.at(-1)).toBe("")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    restore()
  }
})

test("the space editor hides its options when focus leaves the field", async () => {
  const restore = environment()
  const previousFetch = globalThis.fetch
  globalThis.fetch = treeFetch({}).fetch
  let root
  try {
    root = await renderDirectoryField({})
    await act(async () => root.root.findByType("input").props.onFocus())
    await settle()
    expect(optionsOpen(root)).toBe(true)
    const field = root.root.findByProps({ className: "grid min-w-0 gap-1.5" })
    await act(async () => field.props.onBlur({ relatedTarget: null }))
    expect(optionsOpen(root)).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    restore()
  }
})

test("space directories must be absolute but need not exist yet", () => {
  expect(spaceDirectoryError(null)).toBeNull()
  expect(spaceDirectoryError("   ")).toBeNull()
  expect(spaceDirectoryError("/synthetic/new")).toBeNull()
  expect(spaceDirectoryError("/synthetic/not/created/yet")).toBeNull()
  expect(spaceDirectoryError("relative/path")).toBe("Use an absolute path starting with /")
  expect(spaceDirectoryValue("  /synthetic/new  ")).toBe("/synthetic/new")
  expect(spaceDirectoryValue("   ")).toBeNull()
  expect(spaceDirectoryValue(null)).toBeNull()
})

test("relative paths show the validation error while options stay closed", async () => {
  const restore = environment()
  let root
  try {
    root = await renderDirectoryField({ value: "relative/path" })
    const alert = root.root.findAllByProps({ role: "alert" })[0]
    expect(alert.children).toContain("Use an absolute path starting with /")
    expect(root.root.findByType("input").props["aria-invalid"]).toBe(true)
    expect(optionsOpen(root)).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("directory browsing resolves parents and relative child paths", () => {
  expect(canonicalDirectory("/synthetic/work/")).toBe("/synthetic/work")
  expect(canonicalDirectory("/")).toBe("/")
  expect(parentDirectory("/synthetic/work")).toBe("/synthetic")
  expect(parentDirectory("/synthetic")).toBe("/")
  expect(parentDirectory("/")).toBeNull()
  expect(browseDirectory("")).toBe("/")
  expect(browseDirectory("  /synthetic/work  ")).toBe("/synthetic")
  expect(browseDirectory("relative/path")).toBe("/")
  expect(browseDirectory("/")).toBe("/")
  expect(
    subdirectoryPaths("/synthetic", {
      data: [
        { path: "alpha", type: "directory" },
        { path: "alpha/", type: "directory" },
        { path: ".git", type: "directory" },
        { path: "README.md", type: "file" },
        { path: "/synthetic/notes", type: "directory" },
        null,
      ],
    })
  ).toEqual(["/synthetic/alpha", "/synthetic/notes"])
  expect(subdirectoryPaths("/", { data: [{ path: "synthetic", type: "directory" }] })).toEqual([
    "/synthetic",
  ])
  expect(subdirectoryPaths("/synthetic", { data: "not-a-list" })).toEqual([])
  expect(subdirectoryPaths("/synthetic", null)).toEqual([])
})
