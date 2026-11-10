import { afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { NotesPanel } from "../src/components/notes-panel"

let previousDocument
beforeEach(() => { previousDocument = globalThis.document; globalThis.document = { addEventListener() {}, removeEventListener() {} } })
afterEach(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })

const environment = () => {
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
const note = (id) => ({ id, title: id, content: "", status: "todo", pinned: false, spaceID: null, revision: 1, attachments: [] })
const snapshot = (notes) => ({ notes, spaces: [], projects: [], workspaceDirectory: "/project" })
const button = (root, label) => root.root.findAllByType("button").find((item) => item.children.includes(label))
const editButton = (root) => button(root, "Edit")
const backButton = (root) => button(root, "Back to Notes")

test("late selection opens a preview and switching notes retains drafts", async () => {
  const restore = environment()
  let root, resolveList
  const adapter = { list: () => new Promise((resolve) => { resolveList = resolve }) }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter, selectedNoteID: "one" })) })
    await act(async () => resolveList(snapshot([note("one"), note("two")])))
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    await act(async () => editButton(root).props.onClick())
    const title = () => root.root.findAllByType("input").find((input) => input.props.required)
    expect(title().props.value).toBe("one")
    await act(async () => title().props.onChange({ target: { value: "My draft" }, currentTarget: { value: "My draft" } }))
    await act(async () => root.root.findByProps({ "aria-label": "Open two" }).props.onClick())
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    const rendered = JSON.stringify(root.toJSON())
    expect(rendered).toContain("two")
    await act(async () => root.root.findByProps({ "aria-label": "Open one" }).props.onClick())
    await act(async () => editButton(root).props.onClick())
    expect(title().props.value).toBe("My draft")
    await act(async () => root.unmount())
    root = null
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("new note stays open after selecting an existing note and All notes returns to the list", async () => {
  const restore = environment()
  const adapter = { list: async () => snapshot([note("one")]) }
  function Controlled() {
    const [selected, setSelected] = React.useState(null)
    const [request, setRequest] = React.useState(0)
    return React.createElement(React.Fragment, null,
      React.createElement("button", { id: "all-notes", onClick: () => { setSelected(null); setRequest((value) => value + 1) } }, "All notes"),
      React.createElement(NotesPanel, { adapter, selectedNoteID: selected, selectionRequest: request, onSelectedNoteChange: setSelected }))
  }
  let root
  try {
    await act(async () => { root = create(React.createElement(Controlled)) })
    await act(async () => root.root.findByProps({ "aria-label": "Open one" }).props.onClick())
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
    await act(async () => button(root, "New note").props.onClick())
    let title = root.root.findAllByType("input").find((input) => input.props.required)
    expect(title.props.value).toBe("")
    await act(async () => title.props.onChange({ target: { value: "Unfinished thought" }, currentTarget: { value: "Unfinished thought" } }))
    await act(async () => root.root.findByProps({ id: "all-notes" }).props.onClick())
    expect(root.root.findAllByType("input").some((input) => input.props.required)).toBe(false)
    await act(async () => button(root, "New note").props.onClick())
    title = root.root.findAllByType("input").find((input) => input.props.required)
    expect(title.props.value).toBe("Unfinished thought")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("compact status and search filters narrow the notebook", async () => {
  const restore = environment()
  const adapter = { list: async () => snapshot([
    { ...note("one"), title: "Draft plan" },
    { ...note("two"), title: "Shipped feature", content: "release notes", status: "finished" },
  ]) }
  let root
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const done = button(root, "Done")
    await act(async () => done.props.onClick())
    expect(root.root.findAllByProps({ "aria-label": "Open Draft plan" })).toHaveLength(0)
    expect(root.root.findAllByProps({ "aria-label": "Open Shipped feature" }).length).toBeGreaterThan(0)
    const search = root.root.findByProps({ placeholder: "Search title or text" })
    await act(async () => search.props.onChange({ target: { value: "missing" }, currentTarget: { value: "missing" } }))
    expect(root.root.findAllByProps({ "aria-label": "Open Shipped feature" })).toHaveLength(0)
    expect(JSON.stringify(root.toJSON())).toContain("No notes match these filters")
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})

test("Back to Notes returns a preview and its editor to the list", async () => {
  const restore = environment()
  const adapter = { list: async () => snapshot([note("one")]) }
  let root
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => root.root.findByProps({ "aria-label": "Open one" }).props.onClick())
    await act(async () => backButton(root).props.onClick())
    expect(root.root.findByProps({ "aria-label": "Open one" })).toBeDefined()
    expect(JSON.stringify(root.toJSON())).toContain("Select a note to view and edit it.")
    await act(async () => root.root.findByProps({ "aria-label": "Open one" }).props.onClick())
    await act(async () => editButton(root).props.onClick())
    await act(async () => backButton(root).props.onClick())
    expect(root.root.findAllByType("textarea")).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
  }
})
