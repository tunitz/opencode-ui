import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { NotesPanel, mergeNoteDraft, mergeSpaceDraft } from "../src/components/notes-panel"

test("conflict recovery keeps concurrent moves while preserving user edits", () => {
  const original = { id: "n", title: "Old", content: "Body", status: "todo", pinned: false, spaceID: "first" }
  const latest = { ...original, spaceID: "second", status: "finished", revision: 2 }
  const draft = { title: "My edit", content: "Body", status: "todo", pinned: false, spaceID: "first" }
  expect(mergeNoteDraft(original, draft, latest)).toEqual({ ...draft, spaceID: "second", status: "finished" })
  expect(mergeSpaceDraft({ id: "s", name: "Before", projectID: "a" }, { name: "My name", projectID: "a" }, { id: "s", name: "Before", projectID: "b" })).toEqual({ name: "My name", projectID: "b" })
})

test("notes panel shows saved notes and distinguishes an empty space", async () => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
  const previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  let root
  const adapter = {
    list: async () => ({
      notes: [{ id: "n1", title: "A plan", content: "Next steps", status: "in-progress", pinned: true, spaceID: null }],
      spaces: [], projects: [],
    }),
  }
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    const text = JSON.stringify(root.toJSON())
    expect(text).toContain("A plan")
    expect(text).toContain("In progress")
    expect(text).toContain("Pinned")
    expect(text).toContain("No space")
  } finally {
    if (root) await act(async () => root.unmount())
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test("an older list response cannot replace a newer refresh", async () => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
  const previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  let root, notify
  const pending = []
  const adapter = {
    list: () => new Promise((resolve) => pending.push(resolve)),
    subscribe: (callback) => { notify = callback; return () => {} },
  }
  const snapshot = (title) => ({ notes: [{ id: "n", title, content: "", status: "todo", pinned: false, spaceID: null }], spaces: [], projects: [] })
  try {
    await act(async () => { root = create(React.createElement(NotesPanel, { adapter })) })
    await act(async () => notify())
    expect(pending).toHaveLength(2)
    await act(async () => pending[1](snapshot("New version")))
    await act(async () => pending[0](snapshot("Old version")))
    const rendered = JSON.stringify(root.toJSON())
    expect(rendered).toContain("New version")
    expect(rendered).not.toContain("Old version")
  } finally {
    if (root) await act(async () => root.unmount())
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
