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

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const TIFF = Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0])
const HEIC = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])

function fakeFileReader() {
  const previous = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = "data:application/octet-stream;base64,e30="
      this.onload()
    }
  }
  return () => {
    if (previous === undefined) delete globalThis.FileReader
    else globalThis.FileReader = previous
  }
}

test("sniffImageMime identifies supported image signatures", async () => {
  const { sniffImageMime } = await import("../src/lib/attachments")
  expect(sniffImageMime(PNG)).toBe("image/png")
  expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg")
  expect(sniffImageMime(new TextEncoder().encode("GIF89a..."))).toBe("image/gif")
  expect(sniffImageMime(new TextEncoder().encode("RIFF0000WEBP"))).toBe("image/webp")
  expect(sniffImageMime(HEIC)).toBe("image/heic")
  expect(sniffImageMime(new TextEncoder().encode("not an image"))).toBeNull()
})

test("clipboard photos without usable metadata are identified by signature", async () => {
  const restore = fakeFileReader()
  try {
    const unnamed = await attachmentFromBrowserFile(
      new File([PNG], "", { type: "" }),
      "paste-1",
      "clipboard-image-1"
    )
    expect(unnamed.mime).toBe("image/png")
    expect(unnamed.name).toBe("clipboard-image-1")
    expect(unnamed.uri).toBe("data:image/png;base64,e30=")
    expect(unnamed.previewDataUrl).toBe(unnamed.uri)
    expect(
      validateComposerAttachment(
        unnamed,
        { capabilities: { input: ["text", "image"] } },
        []
      )
    ).toBeNull()

    const generic = await attachmentFromBrowserFile(
      new File([PNG], "photo", { type: "image/*" }),
      "paste-2",
      "clipboard-image-2"
    )
    expect(generic.mime).toBe("image/png")

    const alias = await attachmentFromBrowserFile(
      new File([Uint8Array.from([0xff, 0xd8, 0xff, 0])], "photo.jpg", {
        type: "image/jpg",
      }),
      "paste-3"
    )
    expect(alias.mime).toBe("image/jpeg")
    expect(alias.uri).toBe("data:image/jpeg;base64,e30=")
  } finally {
    restore()
  }
})

test("unsupported photo formats fail with an actionable message", async () => {
  const restore = fakeFileReader()
  try {
    await expect(
      attachmentFromBrowserFile(
        new File([HEIC], "photo", { type: "" }),
        "paste-4",
        "clipboard-image-4"
      )
    ).rejects.toThrow("Convert the image to PNG, JPEG, WebP, GIF, or AVIF")
    await expect(
      attachmentFromBrowserFile(
        new File([TIFF], "photo.tiff", { type: "image/tiff" }),
        "paste-5"
      )
    ).rejects.toThrow("not a supported")
  } finally {
    restore()
  }
})
