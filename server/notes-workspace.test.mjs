import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { NotesPanel } from "../src/components/notes-panel"

test("late selection opens the workspace and switching notes retains drafts", async () => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
  const previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  let root, resolveList
  const adapter = { list: () => new Promise((resolve) => { resolveList = resolve }) }
  const note = (id) => ({ id, title: id, content: "", status: "todo", pinned: false, spaceID: null, revision: 1 })
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter, selectedNoteID: "one" })) })
    await act(async () => resolveList({ notes: [note("one"), note("two")], spaces: [], projects: [] }))
    const title = () => root.root.findAllByType("input").find((input) => input.props.required)
    expect(title().props.value).toBe("one")
    await act(async () => title().props.onChange({ target: { value: "My draft" }, currentTarget: { value: "My draft" } }))
    await act(async () => root.root.findByProps({ "aria-label": "Open two" }).props.onClick())
    expect(title().props.value).toBe("two")
    await act(async () => root.root.findByProps({ "aria-label": "Open one" }).props.onClick())
    expect(title().props.value).toBe("My draft")
    await act(async () => root.unmount())
    root = null
  } finally {
    if (root) await act(async () => root.unmount())
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test("new note stays open after selecting an existing note and All notes returns to the list", async () => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT, previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  const adapter = { list: async () => ({ notes: [{ id: "one", title: "One", content: "", status: "todo", pinned: false, spaceID: null, revision: 1 }], spaces: [], projects: [] }) }
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
    await act(async () => root.root.findByProps({ "aria-label": "Open One" }).props.onClick())
    const newButton = root.root.findAllByType("button").find((button) => button.children.includes("New note"))
    await act(async () => newButton.props.onClick())
    let title = root.root.findAllByType("input").find((input) => input.props.required)
    expect(title.props.value).toBe("")
    await act(async () => title.props.onChange({ target: { value: "Unfinished thought" }, currentTarget: { value: "Unfinished thought" } }))
    await act(async () => root.root.findByProps({ id: "all-notes" }).props.onClick())
    expect(root.root.findAllByType("input").some((input) => input.props.required)).toBe(false)
    await act(async () => newButton.props.onClick())
    title = root.root.findAllByType("input").find((input) => input.props.required)
    expect(title.props.value).toBe("Unfinished thought")
  } finally {
    if (root) await act(async () => root.unmount())
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow
  }
})
