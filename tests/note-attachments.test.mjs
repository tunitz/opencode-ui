import { expect, test } from "bun:test"
import {
  attachmentDataURL,
  isRejectedAttachmentMime,
} from "../src/components/note-attachment-dialog"

test("active attachment MIME types are rejected before preview", () => {
  for (const mime of [
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
    "application/ecmascript",
    "text/ecmascript",
  ]) {
    expect(isRejectedAttachmentMime(mime)).toBe(true)
    expect(attachmentDataURL(mime, "AAAA")).toBeNull()
  }
  expect(isRejectedAttachmentMime("image/png")).toBe(false)
  expect(attachmentDataURL("image/png", "AAAA")).toBe("data:image/png;base64,AAAA")
  expect(attachmentDataURL(undefined, "AAAA")).toBeNull()
})
