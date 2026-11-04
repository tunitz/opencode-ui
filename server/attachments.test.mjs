import { expect, test } from "bun:test"
import { attachmentFromBrowserFile, validateComposerAttachment } from "../src/lib/attachments"
import { inferMime } from "../src/lib/files"

test("source files are accepted as text and carry a matching data URI", async () => {
  const previous = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL(file) {
      this.result = `data:${file.type || "application/octet-stream"};base64,e30=`
      this.onload()
    }
  }
  try {
    for (const [name, type] of [["config.json", "application/json"], ["app.js", "application/javascript"], ["main.rs", ""], ["Dockerfile", ""]]) {
      const attachment = await attachmentFromBrowserFile(new File(["{}"], name, { type }), name)
      expect(attachment.mime.startsWith("text/")).toBe(true)
      expect(attachment.uri).toStartWith(`data:${attachment.mime};`)
      if (name === "config.json") expect(attachment.uri).toBe("data:text/plain;base64,e30=")
      expect(validateComposerAttachment(attachment, null, [])).toBeNull()
    }
    expect(inferMime("project.json")).toBe("text/plain")
    await expect(attachmentFromBrowserFile(new File(["x"], "image.svg", { type: "image/svg+xml" }), "svg")).rejects.toThrow("not a supported")
    await expect(attachmentFromBrowserFile(new File(["x"], "program.exe", { type: "application/octet-stream" }), "exe")).rejects.toThrow("not a supported")
  } finally {
    if (previous === undefined) delete globalThis.FileReader
    else globalThis.FileReader = previous
  }
})
