import { describe, expect, test } from "bun:test"
import { createProjectArtifacts, projectMarkdownLinks, projectRelativePath } from "../server/project-artifacts.ts"
import { createArtifactDelivery } from "../server/artifact-delivery.ts"
import { createWebDispatcher } from "../server/web-dispatch.ts"

const assistant = (id = "message_final", text = "[report](out/report.txt)", extra = {}) => ({ id, type: "assistant", finish: "stop", time: { created: 999, completed: 1000 }, content: [{ type: "text", text }], ...extra })
const idle = (outcome = "succeeded") => ({ id: "idle_end", type: "idle", outcome })
const req = (path, init = {}) => new Request(`https://example.test${path}`, { ...init, headers: { host: "example.test", origin: "https://example.test", ...init.headers } })
const resolveRequest = (href = "out/report.txt", messageID = "message_final") => req("/api/ui/project-artifacts/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionID: "session_test", messageID, href }) })

function fixture() {
  const state = { messages: [assistant(), idle()], directory: "/remote/project", bytes: "report", mime: "text/plain", fileStatus: 200, calls: [], cancelled: 0, signals: [], pageSize: 2, stream: false }
  const fakeFetch = async (input, init) => {
    const url = new URL(input)
    state.calls.push({ url, init })
    expect(init.redirect).toBe("manual")
    expect(init.proxy).toBe(false)
    expect(new Headers(init.headers).get("authorization")).toBe("Basic synthetic-only")
    const json = (data) => Response.json(data)
    if (url.pathname === "/api/session/session_test") return json({ data: { location: { directory: state.directory } } })
    if (url.pathname === "/api/session/session_test/message") {
      const start = Number(url.searchParams.get("cursor") ?? 0)
      const data = state.messages.slice(start, start + state.pageSize)
      return json({ data, cursor: data.length ? { next: String(start + data.length) } : {} })
    }
    expect(url.pathname.startsWith("/api/fs/read/")).toBe(true)
    expect(url.searchParams.get("location[directory]")).toBe(state.directory)
    state.signals.push(init.signal)
    if (state.fileStatus !== 200) return new Response("private upstream text", { status: state.fileStatus, headers: { location: "https://evil.test/secret", "set-cookie": "secret=x" } })
    const range = new Headers(init.headers).get("range")
    const headers = { "content-type": state.mime, "accept-ranges": "bytes", "content-length": String(state.bytes.length), "set-cookie": "private=x", "access-control-allow-origin": "*" }
    if (range) {
      if (!state.bytes.length || range === "bytes=999-") return new Response(null, { status: 416, headers: { ...headers, "content-length": "0", "content-range": `bytes */${state.bytes.length}` } })
      const [start, end] = range.match(/\d+/g).map(Number)
      const bytes = state.bytes.slice(start, (end ?? state.bytes.length - 1) + 1)
      return new Response(bytes, { status: 206, headers: { ...headers, "content-length": String(bytes.length), "content-range": `bytes ${start}-${start + bytes.length - 1}/${state.bytes.length}` } })
    }
    if (state.stream) return new Response(new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("x")) }, cancel() { state.cancelled++ } }), { headers })
    return new Response(state.bytes, { headers })
  }
  const service = createProjectArtifacts({ opencodeBaseUrl: "http://configured-engine.test", authorization: "Basic synthetic-only", fetch: fakeFetch })
  return { state, service, fakeFetch, async resolve(href, messageID) { return service.handleRequest(resolveRequest(href, messageID)) } }
}

