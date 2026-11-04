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
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${file.name} is ${formatFileSize(file.size)}; the attachment limit is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`
    )
  }

  const declared = file.type.toLowerCase().split(";", 1)[0].trim()
  let mime =
    declared && declared !== "application/octet-stream"
      ? declared
      : inferMime(file.name)
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
      `${file.name} is not a supported text, image, or PDF attachment.`
    )
  }

  const dataUrl = await readAsDataUrl(file)
  const uri = mime === "text/plain"
    ? `data:text/plain;base64,${dataUrl.slice(dataUrl.indexOf(",") + 1)}`
    : dataUrl
  return {
    id,
    name: file.name.trim() || fallbackName || "clipboard-image",
    mime,
    size: file.size,
    uri,
    source: "inline",
    ...(isSafeImageMime(mime) ? { previewDataUrl: uri } : {}),
  }
}
