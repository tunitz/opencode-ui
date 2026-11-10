import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

let installed = true
let pinnedTotal = 1
let spacesFail = false
let updateFail = false
let updateCalls = []
let updateGate = null
const spaces = [{ id: "space-1", name: "Work", project: null, revision: 1 }]
const pinnedNote = { id: "pinned-1", title: "Pinned idea", body: "Note body", status: "in-progress", pinned: true, spaceID: "space-1", revision: 1 }
const mockFetch = async (request, init) => {
  const url = typeof request === "string" ? request : String(request?.url ?? request)
  if (url.includes("/api/plugin")) return Response.json({ location: { directory: "/project" }, data: installed ? [{ id: "opencode-notes", source: { type: "local", path: "/plugin" }, features: { server: true, rpc: true }, state: { status: "active" } }] : [] })
  if (url.includes("/api/rpc/opencode-notes/list")) return Response.json({ output: { notes: [pinnedNote], total: pinnedTotal } })
  if (url.includes("/api/rpc/opencode-notes/update")) {
    updateCalls.push(JSON.parse(String(init?.body ?? "{}")))
    if (updateGate) await updateGate.promise
    if (updateFail) return Response.json({ error: "conflict" }, { status: 500 })
    return Response.json({ output: { note: { ...pinnedNote, pinned: false, revision: 2 } } })
  }
  if (url.includes("/api/rpc/opencode-notes/spaces")) {
    if (spacesFail) return Response.json({ error: "unavailable" }, { status: 500 })
    return Response.json({ output: { spaces, total: spaces.length } })
  }
  return new Response("", { headers: { "content-type": "text/event-stream" } })
}

const deferred = () => {
  let resolve, reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const collectText = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(collectText).join("")
  if (React.isValidElement(node)) return collectText(node.props.children)
  return ""
}

const findChildElement = (node, predicate) => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findChildElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!React.isValidElement(node)) return null
  if (predicate(node)) return node
  return findChildElement(node.props.children, predicate)
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
  updateFail = false
  updateCalls = []
  updateGate = null
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

test("unpinning from the sidebar confirms without opening the note and updates it", async () => {
  const restore = setup()
  installed = true
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    const { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent } = await import("../src/components/ui/alert-dialog")
    function Observer() { current = useNotesWorkspace(); return null }
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))

    const dialogOpen = () => root.root.findAllByType(AlertDialog)[0].props.open
    const content = () => root.root.findAllByType(AlertDialogContent)[0]
    const action = () => findChildElement(content().props.children, (element) => element.type === AlertDialogAction)
    const cancel = () => findChildElement(content().props.children, (element) => element.type === AlertDialogCancel)
    const flush = async () => { for (let index = 0; index < 10; index++) await act(async () => { await Promise.resolve() }) }

    expect(dialogOpen()).toBe(false)
    const unpin = root.root.findAll((node) => node.type === "button").find((node) => node.props["aria-label"] === "Unpin “Pinned idea”")
    expect(unpin).toBeDefined()
    expect(unpin.props.title).toBe("Unpin “Pinned idea”")

    await act(async () => unpin.props.onClick({ currentTarget: { isConnected: true } }))
    expect(current.open).toBe(false)
    expect(dialogOpen()).toBe(true)
    const opened = collectText(content().props.children)
    expect(opened).toContain("Unpin note?")
    expect(opened).toContain("“Pinned idea” will be removed from pinned notes. The note itself is unchanged.")
    expect(opened).toContain("Cancel")
    expect(opened).toContain("Unpin note")
    expect(action().props.disabled).toBe(false)

    updateGate = deferred()
    await act(async () => { action().props.onClick({ preventDefault() {} }) })
    await flush()
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].input).toEqual({
      noteID: "pinned-1",
      title: "Pinned idea",
      body: "Note body",
      status: "in-progress",
      pinned: false,
      spaceID: "space-1",
      expectedRevision: 1,
    })
    expect(action().props.disabled).toBe(true)
    expect(cancel().props.disabled).toBe(true)
    expect(collectText(content().props.children)).toContain("Unpinning…")
    expect(dialogOpen()).toBe(true)

    const gate = updateGate
    updateGate = null
    await act(async () => { gate.resolve(); await gate.promise })
    await flush()
    expect(dialogOpen()).toBe(false)
    expect(current.open).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("an unpin failure keeps the dialog open and reports the error inside it", async () => {
  const restore = setup()
  installed = true
  pinnedTotal = 1
  spacesFail = false
  updateFail = true
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    const { AlertDialog, AlertDialogAction, AlertDialogContent } = await import("../src/components/ui/alert-dialog")
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav }, React.createElement(NotesSidebar))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    const content = () => root.root.findAllByType(AlertDialogContent)[0]
    const unpin = root.root.findAll((node) => node.type === "button").find((node) => node.props["aria-label"] === "Unpin “Pinned idea”")
    await act(async () => unpin.props.onClick({ currentTarget: { isConnected: true } }))
    const action = () => findChildElement(content().props.children, (element) => element.type === AlertDialogAction)
    await act(async () => { action().props.onClick({ preventDefault() {} }) })
    for (let index = 0; index < 10; index++) await act(async () => { await Promise.resolve() })
    expect(root.root.findAllByType(AlertDialog)[0].props.open).toBe(true)
    const alert = findChildElement(content().props.children, (element) => element.props?.role === "alert")
    expect(alert).toBeTruthy()
    expect(collectText(alert)).toContain("Could not unpin the note.")
    expect(action().props.disabled).toBe(false)
  } finally {
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