describe("project attachment provenance", () => {
  test("parses actual Markdown including references, escapes, balanced parentheses, never code/images/prose", () => {
    expect(projectMarkdownLinks('plain out/a.txt ` [x](code.txt) `\n\n```md\n[x](fenced.txt)\n```\n\n![pic](image.png)\n\n[x](out/a(b).txt) [ref][r]\n\n[r]: out/a%20b.txt')).toEqual(["out/a(b).txt", "out/a%20b.txt"])
  })
  test("resolves paginated authoritative final assistant, opaque URL and no local file assumption", async () => {
    const f = fixture()
    const response = await f.resolve()
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data).toMatchObject({ name: "report.txt", size: 6, kind: "text", toolName: "assistant-link" })
    expect(data.url).toMatch(/^\/api\/ui\/project-artifacts\/[A-Za-z0-9_-]{32}$/)
    expect(data.canonicalId).not.toContain("remote")
    expect(f.state.calls.filter(({ url }) => url.pathname.endsWith("/message"))).toHaveLength(2) // final empty page
    expect((await (await f.resolve()).json()).data.id).toBe(data.id)
  })
  test("steering belongs to idle-delimited turn, ordering is array sequence not time/id", async () => {
    const f = fixture()
    f.state.messages = [{ id: "previous", type: "idle", outcome: "failed" }, assistant("z_first"), { id: "steer", type: "user" }, assistant(), idle()]
    expect((await f.resolve(undefined, "z_first")).status).toBe(404)
    expect((await f.resolve()).status).toBe(200)
  })
  test("rejects incomplete/failed/interrupted/nonfinal/error/prose/tool/reasoning and shutdown", async () => {
    for (const messages of [
      [assistant()], [assistant(), idle("failed")], [assistant(), idle("interrupted")],
      [assistant(), assistant("later"), idle()], [assistant("message_final", undefined, { finish: "length" }), idle()],
      [assistant("message_final", undefined, { time: {} }), idle()], [assistant("message_final", undefined, { error: {} }), idle()],
      [assistant("message_final", "out/report.txt"), idle()], [assistant("message_final", "`[report](out/report.txt)`"), idle()],
      [assistant("message_final", undefined, { content: [{ type: "reasoning", text: "[report](out/report.txt)" }] }), idle()],
      [assistant("message_final", undefined, { content: [{ type: "tool", state: { content: [{ type: "text", text: "[report](out/report.txt)" }] } }] }), idle()],
    ]) {
      const f = fixture(); f.state.messages = messages
      expect((await f.resolve()).status).toBe(404)
      expect(f.state.calls.some(({ url }) => url.pathname.startsWith("/api/fs/"))).toBe(false)
    }
  })
  test("rejects location switches instead of rebinding old attachments to current location", async () => {
    const f = fixture()
    f.state.messages.push({ id: "switch", type: "location-switched", location: { directory: "/other" }, previous: { location: { directory: "/remote/project" } } })
    expect((await f.resolve()).status).toBe(404)
    f.state.messages = [assistant(), { id: "switch", type: "location-switched" }, idle()]
    expect((await f.resolve()).status).toBe(404)
  })
})

