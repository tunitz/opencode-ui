import { describe, expect, test } from "bun:test"
import { JsonSchema } from "effect"
import { NOTES_RPC } from "../src/rpc.js"

const METHOD_NAMES = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "createAttachment",
  "readAttachment",
  "deleteAttachment",
  "spaces",
  "createSpace",
  "updateSpace",
  "deleteSpace",
]

describe("notes RPC contract", () => {
  test("uses the agreed id and method names", () => {
    expect(NOTES_RPC.id).toBe("opencode-notes")
    expect(Object.keys(NOTES_RPC.methods).sort()).toEqual(
      METHOD_NAMES.toSorted()
    )
  })

  test("declares object input and output schemas with closed properties", () => {
    for (const name of METHOD_NAMES) {
      const method = NOTES_RPC.methods[name as keyof typeof NOTES_RPC.methods]
      expect(method.input.type).toBe("object")
      expect(method.input.additionalProperties).toBe(false)
      expect(method.output.type).toBe("object")
      expect(method.output.additionalProperties).toBe(false)
    }
  })

  test("declares closed single-note reads and optional body projection", () => {
    const get = NOTES_RPC.methods.get
    expect(get.input.required).toEqual(["noteID"])
    expect(Object.keys(get.input.properties)).toEqual(["noteID"])
    expect(get.output.required).toEqual(["note"])
    expect(Object.keys(get.output.properties)).toEqual(["note"])
    expect(get.errors.note_not_found.required).toEqual(["noteID"])

    expect(NOTES_RPC.methods.list.input.properties.includeBodies).toEqual({
      type: "boolean",
    })
    expect(Object.keys(NOTES_RPC.methods.list.input)).not.toContain("required")
  })

  test("documents the note lifecycle and space kinds", () => {
    const create = NOTES_RPC.methods.create.input
    expect(create.properties.status.enum).toEqual([
      "todo",
      "in-progress",
      "finished",
    ])
    const createSpace = NOTES_RPC.methods.createSpace.input
    expect(createSpace.properties.kind.enum).toEqual(["global", "planning"])
    expect(createSpace.required).toEqual(["name"])
  })

  test("declares expected errors", () => {
    expect(Object.keys(NOTES_RPC.methods.list.errors)).toEqual(["invalid"])
    expect(Object.keys(NOTES_RPC.methods.get.errors).sort()).toEqual([
      "invalid",
      "note_not_found",
    ])
    expect(Object.keys(NOTES_RPC.methods.spaces.errors)).toEqual(["invalid"])
    expect(Object.keys(NOTES_RPC.methods.create.errors).sort()).toEqual([
      "invalid",
      "space_not_found",
    ])
    expect(Object.keys(NOTES_RPC.methods.update.errors).sort()).toEqual([
      "conflict",
      "invalid",
      "note_not_found",
      "space_not_found",
    ])
    expect(Object.keys(NOTES_RPC.methods.delete.errors).sort()).toEqual([
      "conflict",
      "invalid",
    ])
    expect(
      Object.keys(NOTES_RPC.methods.createAttachment.errors).sort()
    ).toEqual([
      "attachment_limit",
      "conflict",
      "invalid",
      "note_not_found",
    ])
    expect(
      Object.keys(NOTES_RPC.methods.readAttachment.errors).sort()
    ).toEqual(["attachment_not_found", "invalid", "note_not_found"])
    expect(
      Object.keys(NOTES_RPC.methods.deleteAttachment.errors).sort()
    ).toEqual([
      "attachment_not_found",
      "conflict",
      "invalid",
      "note_not_found",
    ])
    expect(Object.keys(NOTES_RPC.methods.updateSpace.errors).sort()).toEqual([
      "conflict",
      "invalid",
      "space_not_found",
    ])
    expect(Object.keys(NOTES_RPC.methods.deleteSpace.errors).sort()).toEqual([
      "conflict",
      "invalid",
      "space_not_empty",
    ])
  })

  test("exposes revisions and optional expectedRevision checks", () => {
    const note = NOTES_RPC.methods.create.output.properties.note
    const space = NOTES_RPC.methods.createSpace.output.properties.space
    expect(note.required).toContain("revision")
    expect(space.required).toContain("revision")
    expect(note.properties.revision).toEqual({ type: "integer", minimum: 0 })
    expect(space.properties.revision).toEqual({ type: "integer", minimum: 0 })

    expect(NOTES_RPC.methods.update.input.properties.expectedRevision).toEqual({
      type: "integer",
      minimum: 0,
    })
    expect(NOTES_RPC.methods.delete.input.properties.expectedRevision).toEqual({
      type: "integer",
      minimum: 0,
    })
    expect(
      NOTES_RPC.methods.updateSpace.input.properties.expectedRevision
    ).toEqual({ type: "integer", minimum: 0 })
    expect(
      NOTES_RPC.methods.deleteSpace.input.properties.expectedRevision
    ).toEqual({ type: "integer", minimum: 0 })
    expect(
      NOTES_RPC.methods.create.input.properties.expectedRevision
    ).toBeUndefined()

    const conflict = NOTES_RPC.methods.update.errors.conflict
    expect(conflict.required).toEqual([
      "entity",
      "id",
      "expectedRevision",
      "revision",
    ])
    expect(conflict.properties.entity.enum).toEqual(["note", "space"])
    expect(NOTES_RPC.methods.deleteSpace.input.properties.cascade).toEqual({
      type: "boolean",
    })
  })

  test("declares metadata-only attachments and attachment methods", () => {
    const note = NOTES_RPC.methods.create.output.properties.note
    expect(note.required).toContain("attachments")
    const attachment = note.properties.attachments.items
    expect(attachment.additionalProperties).toBe(false)
    expect(attachment.required).toEqual([
      "id",
      "name",
      "mime",
      "size",
      "createdAt",
    ])
    expect(attachment.properties.size).toEqual({ type: "integer", minimum: 0 })

    const createAttachment = NOTES_RPC.methods.createAttachment
    expect(createAttachment.input.required).toEqual([
      "noteID",
      "name",
      "mime",
      "data",
    ])
    expect(createAttachment.output.required).toEqual(["note", "attachment"])
    expect(createAttachment.errors.attachment_limit.required).toEqual([
      "noteID",
      "attachmentCount",
      "size",
      "limit",
    ])
    expect(NOTES_RPC.methods.readAttachment.output.required).toEqual([
      "attachment",
      "data",
    ])
    expect(NOTES_RPC.methods.deleteAttachment.output.required).toEqual(["note"])
    expect(NOTES_RPC.methods.deleteAttachment.input.properties.expectedRevision)
      .toEqual({ type: "integer", minimum: 0 })
  })

  test("every schema converts as draft 2020-12 JSON Schema", () => {
    for (const method of Object.values(NOTES_RPC.methods)) {
      expect(() =>
        JsonSchema.fromSchemaDraft2020_12(method.input)
      ).not.toThrow()
      expect(() =>
        JsonSchema.fromSchemaDraft2020_12(method.output)
      ).not.toThrow()
    }
    expect(() =>
      JsonSchema.fromSchemaDraft2020_12(NOTES_RPC.events.changed.schema)
    ).not.toThrow()
  })

  test("declares a changed event and remains JSON serializable", () => {
    expect(NOTES_RPC.events.changed.schema.required).toEqual([
      "entity",
      "action",
      "id",
    ])
    expect(typeof JSON.stringify(NOTES_RPC)).toBe("string")
  })
})
