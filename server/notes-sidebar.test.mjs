import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

test("notes sidebar appears only for an active plugin at the selected location", async () => {
  const oldWindow = globalThis.window
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { location: { origin: "http://example.test" }, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  let installed = true
  globalThis.fetch = async () => Response.json({ location: { directory: "/project" }, data: installed ? [{ id: "opencode-notes", source: { type: "local", path: "/plugin" }, features: { server: true, rpc: true }, state: { status: "active" } }] : [] })
  let root
  try {
    const { NotesSidebar } = await import("../src/components/notes-sidebar")
    const nav = { directory: "/project", activeSession: null, connection: "connected", streamStatus: "ready", projects: [] }
    await act(async () => { root = create(React.createElement(NotesSidebar, { nav })) })
    expect(JSON.stringify(root.toJSON())).toContain("Notes & plans")
    installed = false
    await act(async () => root.update(React.createElement(NotesSidebar, { nav: { ...nav, streamStatus: "connecting" } })))
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