describe("project attachment paths and delivery", () => {
  test("validates paths before engine, rejects URLs, traversal, encoded traversal, UNC and sibling prefixes", () => {
    for (const path of ["../secret", "a/../secret", "%2e%2e/secret", "a%2f..%2fsecret", "https://evil/a", "file:///remote/project/a", "//evil/a", "\\evil", "a%00b", "a%5cb", "/remote/project-other/file", "/etc/passwd", "a?x", "a#x", "C:/a"]) expect(() => projectRelativePath(path, "/remote/project")).toThrow()
    expect(projectRelativePath("/remote/project/out/a%20b.txt", "/remote/project")).toBe("out/a b.txt")
    expect(projectRelativePath("./out/a.txt", "/remote/project")).toBe("out/a.txt")
    expect(projectRelativePath("a%252fb", "/remote/project")).toBe("a%2fb")
  })
  test("outside versus unavailable errors; only links in authoritative Markdown grant paths", async () => {
    const f = fixture()
    f.state.messages = [assistant("message_final", "[outside](/etc/passwd)"), idle()]
    const outside = await f.resolve("/etc/passwd")
    expect(outside.status).toBe(403); expect((await outside.json()).error.code).toBe("outside")
    expect((await f.resolve("unknown.txt")).status).toBe(404)
    f.state.messages = [assistant(), idle()]; f.state.fileStatus = 404 // engine realpath/regular-file/symlink denial is intentionally indistinguishable from missing
    expect((await (await f.resolve()).json()).error.code).toBe("unavailable")
  })
  test("GET current bytes, HEAD, ranges, invalid range, safe headers and active MIME downgraded", async () => {
    const f = fixture(); const { data } = await (await f.resolve()).json()
    f.state.bytes = "changed-current"
    let response = await f.service.handleRequest(req(data.url))
    expect(await response.text()).toBe("changed-current")
    expect(response.headers.get("content-length")).toBe("15")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("content-security-policy")).toContain("sandbox")
    response = await f.service.handleRequest(req(data.url, { method: "HEAD" }))
    expect(response.status).toBe(200); expect(await response.text()).toBe("")
    response = await f.service.handleRequest(req(data.url, { headers: { range: "bytes=1-3" } }))
    expect(response.status).toBe(206); expect(await response.text()).toBe("han")
    expect(response.headers.get("content-range")).toBe("bytes 1-3/15")
    response = await f.service.handleRequest(req(data.url, { headers: { range: "bytes=999-" } }))
    expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */15")
    f.state.mime = "text/html"
    response = await f.service.handleRequest(req(data.url + "?download=1"))
    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(response.headers.get("content-disposition")).toStartWith("attachment;")
    await response.body.cancel()
  })
  test("supports empty and >32MiB metadata, no byte or count quota", async () => {
    const f = fixture(); f.state.bytes = ""
    expect((await (await f.resolve()).json()).data.size).toBe(0)
    // Avoid allocating a huge synthetic file: fake engine reports a large current size.
    const huge = createProjectArtifacts({ opencodeBaseUrl: "http://configured.test", authorization: "fake", fetch: async (url) => {
      if (url.includes("/fs/read/")) return new Response("x", { status: 206, headers: { "content-range": "bytes 0-0/9999999999", "content-type": "application/octet-stream" } })
      if (url.includes("/message?")) return Response.json({ data: [assistant(), idle()], cursor: {} })
      return Response.json({ data: { location: { directory: "/engine-only" } } })
    } })
    expect((await (await huge.handleRequest(resolveRequest())).json()).data.size).toBe(9999999999)
  })
  test("does not evict earlier capabilities at legacy artifact-count boundary", async () => {
    const f = fixture()
    const links = Array.from({ length: 270 }, (_, i) => `out/${i}.txt`)
    f.state.messages = [assistant("message_final", links.map((link) => `[file](${link})`).join("\n")), idle()]
    let first
    for (const link of links) {
      const response = await f.resolve(link)
      expect(response.status).toBe(200)
      const { data } = await response.json()
      first ??= data.url
    }
    const response = await f.service.handleRequest(req(first))
    expect(response.status).toBe(200)
    await response.body.cancel()
  })
  test("never follows redirects; revalidates provenance and engine file confinement every delivery", async () => {
    const f = fixture(); const { data } = await (await f.resolve()).json()
    f.state.fileStatus = 302
    let response = await f.service.handleRequest(req(data.url))
    expect(response.status).toBe(404); expect(await response.text()).not.toContain("private upstream")
    f.state.fileStatus = 404
    expect((await f.service.handleRequest(req(data.url))).status).toBe(404)
    f.state.fileStatus = 200; f.state.messages = [assistant("message_final", "removed"), idle()]
    expect((await f.service.handleRequest(req(data.url))).status).toBe(404)
  })
  test("only raster images are inline; active/unknown MIME is binary and text is plain", async () => {
    const f = fixture(); const { data } = await (await f.resolve()).json()
    for (const [mime, expectedMime, disposition] of [
      ["image/svg+xml", "application/octet-stream", "attachment"],
      ["text/html", "application/octet-stream", "attachment"],
      ["text/xml", "application/octet-stream", "attachment"],
      ["application/xhtml+xml", "application/octet-stream", "attachment"],
      ["application/x-unknown", "application/octet-stream", "attachment"],
      ["text/javascript", "text/plain; charset=utf-8", "attachment"],
      ["application/pdf", "application/pdf", "attachment"],
      ["image/png", "image/png", "inline"],
    ]) {
      f.state.mime = mime
      const response = await f.service.handleRequest(req(data.url))
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe(expectedMime)
      expect(response.headers.get("content-disposition")).toStartWith(`${disposition};`)
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("content-security-policy")).toContain("sandbox")
      await response.body.cancel()
    }
    const download = await f.service.handleRequest(req(data.url + "?download=1"))
    expect(download.headers.get("content-disposition")).toStartWith("attachment;")
    await download.body.cancel()
  })
  test("cancels raw engine stream on downstream cancellation and request abort", async () => {
    const f = fixture(); const { data } = await (await f.resolve()).json()
    f.state.stream = true
    const controller = new AbortController()
    const response = await f.service.handleRequest(req(data.url, { signal: controller.signal }))
    const reader = response.body.getReader(); await reader.read(); await reader.cancel()
    expect(f.state.signals.at(-1).aborted).toBe(true)
    expect(f.state.cancelled).toBe(1)
    const aborter = new AbortController()
    const second = await f.service.handleRequest(req(data.url, { signal: aborter.signal }))
    aborter.abort(); expect(f.state.signals.at(-1).aborted).toBe(true); await second.body.cancel()
  })
  test("gateway retains host/origin/cross-site/JSON checks, route and method ownership", async () => {
    const f = fixture(); const stub = () => new Response("unused")
    const dispatch = createWebDispatcher({ security: { allowedHosts: ["example.test"], allowedOrigins: ["https://example.test"] }, agents: stub, notifications: stub, artifacts: f.service.handleRequest, engine: stub, frontend: stub })
    for (const [headers, status] of [[{ origin: "https://evil.test" }, 403], [{ origin: "" }, 403], [{ host: "evil.test" }, 403], [{ "sec-fetch-site": "cross-site" }, 403], [{ "content-type": "text/plain" }, 415]]) {
      const base = resolveRequest(); const response = await dispatch(new Request(base, { headers: { ...Object.fromEntries(base.headers), ...headers } }))
      expect(response.status).toBe(status)
    }
    expect(f.state.calls).toHaveLength(0)
    expect((await dispatch(resolveRequest())).status).toBe(200)
    expect((await f.service.handleRequest(req("/api/ui/project-artifacts/resolve"))).status).toBe(405)
    const integrated = createArtifactDelivery({ roots: [], opencodeBaseUrl: "http://configured-engine.test", authorization: "Basic synthetic-only", fetch: f.fakeFetch })
    expect((await integrated.handleRequest(resolveRequest())).status).toBe(200)
    expect((await integrated.handleRequest(req("/api/ui/project-artifacts/unknown"))).status).toBe(404)
    expect((await integrated.handleRequest(req("/api/ui/artifacts/unknown"))).status).toBe(404)
  })
})
