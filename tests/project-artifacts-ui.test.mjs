import { describe, expect, test } from "bun:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { finalProjectArtifactMessages, projectArtifactHrefs, resolveProjectArtifacts, uniqueProjectArtifacts } from "../src/lib/project-artifacts"

const assistant = (id, finish = "stop") => ({ type: "assistant", id, finish, time: { created: 1, completed: 2 }, content: [], agent: "a", model: {} })
const idle = (outcome = "succeeded") => ({ type: "idle", id: `idle-${outcome}`, outcome, time: { created: 3 } })

describe("project attachment eligibility", () => {
  test("requires a complete successful turn and selects only its last assistant", () => {
    expect([...finalProjectArtifactMessages([idle(), assistant("a"), assistant("b"), idle()], false)]).toEqual(["b"])
    expect([...finalProjectArtifactMessages([assistant("first"), idle()], false)]).toEqual(["first"])
    expect([...finalProjectArtifactMessages([assistant("first")], false)]).toEqual([])
    expect([...finalProjectArtifactMessages([assistant("a"), idle()], true)]).toEqual(["a"])
    expect([...finalProjectArtifactMessages([assistant("a")], true)]).toEqual([])
    expect([...finalProjectArtifactMessages([assistant("a"), assistant("b"), idle()], true)]).toEqual(["b"])
    expect([...finalProjectArtifactMessages([idle(), assistant("a"), idle()], true)]).toEqual(["a"])
    expect([...finalProjectArtifactMessages([assistant("a"), idle("failed"), assistant("b")], false)]).toEqual([])
    expect([...finalProjectArtifactMessages([assistant("a", "length"), idle()], false)]).toEqual([])
  })
  test("extracts real links including references and extensionless paths, not code or images", () => {
    expect(projectArtifactHrefs('[one](./file) [two](/absolute/path) [ref][x] ![image](img.png) ` [no](code) `\n\n[x]: folder/report\n\n```\n[no](fenced)\n```\n[web](https://example.com) [mail](mailto:a@b)')).toEqual(["./file", "/absolute/path", "folder/report"])
  })
  test("duplicate normalized references use the same first destination as the renderer", () => {
    const markdown = "[report][ Foo  BAR ]\n\n[foo bar]: first/file\n[FOO  BAR]: second/file"
    const rendered = renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown))
    expect(rendered).toContain('href="first/file"')
    expect(projectArtifactHrefs(markdown)).toEqual(["first/file"])
  })
  test("abort prevents queued fetches", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await resolveProjectArtifacts("s", "m", ["a", "b"], controller.signal)).toEqual([])
  })
})

test("project cards deduplicate only known canonical identities, not file metadata", () => {
  const a = { canonicalId: "project/a", name: "report.txt", mime: "text/plain", size: 20 }
  const b = { ...a, canonicalId: "project/b" }
  const unknown1 = { ...a, canonicalId: undefined }
  const unknown2 = { ...unknown1 }
  const result = (artifact) => ({ status: "ready", href: "file", artifact })
  expect(uniqueProjectArtifacts([a, b, { ...a }, unknown1, unknown2].map(result))).toEqual([a, b, unknown1, unknown2])
})

test("resolution is concurrency bounded, deduplicated, and distinguishes outside", async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let active = 0, peak = 0, calls = 0
  globalThis.window = { location: { origin: "http://localhost" } }
  globalThis.fetch = async (_url, options) => {
    calls++; active++; peak = Math.max(peak, active)
    await Promise.resolve()
    active--
    const { href } = JSON.parse(options.body)
    if (href === "outside") return new Response(null, { status: 403 })
    return Response.json({ data: { url: "/api/ui/project-artifacts/id", canonicalId: href, name: href, mime: "text/plain", size: 1, kind: "text", toolName: "assistant-link" } })
  }
  try {
    const hrefs = Array.from({ length: 12 }, (_, i) => `p${i}`).concat("outside")
    const result = await resolveProjectArtifacts("bounded", "message", hrefs, new AbortController().signal)
    expect(result).toHaveLength(13)
    expect(result.at(-1).status).toBe("outside")
    expect(peak).toBeLessThanOrEqual(4)
    await resolveProjectArtifacts("bounded", "message", hrefs.slice(0, 12), new AbortController().signal)
    expect(calls).toBe(13)
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow }
})

test("shares in-flight requests, honors subscriber cancellation, and expires cached capabilities", async () => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, oldNow = Date.now
  let calls = 0, finish
  globalThis.window = { location: { origin: "http://localhost" } }
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => { finish = () => resolve(Response.json({ data: { url: "/artifact", canonicalId: "shared", name: "shared", mime: "text/plain", size: 1, kind: "text", toolName: "assistant-link" } })) })
  }
  try {
    const first = new AbortController(), second = new AbortController()
    const a = resolveProjectArtifacts("shared-session", "shared-message", ["shared"], first.signal)
    const b = resolveProjectArtifacts("shared-session", "shared-message", ["shared"], second.signal)
    await Promise.resolve()
    expect(calls).toBe(1)
    first.abort()
    finish()
    expect(await a).toEqual([])
    expect((await b)[0].status).toBe("ready")
    Date.now = () => oldNow() + 11_000
    const c = resolveProjectArtifacts("shared-session", "shared-message", ["shared"], new AbortController().signal)
    await Promise.resolve()
    expect(calls).toBe(2)
    finish()
    expect((await c)[0].status).toBe("ready")
  } finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow; Date.now = oldNow }
})
