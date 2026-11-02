import { expect, test } from "bun:test"
import { readPreviewText } from "../src/components/preview-text-data.ts"

test("text preview bounds and cancels a response that ignores Range", async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode("abcdefgh")) },
    cancel() { cancelled = true },
  }))
  expect(await readPreviewText(response, 5)).toEqual({ text: "abcde", truncated: true })
  expect(cancelled).toBe(true)
})

test("text preview reports truncation from a valid partial content range", async () => {
  const partial = new Response("hello", { status: 206, headers: { "content-range": "bytes 0-4/10" } })
  expect(await readPreviewText(partial, 5)).toEqual({ text: "hello", truncated: true })
  const complete = new Response("hello", { status: 206, headers: { "content-range": "bytes 0-4/5" } })
  expect(await readPreviewText(complete, 5)).toEqual({ text: "hello", truncated: false })
})
