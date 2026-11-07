import type { ModelInfo } from "@/lib/opencode"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  attachmentKind,
  formatFileSize,
  inferMime,
  isSafeImageMime,
  modelSupportsAttachment,
} from "@/lib/files"

export type ComposerAttachment = {
  id: string
  name: string
  mime: string
  size: number | null
  uri: string
  source: "inline" | "uri"
  previewDataUrl?: string
  projectPath?: string
}

export type LiveAttachmentPreview = {
  name: string | null
  mime: string
  dataUrl?: string
}

const IMAGE_MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = ""
  for (let index = offset; index < offset + length && index < bytes.length; index++) {
    text += String.fromCharCode(bytes[index])
  }
  return text
}

/**
 * Detect common image formats by their file signature. Clipboard providers
 * often supply a generic `image/*` type or no type or file name at all, so the
 * declared metadata cannot be trusted. Unsupported formats are still reported
 * so the UI can give a specific, actionable error.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6)
    if (header === "GIF87a" || header === "GIF89a") return "image/gif"
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp"
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4)
    if (brand === "avif" || brand === "avis") return "image/avif"
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heic"
    }
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return "image/tiff"
  }
  return null
}

function readFilePrefix(file: File): Promise<Uint8Array> {
  return file
    .slice(0, 32)
    .arrayBuffer()
    .then((buffer) => new Uint8Array(buffer))
}

export function promptFileForAttachment(attachment: ComposerAttachment): {
  uri: string
  name?: string
} {
  return attachment.name
    ? { uri: attachment.uri, name: attachment.name }
    : { uri: attachment.uri }
}

export function liveAttachmentFor(
  attachment: ComposerAttachment
): LiveAttachmentPreview {
  return {
    name: attachment.name || null,
    mime: attachment.mime,
    ...(attachment.source === "inline"
      ? { dataUrl: attachment.uri }
      : {}),
  }
}

export function validateComposerAttachment(
  attachment: ComposerAttachment,
  model: ModelInfo | null | undefined,
  existing: ComposerAttachment[]
): string | null {
  if (existing.length >= MAX_ATTACHMENT_COUNT) {
    return `You can attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`
  }

  if (attachment.size !== null && attachment.size > MAX_ATTACHMENT_BYTES) {
    return `${attachment.name} is ${formatFileSize(attachment.size)}; the attachment limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`
  }

  const total = existing.reduce((sum, item) => sum + (item.size ?? 0), 0)
  if (
    attachment.size !== null &&
    total + attachment.size > MAX_TOTAL_ATTACHMENT_BYTES
  ) {
    return `These attachments exceed the ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} total limit.`
  }

  if (!modelSupportsAttachment(model, attachment.mime)) {
    const kind = attachmentKind(attachment.mime)
    return kind === "binary"
      ? `${attachment.name} is not a supported text, image, or PDF attachment.`
      : `The selected model does not accept ${kind} attachments.`
  }

  if (attachment.source === "inline" && !attachment.uri.startsWith("data:")) {
    return "Inline attachment data is invalid."
  }

  if (attachment.source === "uri" && !attachment.uri.startsWith("file:")) {
    return "Project attachments must use a local file URI."
  }

  if (isSafeImageMime(attachment.mime) && attachment.source === "inline") {
    const comma = attachment.uri.indexOf(",")
    if (comma < 0 || !attachment.uri.slice(0, comma).includes(";base64")) {
      return "Image attachment data is invalid."
    }
  }

  return null
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Unable to read the selected file."))
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:")) {
        resolve(reader.result)
      } else {
        reject(new Error("Unable to read the selected file."))
      }
    }
    reader.readAsDataURL(file)
  })
}

export async function attachmentFromBrowserFile(
  file: File,
  id: string,
  fallbackName?: string
): Promise<ComposerAttachment> {
  const displayName = file.name.trim() || fallbackName || "clipboard-image"

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${displayName} is ${formatFileSize(file.size)}; the attachment limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`
    )
  }

  const declaredRaw = file.type.toLowerCase().split(";", 1)[0].trim()
  const declared = IMAGE_MIME_ALIASES[declaredRaw] ?? declaredRaw
  const declaredIsGeneric = !declared || declared === "application/octet-stream" || declared.endsWith("/*")
  let mime = declaredIsGeneric ? inferMime(file.name) : declared
  // Clipboard and photo sources may label an image generically (`image/*`)
  // or give it no type or file name at all. Identify the actual image from
  // its signature before applying the same safe attachment checks.
  if (
    declared.endsWith("/*") ||
    mime === "application/octet-stream" ||
    (mime.startsWith("image/") && !isSafeImageMime(mime))
  ) {
    const sniffed = sniffImageMime(await readFilePrefix(file))
    if (sniffed) mime = sniffed
  }
  // Browsers commonly label source files with application/* MIME types.
  // Send recognized text files as text/plain in the data URI as well.
  if (
    inferMime(file.name) === "text/plain" &&
    (mime === "application/json" ||
      mime === "application/javascript" ||
      mime === "application/x-javascript" ||
      mime === "application/typescript" ||
      mime === "application/xml" ||
      mime === "application/yaml" ||
      mime === "application/x-yaml")
  ) {
    mime = "text/plain"
  }
  if (attachmentKind(mime) === "binary" || mime === "image/svg+xml") {
    throw new Error(
      `${displayName} is not a supported text, image, or PDF attachment.${mime.startsWith("image/") ? " Convert the image to PNG, JPEG, WebP, GIF, or AVIF and try again." : ""}`
    )
  }

  const dataUrl = await readAsDataUrl(file)
  // when it came from a signature rather than the browser's file metadata.
  const uri = `data:${mime};base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}`
  return {
    id,
    name: displayName,
    mime,
    size: file.size,
    uri,
    source: "inline",
    ...(isSafeImageMime(mime) ? { previewDataUrl: uri } : {}),
  }
}
