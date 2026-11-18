import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

let pinnedTotal = 1
let spacesFail = false
let updateFail = false
let updateCalls = []
let updateGate = null
let requested = []
let confirmCalls = 0
// null renders a registry without a Notes entry (unknown); "fail" is a 502.
let pluginRegistered = null
let pluginReads = 0
const spaces = [
  { id: "space-1", name: "Work", projectDir: "/project", pinned: false, revision: 1 },
  { id: "space-global", name: "Ideas", projectDir: null, pinned: true, revision: 1 },
]
const pinnedNote = { id: "pinned-1", title: "Pinned idea", body: "Note body", status: "in-progress", pinned: true, spaceID: "space-1", revision: 1 }
const extraPinnedNotes = Array.from({ length: 200 }, (_, index) => ({
  id: `pinned-${index + 2}`,
  title: `Pinned ${index + 2}`,
  body: "Note body",
  status: "todo",
  pinned: true,
  spaceID: null,
  revision: 1,
}))
const planNote = { id: "note-plan", title: "Plan", body: "Plan body", status: "todo", pinned: false, spaceID: null, revision: 1 }

const json = (body, status = 200) => Response.json(body, { status })
const mockFetch = async (request, init) => {
  const url = typeof request === "string" ? request : String(request?.url ?? request)
  requested.push(url)
  if (url.endsWith("/api/ui/notes/list")) {
    const input = JSON.parse(String(init?.body ?? "{}"))
    if (input.pinned === true) {
      const limit = typeof input.limit === "number" ? input.limit : 5
      const notes = [pinnedNote, ...extraPinnedNotes].slice(
        0,
        Math.min(pinnedTotal, limit)
      )
      return json({ notes, total: pinnedTotal })
    }
    return json({ notes: [pinnedNote, planNote], total: 2 })
  }
  if (url.endsWith("/api/ui/notes/spaces")) {
    if (spacesFail) return json({ error: { code: "invalid", message: "unavailable" } }, 500)
    return json({ spaces, total: spaces.length })
  }
  if (url.endsWith("/api/ui/notes/update")) {
    updateCalls.push(JSON.parse(String(init?.body ?? "{}")))
    if (updateGate) await updateGate.promise
    if (updateFail)
      return json({ error: { code: "revision_conflict", message: "Someone changed this note." } }, 409)
    return json({ note: { ...pinnedNote, pinned: false, revision: 2 } })
  }
  if (url.endsWith("/api/ui/plugins")) {
    pluginReads += 1
    if (pluginRegistered === "fail")
      return json({ error: { code: "engine_unavailable", message: "down" } }, 502)
    return json({
      engineAvailable: true,
      plugins:
        pluginRegistered === null
          ? []
          : [
              {
                id: "notes",
                registered: pluginRegistered,
                connected: pluginRegistered,
                restartRequired: false,
              },
            ],
    })
  }
  if (url.endsWith("/api/ui/notes/events"))
    return new Response("", { headers: { "content-type": "text/event-stream" } })
  return json({ error: { code: "invalid", message: "unexpected request" } }, 400)
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

const flush = async () => {
  for (let index = 0; index < 12; index += 1) await act(async () => { await Promise.resolve() })
}

function setup() {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  updateFail = false
  updateCalls = []
  updateGate = null
  requested = []
  confirmCalls = 0
  pluginRegistered = null
  pluginReads = 0
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const events = new EventTarget()
  globalThis.window = {
    location: { origin: "http://example.test" },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    confirm: () => {
      confirmCalls += 1
      return false
    },
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: (event) => events.dispatchEvent(event),
  }
  globalThis.fetch = mockFetch
  return () => {
    globalThis.fetch = oldFetch
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
}

const nav = (overrides = {}) => ({
  directory: "/project",
  activeSession: null,
  connection: "connected",
  streamStatus: "ready",
  projects: [],
  ...overrides,
})

test("notes appear while the plugin registry is unknown", async () => {
  const restore = setup()
  pinnedTotal = 1
  spacesFail = false
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    const tree = (value) => React.createElement(NotesProvider, { nav: value }, React.createElement(NotesSidebar))
    await act(async () => { root = create(tree(nav())) })
    const collapsed = JSON.stringify(root.toJSON())
    expect(collapsed).toContain('"aria-label":"Notes"')
    expect(collapsed).not.toContain("All notes")
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    expect(JSON.stringify(root.toJSON())).toContain("All notes")
    expect(requested.some((url) => url.includes("/api/plugin"))).toBe(false)
    expect(requested.some((url) => url.endsWith("/api/ui/notes/list"))).toBe(true)
    expect(requested.some((url) => url.includes("/api/rpc/"))).toBe(false)

    await act(async () => root.update(tree(nav({ directory: null, streamStatus: "connecting" }))))
    expect(root.toJSON()).toBeNull()
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("pinned notes show status and space, and open the workspace with the selected note", async () => {
  const restore = setup()
  pinnedTotal = 7
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    expect(JSON.stringify(root.toJSON())).not.toContain("Pinned notes")
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    const sidebar = JSON.stringify(root.toJSON())
    expect(sidebar).toContain("Pinned notes")
    expect(sidebar).toContain("Pinned idea")
    expect(sidebar).toContain("In progress")
    expect(sidebar).toContain("Work")
    expect(sidebar).not.toContain("Ideas")
    expect(sidebar).toContain("Show 2 more")
    expect(root.root.findAll((node) => node.type === "button" && node.props["aria-label"] === "Show 2 more")).toHaveLength(1)
    expect(current.open).toBe(false)
    const button = root.root.findAll((node) => node.type === "button").find((node) => node.findAllByType("span").some((span) => span.children.includes("Pinned idea")))
    expect(button).toBeDefined()
    await act(async () => button.props.onClick())
    expect(current.open).toBe(true)
    expect(current.selectedNoteID).toBe("pinned-1")
    expect(current.pinnedNotes[0].attachments).toEqual([])
    expect(current.pinnedNotes[0].content).toBe("Note body")
    expect(current.pinnedSpaces.map((space) => space.id)).toEqual(["space-1", "space-global"])
    await act(async () => current.closeNotes())
    expect(current.open).toBe(false)
    await act(async () => root.update(React.createElement(NotesProvider, { nav: nav({ connection: "disconnected" }) }, React.createElement(NotesSidebar), React.createElement(Observer))))
    expect(JSON.stringify(root.toJSON())).toContain("Pinned notes")
    pinnedTotal = 1
    await act(async () => current.refreshPinned())
    await flush()
    expect(current.pinnedNotes).toHaveLength(1)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("pinned notes expand to all and collapse back to five", async () => {
  const restore = setup()
  pinnedTotal = 7
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    await flush()
    expect(current.pinnedNotes).toHaveLength(5)
    const toggle = () => root.root.findAll((node) => node.type === "button" && (node.props["aria-label"] === "Show 2 more" || node.props["aria-label"] === "Show less"))[0]
    expect(toggle().props["aria-expanded"]).toBe(false)
    await act(async () => toggle().props.onClick())
    await flush()
    expect(current.pinnedNotes).toHaveLength(7)
    expect(toggle().props["aria-expanded"]).toBe(true)
    await act(async () => toggle().props.onClick())
    await flush()
    expect(current.pinnedNotes).toHaveLength(5)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("pinned expansion uses the service list limit, not a smaller UI cap", async () => {
  const restore = setup()
  pinnedTotal = 150
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    await flush()
    expect(current.pinnedNotes).toHaveLength(5)
    const toggle = () => root.root.findAll((node) => node.type === "button" && (node.props["aria-label"] === "Show 145 more" || node.props["aria-label"] === "Show less"))[0]
    await act(async () => toggle().props.onClick())
    await flush()
    expect(current.pinnedNotes).toHaveLength(150)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("a space lookup failure keeps pinned notes and labels the space unavailable", async () => {
  const restore = setup()
  pinnedTotal = 1
  spacesFail = true
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(NotesSidebar))) })
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
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    const { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent } = await import("../src/components/ui/alert-dialog")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(NotesSidebar), React.createElement(Observer))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))

    const dialogOpen = () => root.root.findAllByType(AlertDialog)[0].props.open
    const content = () => root.root.findAllByType(AlertDialogContent)[0]
    const action = () => findChildElement(content().props.children, (element) => element.type === AlertDialogAction)
    const cancel = () => findChildElement(content().props.children, (element) => element.type === AlertDialogCancel)

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
    expect(updateCalls[0]).toEqual({
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
  pinnedTotal = 1
  spacesFail = false
  updateFail = true
  let root
  try {
    const { NotesProvider, NotesSidebar } = await import("../src/components/notes-sidebar")
    const { AlertDialog, AlertDialogAction, AlertDialogContent } = await import("../src/components/ui/alert-dialog")
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(NotesSidebar))) })
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    const content = () => root.root.findAllByType(AlertDialogContent)[0]
    const unpin = root.root.findAll((node) => node.type === "button").find((node) => node.props["aria-label"] === "Unpin “Pinned idea”")
    await act(async () => unpin.props.onClick({ currentTarget: { isConnected: true } }))
    const action = () => findChildElement(content().props.children, (element) => element.type === AlertDialogAction)
    await act(async () => { action().props.onClick({ preventDefault() {} }) })
    await flush()
    expect(root.root.findAllByType(AlertDialog)[0].props.open).toBe(true)
    const alert = findChildElement(content().props.children, (element) => element.props?.role === "alert")
    expect(alert).toBeTruthy()
    expect(collectText(alert)).toContain("Could not unpin the note.")
    expect(collectText(alert)).toContain("Someone changed this note.")
    expect(action().props.disabled).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("the optional notes hook returns null without a provider and the workspace with one", async () => {
  const restore = setup()
  let root, value = "unset"
  try {
    const { NotesProvider, useOptionalNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Probe() { value = useOptionalNotesWorkspace(); return null }
    await act(async () => { root = create(React.createElement(Probe)) })
    expect(value).toBeNull()
    await act(async () => root.unmount())
    root = undefined
    await act(async () => { root = create(React.createElement(NotesProvider, { nav: nav() }, React.createElement(Probe))) })
    expect(value).not.toBeNull()
    expect(value.available).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("switching notes projects reuses each project's adapter and never prompts", async () => {
  const restore = setup()
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    const tree = (value) =>
      React.createElement(
        NotesProvider,
        { nav: value },
        React.createElement(NotesSidebar),
        React.createElement(Observer)
      )
    await act(async () => { root = create(tree(nav())) })
    await flush()
    await act(async () => findNotesTrigger(root).props.onClick({ nativeEvent: undefined }))
    await flush()
    const openAllNotes = async () => {
      await act(async () => root.root.findByProps({ "aria-label": "All notes" }).props.onClick())
      await flush()
    }
    await openAllNotes()
    const firstAdapter = current.adapter
    expect(current.workspaceKey).toBe("/project")
    expect(confirmCalls).toBe(0)

    await act(async () => root.update(tree(nav({ directory: "/other" }))))
    await flush()
    await openAllNotes()
    const otherAdapter = current.adapter
    expect(otherAdapter).not.toBe(firstAdapter)
    expect(current.workspaceKey).toBe("/other")
    expect(confirmCalls).toBe(0)

    await act(async () => root.update(tree(nav())))
    await flush()
    await openAllNotes()
    // Same adapter instance: drafts keyed by it survive the round trip.
    expect(current.adapter).toBe(firstAdapter)
    expect(confirmCalls).toBe(0)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

const workspaceTree = (provider, sidebar, observer) =>
  React.createElement(
    provider,
    { nav: nav() },
    React.createElement(sidebar),
    React.createElement(observer)
  )

test("an enabled plugin shows the Notes section and opens the workspace", async () => {
  const restore = setup()
  pluginRegistered = true
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(workspaceTree(NotesProvider, NotesSidebar, Observer)) })
    await flush()
    expect(current.notesEnabled).toBe(true)
    expect(JSON.stringify(root.toJSON())).toContain('"aria-label":"Notes"')
    expect(current.available).toBe(true)
    await act(async () => { expect(current.openNotes()).toBe(true) })
    expect(current.open).toBe(true)
    expect(current.hasWorkspace).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("a disabled plugin renders no Notes section and refuses to open it", async () => {
  const restore = setup()
  pluginRegistered = false
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(workspaceTree(NotesProvider, NotesSidebar, Observer)) })
    await flush()
    expect(current.notesEnabled).toBe(false)
    expect(current.available).toBe(false)
    expect(current.hasWorkspace).toBe(false)
    expect(root.toJSON()).toBeNull()
    await act(async () => { expect(current.openNotes()).toBe(false) })
    expect(current.open).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("disabling the plugin closes an open workspace on the change event", async () => {
  const restore = setup()
  pluginRegistered = true
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    const { NOTES_PLUGINS_CHANGED } = await import("../src/lib/notes-plugin-state")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(workspaceTree(NotesProvider, NotesSidebar, Observer)) })
    await flush()
    await act(async () => { expect(current.openNotes()).toBe(true) })
    expect(current.open).toBe(true)
    expect(current.hasWorkspace).toBe(true)
    expect(pluginReads).toBe(1)

    pluginRegistered = false
    await act(async () => { globalThis.window.dispatchEvent(new Event(NOTES_PLUGINS_CHANGED)) })
    await flush()
    expect(pluginReads).toBe(2)
    expect(current.notesEnabled).toBe(false)
    expect(current.open).toBe(false)
    expect(current.hasWorkspace).toBe(false)
    expect(root.toJSON()).toBeNull()
    expect(current.openNotes()).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("an unreadable plugin registry keeps the Notes surfaces visible", async () => {
  const restore = setup()
  pluginRegistered = "fail"
  pinnedTotal = 1
  spacesFail = false
  let root, current
  try {
    const { NotesProvider, NotesSidebar, useNotesWorkspace } = await import("../src/components/notes-sidebar")
    function Observer() { current = useNotesWorkspace(); return null }
    await act(async () => { root = create(workspaceTree(NotesProvider, NotesSidebar, Observer)) })
    await flush()
    expect(pluginReads).toBe(1)
    expect(current.notesEnabled).toBe(true)
    expect(JSON.stringify(root.toJSON())).toContain('"aria-label":"Notes"')
    await act(async () => { expect(current.openNotes()).toBe(true) })
    expect(current.open).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})
