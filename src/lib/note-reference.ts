import type { ComposerAttachment } from "@/lib/attachments"
import { formatFileSize } from "@/lib/files"

export type NoteReferenceStatus = "todo" | "in-progress" | "finished"

export type NoteReferenceAttachment = {
  id: string
  name: string
  mime: string
  size: number
}

export type NoteReferenceInput = {
  id: string
  title: string
  content: string
  status: NoteReferenceStatus
  attachments?: readonly NoteReferenceAttachment[]
}

const statusText: Record<NoteReferenceStatus, string> = {
  todo: "To do",
  "in-progress": "In progress",
  finished: "Finished",
}

export function noteStatusText(status: NoteReferenceStatus): string {
  return statusText[status]
}

/** A display-only file name. The URI and attachment id remain opaque. */
export function noteReferenceFileName(title: string): string {
  let safe = ""
  for (const char of title.trim()) {
    const code = char.codePointAt(0) ?? 0
    safe +=
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      /[\\/:*?"<>|]/.test(char)
        ? " "
        : char
  }
  const trimmed = safe.replace(/\s+/g, " ").trim().slice(0, 120)
  return `Note - ${trimmed || "untitled"}.md`
}

/**
 * Produce the Markdown that reaches the model. It deliberately includes an
 * attachment manifest but not uploaded bytes: the user can attach images
 * separately when the model needs to see them.
 */
export function noteReferenceMarkdown(
  note: NoteReferenceInput,
  spaceName: string | null
): string {
  const lines = [
    `# ${note.title.trim() || "Untitled note"}`,
    "",
    `Status: ${noteStatusText(note.status)}`,
    `Space: ${spaceName?.trim() || "No space"}`,
    "",
    note.content,
  ]
  const attachments = note.attachments ?? []
  if (attachments.length > 0) {
    lines.push("", "## Attachments", "")
    for (const attachment of attachments) {
      lines.push(
        `- ${attachment.name} (${attachment.mime}, ${formatFileSize(attachment.size)})`
      )
    }
  }
  return `${lines.join("\n").trimEnd()}\n`
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  // Avoid apply() argument limits on large notes by chunking the bytes.
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.slice(index, index + 8_192))
  }
  return btoa(binary)
}

export function noteReferenceAttachment(
  note: NoteReferenceInput,
  spaceName: string | null,
  id: string
): ComposerAttachment {
  const markdown = noteReferenceMarkdown(note, spaceName)
  const bytes = new TextEncoder().encode(markdown)
  return {
    id,
    name: noteReferenceFileName(note.title),
    mime: "text/markdown",
    size: bytes.length,
    uri: `data:text/markdown;base64,${base64Utf8(markdown)}`,
    source: "inline",
  }
}
