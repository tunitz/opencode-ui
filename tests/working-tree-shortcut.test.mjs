import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { WorkingTreeShortcut } from "../src/components/working-tree-shortcut"
import { ChangesPanel } from "../src/components/files-panel"

test("shortcut uses working diff and reports branch, change counts and unavailable states", async () => {
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  let opened = 0
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).startsWith("/api/vcs?")) return Response.json({ data: { branch: { current: "synthetic-main" } } })
    return Response.json({ data: [{ file: "a.txt", additions: 2, deletions: 1 }] })
  }
  try {
    await act(async () => { root = create(React.createElement(WorkingTreeShortcut, { sessionID: "s", directory: "/synthetic", onOpen: () => opened++ })) })
    expect(requests).toHaveLength(2)
    expect(requests.some((url) => url.startsWith("/api/vcs?"))).toBe(true)
    expect(requests.some((url) => url.includes("/api/vcs/diff?") && url.includes("mode=working"))).toBe(true)
    const button = root.root.findByType("button")
    expect(button.props["aria-label"]).toContain("on synthetic-main")
    expect(button.props["aria-label"]).toContain("1 file, 2 added, 1 deleted")
    expect(button.props["aria-label"]).not.toContain("snapshot")
    await act(async () => button.props.onClick())
    expect(opened).toBe(1)
    globalThis.fetch = async (url) => String(url).startsWith("/api/vcs?")
      ? Response.json({ data: { branch: { current: "synthetic-main" } } })
      : Response.json({ data: [] })
    await act(async () => { root.update(React.createElement(WorkingTreeShortcut, { sessionID: "other", directory: "/other", onOpen: () => {} })) })
    expect(root.root.findByType("button").props["aria-label"]).toContain("clean")
    expect(root.root.findByType("button").props["aria-label"]).not.toContain("snapshot")
    globalThis.fetch = async () => Response.json({ unexpected: [] })
    await act(async () => { root.update(React.createElement(WorkingTreeShortcut, { sessionID: "bad", directory: "/bad", onOpen: () => {} })) })
    expect(root.root.findByType("button").props["aria-label"]).toContain("unavailable")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
})

test("changed-file preview is offered only for safe non-deleted paths", async () => {
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  let opened = null
  const files = ["safe.txt", "../unsafe", "deleted.txt"].map((file, index) => ({ file, patch: "", status: index === 2 ? "deleted" : "modified", additions: 0, deletions: 0 }))
  globalThis.fetch = async (url) => Response.json({ data: String(url).startsWith("/api/vcs?") ? {} : files })
  try {
    await act(async () => { root = create(React.createElement(ChangesPanel, { session: { id: "s", location: { directory: "/synthetic" } }, onOpenFile: (path) => { opened = path } })) })
    const buttons = () => root.root.findAllByType("button")
    const preview = () => buttons().find((button) => button.children.includes("Open read-only file"))
    expect(preview()).toBeDefined()
    await act(async () => preview().props.onClick())
    expect(opened).toBe("safe.txt")
    for (const path of ["../unsafe", "deleted.txt"]) {
      await act(async () => buttons().find((button) => button.findAllByType("span").some((span) => span.children.includes(path))).props.onClick())
      expect(preview()).toBeUndefined()
    }
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
})

test("shortcut ignores late results from a previous session", async () => {
  const oldFetch = globalThis.fetch
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const pending = []
  let root
  globalThis.fetch = (url, init) => new Promise((resolve) => pending.push({ resolve, signal: init.signal }))
  try {
    await act(async () => { root = create(React.createElement(WorkingTreeShortcut, { sessionID: "a", directory: "/a", onOpen: () => {} })) })
    expect(root.root.findByType("button").props["aria-label"]).toContain("loading")
    expect(pending).toHaveLength(2)
    const firstSignals = pending.map((request) => request.signal)
    await act(async () => { root.update(React.createElement(WorkingTreeShortcut, { sessionID: "b", directory: "/b", onOpen: () => {} })) })
    expect(firstSignals.every((signal) => signal.aborted)).toBe(true)
    expect(pending).toHaveLength(4)
    await act(async () => pending[0].resolve(Response.json({ data: { branch: { current: "old-branch" } } })))
    await act(async () => pending[1].resolve(Response.json({ data: [{ file: "old", additions: 99, deletions: 0 }] })))
    expect(root.root.findByType("button").props["aria-label"]).toContain("loading")
    await act(async () => pending[2].resolve(Response.json({ data: { branch: { current: "synthetic-main" } } })))
    await act(async () => pending[3].resolve(Response.json({ data: [] })))
    expect(root.root.findByType("button").props["aria-label"]).toContain("clean")
    expect(root.root.findByType("button").props["aria-label"]).toContain("synthetic-main")
    expect(root.root.findByType("button").props["aria-label"]).not.toContain("old-branch")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch
    if (oldAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
  }
})
