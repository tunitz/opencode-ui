import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"
import { ChangesPanel, FilesPanel } from "../src/components/files-panel"

for (const [name, Component] of [["FilesPanel", FilesPanel], ["ChangesPanel", ChangesPanel]]) {
  test(`${name} cancels active requests on session change and unmount`, async () => {
    const oldActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    const oldFetch = globalThis.fetch
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const requests = []
    let root
    globalThis.fetch = (url, init) => new Promise((resolve) => {
      requests.push({ url, signal: init.signal, resolve })
    })
    const props = (id) => ({
      nav: { attachments: [] },
      session: { id, location: { directory: `/synthetic/${id}` } },
    })
    try {
      await act(async () => { root = create(React.createElement(Component, props("first"))) })
      const first = [...requests]
      expect(first.length).toBeGreaterThan(0)
      await act(async () => { root.update(React.createElement(Component, props("second"))) })
      expect(first.every((request) => request.signal.aborted)).toBe(true)
      const second = requests.slice(first.length)
      expect(second.length).toBeGreaterThan(0)
      expect(second.every((request) => !request.signal.aborted)).toBe(true)

      // An upstream that ignores abort must not replace the new session's state.
      await act(async () => {
        for (const request of first) {
          const data = String(request.url).startsWith("/api/vcs?")
            ? { branch: { current: "stale-branch" } }
            : [{ path: "stale.txt", type: "file", file: "stale.txt", additions: 1, deletions: 0 }]
          request.resolve(Response.json({ data }))
        }
      })
      expect(JSON.stringify(root.toJSON())).not.toContain("stale.txt")
      expect(JSON.stringify(root.toJSON())).not.toContain("stale-branch")

      await act(async () => root.unmount())
      root = null
      expect(second.every((request) => request.signal.aborted)).toBe(true)
      await act(async () => {
        for (const request of second) request.resolve(Response.json({ data: [] }))
      })
    } finally {
      if (root) await act(async () => root.unmount())
      globalThis.fetch = oldFetch
      if (oldActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
      else globalThis.IS_REACT_ACT_ENVIRONMENT = oldActEnvironment
    }
  })
}
