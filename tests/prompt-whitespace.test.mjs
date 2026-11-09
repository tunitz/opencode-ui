import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"

test("pinned client transmits prompt whitespace and CRLF literally", async () => {
  let body
  const client = OpenCode.make({
    baseUrl: "http://synthetic.invalid",
    fetch: async (_url, init) => {
      body = JSON.parse(init.body)
      return Response.json({})
    },
  })
  const text = '  first\r\n@"src/a\\u0020b.ts"\r\nlast  '
  await client.session.prompt({ sessionID: "synthetic", text })
  expect(body.text).toBe(text)
})

test("draft storage preserves whitespace-only and CRLF drafts exactly", async () => {
  const { readDraft, updateDraft } = await import("../src/lib/drafts")
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const data = new Map()
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  } })
  try {
    expect(updateDraft("A", " \r\n ", "")).toBe("saved")
    expect(readDraft("A")).toBe(" \r\n ")
    expect(updateDraft("A", "  text\r\n ", " \r\n ")).toBe("saved")
    expect(readDraft("A")).toBe("  text\r\n ")
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor)
    else delete globalThis.localStorage
  }
})
