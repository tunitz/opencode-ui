import { describe, expect, test } from "bun:test"
import {
  noteReferenceAttachment,
  noteReferenceFileName,
  noteReferenceMarkdown,
} from "../src/lib/note-reference.ts"

const note = {
  id: "note_1",
  title: "Release plan",
  content: "Ship the notes workspace.\n\n- preview\n- attachments",
  status: "in-progress",
  attachments: [
    { id: "a1", name: "diagram.png", mime: "image/png", size: 1536 },
    { id: "a2", name: "spec.pdf", mime: "application/pdf", size: 2048 },
  ],
}

describe("composer note references", () => {
  test("builds a readable Markdown file without embedding attachment bytes", () => {
    const markdown = noteReferenceMarkdown(note, "opencode-ui")
    expect(markdown).toContain("# Release plan")
    expect(markdown).toContain("Status: In progress")
    expect(markdown).toContain("Space: opencode-ui")
    expect(markdown).toContain("Ship the notes workspace.")
    expect(markdown).toContain("## Attachments")
    expect(markdown).toContain("- diagram.png (image/png, 1.5 kB)")
    expect(markdown).toContain("- spec.pdf (application/pdf, 2.0 kB)")
    expect(markdown).not.toContain("attachment://")
    expect(markdown).not.toContain("base64")
  })

  test("labels missing spaces and empty bodies honestly", () => {
    const markdown = noteReferenceMarkdown(
      { ...note, title: "  ", content: "", status: "todo", attachments: [] },
      null
    )
    expect(markdown).toContain("# Untitled note")
    expect(markdown).toContain("Status: To do")
    expect(markdown).toContain("Space: No space")
    expect(markdown).not.toContain("## Attachments")
  })

  test("builds a sanitized file name without path or control characters", () => {
    expect(noteReferenceFileName("Plan / next: step")).toBe(
      "Note - Plan next step.md"
    )
    expect(noteReferenceFileName("\u0000\u202e")).toBe("Note - untitled.md")
    expect(noteReferenceFileName("x".repeat(400)).length).toBeLessThanOrEqual(
      130
    )
  })

  test("produces an inline Markdown attachment that decodes to the same text", async () => {
    const attachment = noteReferenceAttachment(note, "opencode-ui", "note-1")
    expect(attachment.name).toBe("Note - Release plan.md")
    expect(attachment.mime).toBe("text/markdown")
    expect(attachment.source).toBe("inline")
    expect(attachment.uri).toStartWith("data:text/markdown;base64,")
    const encoded = attachment.uri.slice(attachment.uri.indexOf(",") + 1)
    expect(atob(encoded)).toBe(noteReferenceMarkdown(note, "opencode-ui"))
    expect(attachment.size).toBe(
      new TextEncoder().encode(noteReferenceMarkdown(note, "opencode-ui"))
        .length
    )
  })
})
