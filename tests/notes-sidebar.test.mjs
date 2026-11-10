import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

let installed = true
let pinnedTotal = 1
let spacesFail = false
const spaces = [{ id: "space-1", name: "Work", project: null, revision: 1 }]
const mockFetch = async (request) => {
  const url = typeof request === "string" ? request : String(request?.url ?? request)
  if (url.includes("/api/plugin")) return Response.json({ location: { directory: "/project" }, data: installed ? [{ id: "opencode-notes", source: { type: "local", path: "/plugin" }, features: { server: true, rpc: true }, state: { status: "active" } }] : [] })
  if (url.includes("/api/rpc/opencode-notes/list")) return Response.json({ output: { notes: [{ id: "pinned-1", title: "Pinned idea", body: "Note body", status: "in-progress", pinned: true, spaceID: "space-1", revision: 1 }], total: pinnedTotal } })
  if (url.includes("/api/rpc/opencode-notes/spaces")) {
    if (spacesFail) return Response.json({ error: "unavailable" }, { status: 500 })
    return Response.json({ output: { spaces, total: spaces.length } })
  }
  return new Response("", { headers: { "content-type": "text/event-stream" } })
}

const findNotesTrigger = (root) =>
  root.root
    .findAll((node) => node.type === "button")
    .find((node) =>
      node.findAllByType("span").some((span) => span.children.includes("Notes"))
    )

function setup() {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { location: { origin: "http://example.test" }, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  globalThis.fetch = mockFetch
  return () => {
    globalThis.fetch = oldFetch
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
}

test("notes sidebar appears only for an active plugin at the selected location", async () => {
  const restore = setup()
  installed = true
  pinnedTotal = 1
  spacesFail = false
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    const tree = (value) => React.createElement(NotesProvider, { nav: value }, React.createElement(NotesSidebar))
    await act(async () => { root = create(tree(nav)) })
    const collapsed = JSON.stringify(root.toJSON())
    expect(collapsed).toContain('"aria-label":"Notes"')
    expect(collapsed).not.toContain("All notes")
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    expect(JSON.stringify(root.toJSON())).toContain("All notes")
    installed = false
    await act(async () => root.update(tree({ ...nav, streamStatus: "connecting" })))
    expect(root.toJSON()).toBeNull()
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("pinned notes show status and space, and open the workspace with the selected note", async () => {
  const restore = setup()
  installed = true
  pinnedTotal = 7
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    expect(JSON.stringify(root.toJSON())).not.toContain("Pinned notes")
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    const sidebar = JSON.stringify(root.toJSON())
    expect(sidebar).toContain("Pinned notes")
    expect(sidebar).toContain("Pinned idea")
    expect(sidebar).toContain("In progress")
    expect(sidebar).toContain("Work")
    expect(root.root.findAllByType("p").some((item) => item.children.join("").includes("Showing 1 of 7"))).toBe(true)
    expect(current.open).toBe(false)
    const button = root.root.findAll((node) => node.type === "button").find((node) => node.findAllByType("span").some((span) => span.children.includes("Pinned idea")))
    expect(button).toBeDefined()
    await act(async () => button.props.onClick())
    expect(current.open).toBe(true)
    expect(current.selectedNoteID).toBe("pinned-1")
    expect(current.pinnedNotes[0].attachments).toEqual([])
    expect(current.pinnedNotes[0].content).toBe("Note body")
    await act(async () => current.closeNotes())
    expect(current.open).toBe(false)
    await act(async () => root.update(React.createElement(NotesProvider, { nav: { ...nav, connection: "disconnected" } }, React.createElement(NotesSidebar), React.createElement(Observer))))
    expect(JSON.stringify(root.toJSON())).toContain("Pinned notes unavailable")
    const allNotesButton = root.root.findByProps({ "aria-label": "All notes" })
    await act(async () => allNotesButton.props.onClick())
    expect(current.open).toBe(true)
    expect(current.selectedNoteID).toBe("pinned-1")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("a space lookup failure keeps pinned notes and labels the space unavailable", async () => {
  const restore = setup()
  installed = true
  pinnedTotal = 1
  spacesFail = true
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav }, React.createElement(NotesSidebar))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    const sidebar = JSON.stringify(root.toJSON())
    expect(sidebar).toContain("Pinned idea")
    expect(sidebar).toContain("Space unavailable")
    expect(sidebar).not.toContain('"children":["Work"]')
  } finally {
    spacesFail = false
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("the optional notes hook returns null without a provider and the workspace with one", async () => {
  const restore = setup()
  installed = true
  let root, value = "unset"
  try {
    const { NotesProvider, useOptionalNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Probe() { value = useOptionalNotesWorkspace(); return null }
    await act(async () => { root = create(React.createElement(Probe)) })
    expect(value).toBeNull()
    await act(async () => root.unmount())
    root = undefined
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav }, React.createElement(Probe))) })
    expect(value).not.toBeNull()
    expect(value.available).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})
