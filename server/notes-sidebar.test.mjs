import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

let installed = true
let pinnedTotal = 1
const mockFetch = async (request) => {
  const url = typeof request === "string" ? request : String(request?.url ?? request)
  if (url.includes("/api/plugin")) return Response.json({ location: { directory: "/project" }, data: installed ? [{ id: "opencode-notes", source: { type: "local", path: "/plugin" }, features: { server: true, rpc: true }, state: { status: "active" } }] : [] })
  if (url.includes("/api/rpc/opencode-notes/list")) return Response.json({ output: { notes: [{ id: "pinned-1", title: "Pinned idea", body: "", status: "todo", pinned: true, spaceID: null, revision: 1 }], total: pinnedTotal } })
  return new Response("", { headers: { "content-type": "text/event-stream" } })
}

test("notes sidebar appears only for an active plugin at the selected location", async () => {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { location: { origin: "http://example.test" }, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  installed = true
  pinnedTotal = 1
  globalThis.fetch = mockFetch
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    const tree = (value) => React.createElement(NotesProvider, { nav: value }, React.createElement(NotesSidebar))
    await act(async () => { root = create(tree(nav)) })
    expect(JSON.stringify(root.toJSON())).toContain("All notes & plans")
    installed = false
    await act(async () => root.update(tree({ ...nav, streamStatus: "connecting" })))
    expect(root.toJSON()).toBeNull()
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
})

test("pinned notes have a separate section and open the workspace with the selected note", async () => {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { location: { origin: "http://example.test" }, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  installed = true
  pinnedTotal = 7
  globalThis.fetch = mockFetch
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    const sidebar = JSON.stringify(root.toJSON())
    expect(sidebar).toContain("Pinned notes")
    expect(sidebar).toContain("Pinned idea")
    expect(root.root.findAllByType("p").some((item) => item.children.join("").includes("Showing 1 of 7"))).toBe(true)
    expect(current.open).toBe(false)
    const button = root.root.findAll((node) => node.type === "button").find((node) => node.findAllByType("span").some((span) => span.children.includes("Pinned idea")))
    expect(button).toBeDefined()
    await act(async () => button.props.onClick())
    expect(current.open).toBe(true)
    expect(current.selectedNoteID).toBe("pinned-1")
    await act(async () => current.closeNotes())
    expect(current.open).toBe(false)
    await act(async () => root.update(React.createElement(NotesProvider, { nav: { ...nav, connection: "disconnected" } }, React.createElement(NotesSidebar), React.createElement(Observer))))
    expect(JSON.stringify(root.toJSON())).toContain("Pinned notes unavailable")
    const allNotesButton = root.root.findByProps({ "aria-label": "All notes and plans" })
    await act(async () => allNotesButton.props.onClick())
    expect(current.open).toBe(true)
    expect(current.selectedNoteID).toBe("pinned-1")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
})
