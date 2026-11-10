import { afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import {
  NOTE_ATTACHMENT_LIMITS,
  NotesPanel,
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
} from "../src/components/notes-panel"
import { NoteStatusLabel } from "../src/components/note-status-label"

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
  projects: [],
  workspaceDirectory: "/project",
  ...overrides,
})

test("conflict recovery keeps concurrent moves while preserving user edits", () => {
  const original = { id: "n", title: "Old", content: "Body", status: "todo", pinned: false, spaceID: "first" }
  const latest = { ...original, spaceID: "second", status: "finished", revision: 2 }
  const draft = { title: "My edit", content: "Body", status: "todo", pinned: false, spaceID: "first" }
  expect(mergeNoteDraft(original, draft, latest)).toEqual({ ...draft, spaceID: "second", status: "finished" })
  expect(mergeSpaceDraft({ id: "s", name: "Before", projectID: "a" }, { name: "My name", projectID: "a" }, { id: "s", name: "Before", projectID: "b" })).toEqual({ name: "My name", projectID: "b" })
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
  expect(notePreviewText("# Notes audit follow-up\n\n---\n\n**Bold** plan")).toBe("Notes audit follow-up Bold plan")
  expect(notePreviewText("## Plan\n\n- First step\n- [x] Done step\n\n> quoted")).toBe("Plan First step Done step quoted")
  expect(notePreviewText("**bold** and [a link](https://example.com) and `code`")).toBe("bold and a link and code")
  expect(notePreviewText("![shot.png](attachment://a1) report")).toBe("shot.png report")
  expect(notePreviewText("")).toBe("")
  expect(notePreviewText("  \n\n  ")).toBe("")
  expect(notePreviewText("use my_var and 2*3")).toBe("use my_var and 2*3")
  expect(notePreviewText("_emphasis_ stays readable")).toBe("emphasis stays readable")
  const long = "word ".repeat(60).trim()
  const preview = notePreviewText(long)
  expect(preview.endsWith("…")).toBe(true)
  expect(preview.length).toBeLessThanOrEqual(160)
  expect(preview).not.toContain("  ")
  expect(preview).not.toMatch(/\s…$/)
  expect(notePreviewText(long, 40).length).toBeLessThanOrEqual(40)
})

test("list rows show the plain-text preview instead of the note body", async () => {
  const restore = environment()
  let root
  const content = "# Plan\n\n---\n\n**Ship** [it](https://example.com)\n\n" + "detail ".repeat(300) + "UNIQUETAIL"
  const adapter = { list: async () => snapshot([note({ title: "Long plan", content })]) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("Plan Ship it")
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
    expect(text).toContain("flex-wrap")
    expect(text).not.toContain("md:grid-cols")
    expect(text).not.toContain("overflow-x-auto")
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
        React.createElement(NoteStatusLabel, { status: "todo" }),
        React.createElement(NoteStatusLabel, { status: "in-progress" }),
        React.createElement(NoteStatusLabel, { status: "finished" })))
    })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("To do")
    expect(text).toContain("In progress")
    expect(text).toContain("Finished")
    expect(text).toContain("text-amber-600")
    expect(text).toContain("text-sky-600")
    expect(text).toContain("text-emerald-600")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
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
