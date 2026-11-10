import { afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { create } from "react-test-renderer"
import { Markdown } from "../src/components/markdown"

let previousDocument
beforeEach(() => { previousDocument = globalThis.document; globalThis.document = { addEventListener() {}, removeEventListener() {} } })
afterEach(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })

const notes = (overrides = {}) => ({
  directory: "/project",
  readAttachment: async () => { throw new Error("not available") },
  onOpenAttachment: () => {},
  ...overrides,
})
const render = (markdown, props = {}) =>
  renderToStaticMarkup(React.createElement(Markdown, props, markdown))

test("notes render safe project images and relative file links through fs read", () => {
  const image = render("![pic](docs/pic.png)", { notes: notes() })
  expect(image).toContain('src="/api/fs/read/docs/pic.png')
  expect(image).toContain('alt="pic"')
  const link = render("[doc](docs/a.md)", { notes: notes() })
  expect(link).toContain('href="/api/fs/read/docs/a.md')
  expect(link).toContain("doc")
  const spaced = render("![pic](<docs/my pic.png>)", { notes: notes() })
  expect(spaced).toContain('src="/api/fs/read/docs/my%20pic.png')
})

test("notes refuse remote, data, absolute, traversal, and SVG images", () => {
  for (const source of [
    "https://example.com/a.png",
    "//example.com/a.png",
    "data:image/png;base64,AAAA",
    "/etc/passwd.png",
    "../secret.png",
    "docs/../secret.png",
    "docs/vector.svg",
  ]) {
    const html = render(`![secret](${source})`, { notes: notes() })
    expect(html).not.toContain("<img")
    expect(html).not.toContain(source)
  }
})

test("notes refuse remote links but keep relative file links", () => {
  const remote = render("[site](https://example.com)", { notes: notes() })
  expect(remote).not.toContain('href="https://example.com"')
  expect(remote).toContain("site")
  const absolute = render("[file](/etc/passwd)", { notes: notes() })
  expect(absolute).not.toContain('href="/etc/passwd"')
  const fragment = render("[section](#details)", { notes: notes() })
  expect(fragment).toContain('href="#details"')
})

test("notes render attachment links as buttons and keep raw HTML skipped", () => {
  const html = render("[report](attachment://attachment_1)\n\n<script>alert(1)</script>", { notes: notes() })
  expect(html).toContain("<button")
  expect(html).toContain("report")
  expect(html).not.toContain("<script>")
})

test("chat Markdown keeps its stricter image policy", () => {
  const images = render("![x](https://example.com/a.png)")
  expect(images).not.toContain("<img")
  const links = render("[site](https://example.com)")
  expect(links).toContain('href="https://example.com"')
  const raw = render('<img src="https://example.com/a.png">')
  expect(raw).not.toContain("<img")
})

test("attachment images resolve lazily and unsafe types fall back to a card", async () => {
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  const previousWindow = globalThis.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }
  let root
  try {
    const safe = notes({
      readAttachment: async () => ({
        attachment: { id: "attachment_1", name: "shot.png", mime: "image/png", size: 8 },
        data: "iVBORw0KGgo=",
      }),
    })
    await act(async () => { root = create(React.createElement(Markdown, { notes: safe }, "![shot](attachment://attachment_1)")) })
    await act(async () => {})
    expect(JSON.stringify(root.toJSON())).toContain("data:image/png;base64,iVBORw0KGgo=")
    await act(async () => root.unmount())
    root = undefined
    const unsafe = notes({
      readAttachment: async () => ({
        attachment: { id: "attachment_2", name: "page.html", mime: "text/html", size: 8 },
        data: "PHNjcmlwdD4=",
      }),
    })
    await act(async () => { root = create(React.createElement(Markdown, { notes: unsafe }, "![page](attachment://attachment_2)")) })
    await act(async () => {})
    const fallback = JSON.stringify(root.toJSON())
    expect(fallback).toContain('"type":"button"')
    expect(fallback).toContain("page")
    expect(fallback).not.toContain("data:text/html")
  } finally {
    if (root) await act(async () => root.unmount())
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
