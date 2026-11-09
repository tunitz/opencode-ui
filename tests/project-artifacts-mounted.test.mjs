import { expect, mock, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

mock.module("../src/components/tool-artifacts", () => ({
  ArtifactRow: ({ artifacts }) => React.createElement("div", { id: "artifacts" }, artifacts.map((a) => a.sourceUrl).join(",")),
  ArtifactDialog: () => null,
}))
const { ProjectArtifacts } = await import("../src/components/project-artifacts")

test("mounted attachment refreshes capability after stream reconnect", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window
  globalThis.window = { location: { origin: "http://localhost" } }
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({ data: { url: `/artifact/${calls}`, canonicalId: "file", name: "file", mime: "text/plain", size: 1, kind: "text", toolName: "assistant-link" } })
  }
  let root
  const props = { sessionID: "mounted", messageID: "message", text: "[file](file)", streamStatus: "ready" }
  try {
    await act(async () => { root = create(React.createElement(ProjectArtifacts, props)) })
    expect(calls).toBe(1)
    expect(root.root.findByProps({ id: "artifacts" }).children).toEqual(["http://localhost/artifact/1"])
    await act(async () => { root.update(React.createElement(ProjectArtifacts, { ...props, streamStatus: "lost" })) })
    await act(async () => { root.update(React.createElement(ProjectArtifacts, props)) })
    expect(calls).toBe(2)
    expect(root.root.findByProps({ id: "artifacts" }).children).toEqual(["http://localhost/artifact/2"])
    expect(JSON.stringify(root.toJSON())).toContain("current files, not a snapshot")
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.fetch = oldFetch; globalThis.window = oldWindow
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
