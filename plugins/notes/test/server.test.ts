import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { setupNotesServer } from "../src/server.js"
import { NOTES_RPC } from "../src/rpc.js"
import {
  ATTACHMENT_PREFIX,
  NOTE_PREFIX,
  SPACE_PREFIX,
} from "../src/types.js"
import { MemoryStorage } from "./helpers.js"

/** Build a valid base64 string whose decoded length is exactly `size` bytes. */
function base64OfSize(size: number): string {
  if (size <= 0) return ""
  const padding = (3 - (size % 3)) % 3
  const length = Math.ceil(size / 3) * 4
  return "A".repeat(length - padding) + "=".repeat(padding)
}

interface Handler {
  (
    input: unknown,
    call: {
      signal: AbortSignal
      error: (type: string, message: string, data?: unknown) => unknown
    }
  ): Promise<unknown>
}

interface Registered {
  definition: { id: string }
  handlers: Record<string, Handler>
}

interface RegisteredTool {
  name: string
  description: string
  input: unknown
  execute: (input: unknown, context: unknown) => Promise<{ content?: string }>
}

function fakeContext() {
  const storage = new MemoryStorage()
  const events: Array<{ name: string; data: unknown }> = []
  const state: {
    registered?: Registered
    namespace?: { name: string; description: string }
    tools: RegisteredTool[]
  } = { tools: [] }
  const ctx = {
    location: {
      directory: "/repo",
      project: { id: "project-1", directory: "/repo", canonical: "/repo" },
    },
    storage,
    rpc: {
      register: async (
        definition: { id: string },
        handlers: Record<string, Handler>
      ) => {
        state.registered = { definition, handlers }
        return {
          events: {
            emit: async (name: string, data: unknown) => {
              events.push({ name, data })
            },
          },
          dispose: async () => undefined,
        }
      },
    },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          namespace: (namespace: { name: string; description: string }) => {
            state.namespace = namespace
          },
          add: (tool: RegisteredTool) => {
            state.tools.push(tool)
          },
        })
        return { dispose: async () => undefined }
      },
    },
  }
  return { ctx: ctx as unknown as Plugin.Context, storage, events, state }
}

function call() {
  return {
    signal: new AbortController().signal,
    error: (type: string, message: string, data?: unknown) => ({
      type,
      message,
      data,
    }),
  }
}

describe("notes server adapter", () => {
  test("registers the exact RPC definition and all agent tools", async () => {
    const { ctx, state } = fakeContext()
    const cleanup = await setupNotesServer(ctx)
    expect(state.registered?.definition).toBe(NOTES_RPC)
    expect(Object.keys(state.registered?.handlers ?? {}).sort()).toEqual(
      Object.keys(NOTES_RPC.methods).sort()
    )
    expect(state.namespace?.name).toBe("notes")
    expect(state.tools.map((tool) => tool.name)).toEqual([
      "notes_list",
      "notes_get",
      "notes_create",
      "notes_update",
      "notes_delete",
      "notes_spaces",
      "notes_create_space",
      "notes_update_space",
      "notes_delete_space",
      "notes_attachment_read",
    ])
    await cleanup()
  })

  test("serves RPC CRUD and emits a changed event", async () => {
    const { ctx, storage, events, state } = fakeContext()
    await setupNotesServer(ctx)
    const handlers = state.registered!.handlers

    const createdSpace = (await handlers.createSpace(
      { name: "Plan", kind: "planning", linkCurrentProject: true },
      call()
    )) as {
      space: { id: string; project: { id: string }; revision: number }
    }
    expect(createdSpace.space.project.id).toBe("project-1")
    expect(createdSpace.space.revision).toBe(1)

    const createdNote = (await handlers.create(
      { spaceID: createdSpace.space.id, title: "Note" },
      call()
    )) as {
      note: { id: string; title: string; revision: number }
    }
    expect(createdNote.note.title).toBe("Note")
    expect(createdNote.note.revision).toBe(1)

    const listed = (await handlers.list(
      { projectID: "project-1" },
      call()
    )) as { total: number }
    expect(listed.total).toBe(1)

    const updated = (await handlers.update(
      {
        noteID: createdNote.note.id,
        status: "finished",
        expectedRevision: createdNote.note.revision,
      },
      call()
    )) as {
      note: { status: string; revision: number }
    }
    expect(updated.note.status).toBe("finished")
    expect(updated.note.revision).toBe(2)

    const stale = await handlers.update(
      {
        noteID: createdNote.note.id,
        title: "Stale",
        expectedRevision: createdNote.note.revision,
      },
      call()
    )
    expect(stale).toMatchObject({
      type: "conflict",
      data: {
        entity: "note",
        id: createdNote.note.id,
        expectedRevision: 1,
        revision: 2,
      },
    })

    expect(storage.values.has(`${SPACE_PREFIX}${createdSpace.space.id}`)).toBe(
      true
    )
    expect(storage.values.has(`${NOTE_PREFIX}${createdNote.note.id}`)).toBe(
      true
    )
    expect(events.at(-1)).toEqual({
      name: "changed",
      data: { entity: "note", action: "updated", id: createdNote.note.id },
    })

    const spaces = (await handlers.spaces({}, call())) as { total: number }
    expect(spaces.total).toBe(1)

    const deleted = (await handlers.delete(
      {
        noteID: createdNote.note.id,
        expectedRevision: updated.note.revision,
      },
      call()
    )) as { deleted: boolean }
    expect(deleted.deleted).toBe(true)

    const deletedSpace = (await handlers.deleteSpace(
      {
        spaceID: createdSpace.space.id,
        expectedRevision: createdSpace.space.revision,
      },
      call()
    )) as {
      deleted: boolean
    }
    expect(deletedSpace.deleted).toBe(true)
  })

  test("reads one note and projects list bodies through RPC and tools", async () => {
    const { ctx, state } = fakeContext()
    await setupNotesServer(ctx)
    const handlers = state.registered!.handlers

    const created = (await handlers.create(
      { title: "Note", body: "Body" },
      call()
    )) as { note: { id: string } }

    const read = (await handlers.get(
      { noteID: created.note.id },
      call()
    )) as { note: { id: string; body: string } }
    expect(read.note).toMatchObject({ id: created.note.id, body: "Body" })

    expect(await handlers.get({ noteID: "missing" }, call())).toMatchObject({
      type: "note_not_found",
      data: { noteID: "missing" },
    })

    const getTool = state.tools.find((tool) => tool.name === "notes_get")!
    const getResult = JSON.parse(
      (await getTool.execute({ noteID: created.note.id }, {})).content ?? "{}"
    ) as { id: string; body: string }
    expect(getResult).toMatchObject({ id: created.note.id, body: "Body" })

    const listTool = state.tools.find((tool) => tool.name === "notes_list")!
    const projected = JSON.parse(
      (await listTool.execute({ includeBodies: false }, {})).content ?? "{}"
    ) as { notes: Array<{ body: string }>; total: number }
    expect(projected.total).toBe(1)
    expect(projected.notes[0]?.body).toBe("")

    const full = JSON.parse(
      (await listTool.execute({}, {})).content ?? "{}"
    ) as { notes: Array<{ body: string }> }
    expect(full.notes[0]?.body).toBe("Body")
  })

  test("maps service errors to declared RPC errors and supports generated tools", async () => {
    const { ctx, state } = fakeContext()
    await setupNotesServer(ctx)
    const handlers = state.registered!.handlers

    const missing = await handlers.create(
      { spaceID: "missing", title: "Note" },
      call()
    )
    expect(missing).toMatchObject({
      type: "space_not_found",
      data: { spaceID: "missing" },
    })

    const createSpace = state.tools.find(
      (tool) => tool.name === "notes_create_space"
    )!
    const spaceResult = JSON.parse(
      (await createSpace.execute({ name: "Global" }, {})).content ?? "{}"
    ) as {
      id: string
      revision: number
    }
    const createNote = state.tools.find((tool) => tool.name === "notes_create")!
    const noteResult = JSON.parse(
      (
        await createNote.execute(
          {
            spaceID: spaceResult.id,
            title: "From tool",
            status: "in-progress",
          },
          {}
        )
      ).content ?? "{}"
    ) as { id: string; status: string; revision: number }
    expect(noteResult.status).toBe("in-progress")
    expect(noteResult.revision).toBe(1)

    const listTool = state.tools.find((tool) => tool.name === "notes_list")!
    const listResult = JSON.parse(
      (await listTool.execute({}, {})).content ?? "{}"
    ) as { total: number }
    expect(listResult.total).toBe(1)

    const updateTool = state.tools.find((tool) => tool.name === "notes_update")!
    const updateResult = JSON.parse(
      (
        await updateTool.execute(
          {
            noteID: noteResult.id,
            title: "Updated",
            expectedRevision: noteResult.revision,
          },
          {}
        )
      ).content ?? "{}"
    ) as { revision: number }
    expect(updateResult.revision).toBe(2)

    await expect(
      updateTool.execute(
        { noteID: noteResult.id, title: "Stale", expectedRevision: 1 },
        {}
      )
    ).rejects.toThrow("conflict")

    const deleteSpace = state.tools.find(
      (tool) => tool.name === "notes_delete_space"
    )!
    await expect(
      deleteSpace.execute(
        {
          spaceID: spaceResult.id,
          cascade: true,
          expectedRevision: spaceResult.revision,
        },
        {}
      )
    ).rejects.toThrow("space_not_empty")

    const deleteNote = state.tools.find((tool) => tool.name === "notes_delete")!
    await deleteNote.execute(
      { noteID: noteResult.id, expectedRevision: updateResult.revision },
      {}
    )
    const deletedSpace = JSON.parse(
      (
        await deleteSpace.execute(
          { spaceID: spaceResult.id, expectedRevision: spaceResult.revision },
          {}
        )
      ).content ?? "{}"
    ) as { deleted: boolean }
    expect(deletedSpace.deleted).toBe(true)

    await expect(
      createNote.execute({ spaceID: "missing", title: "Nope" }, {})
    ).rejects.toThrow("space_not_found")
  })

  test("serves attachment RPC and text-only agent reads", async () => {
    const { ctx, storage, state } = fakeContext()
    await setupNotesServer(ctx)
    const handlers = state.registered!.handlers

    const note = (await handlers.create({ title: "Note" }, call())) as {
      note: { id: string; revision: number }
    }
    const text = btoa("hello attachment")
    const created = (await handlers.createAttachment(
      {
        noteID: note.note.id,
        name: "hello.txt",
        mime: "text/plain",
        data: text,
      },
      call()
    )) as {
      note: { revision: number; attachments: unknown[] }
      attachment: { id: string; name: string; mime: string; size: number }
    }
    expect(created.attachment).toMatchObject({
      name: "hello.txt",
      mime: "text/plain",
      size: 16,
    })
    expect(created.note.attachments).toHaveLength(1)
    expect(
      storage.values.has(`${ATTACHMENT_PREFIX}${created.attachment.id}`)
    ).toBe(true)

    const read = (await handlers.readAttachment(
      { noteID: note.note.id, attachmentID: created.attachment.id },
      call()
    )) as { attachment: unknown; data: string }
    expect(read).toEqual({ attachment: created.attachment, data: text })

    const readTool = state.tools.find(
      (tool) => tool.name === "notes_attachment_read"
    )!
    const textResult = JSON.parse(
      (
        await readTool.execute(
          { noteID: note.note.id, attachmentID: created.attachment.id },
          {}
        )
      ).content ?? "{}"
    ) as { readable: boolean; text: string }
    expect(textResult).toMatchObject({ readable: true, text: "hello attachment" })

    const imageData = base64OfSize(4)
    const image = (await handlers.createAttachment(
      {
        noteID: note.note.id,
        name: "pixel.png",
        mime: "image/png",
        data: imageData,
      },
      call()
    )) as { attachment: { id: string } }
    const imageResult = JSON.parse(
      (
        await readTool.execute(
          { noteID: note.note.id, attachmentID: image.attachment.id },
          {}
        )
      ).content ?? "{}"
    ) as { readable: boolean; reason: string }
    expect(imageResult.readable).toBe(false)
    expect(imageResult.reason).toContain("binary")
    expect(JSON.stringify(imageResult)).not.toContain(imageData)

    const pdf = (await handlers.createAttachment(
      {
        noteID: note.note.id,
        name: "doc.pdf",
        mime: "application/pdf",
        data: base64OfSize(4),
      },
      call()
    )) as { attachment: { id: string } }
    const pdfResult = JSON.parse(
      (
        await readTool.execute(
          { noteID: note.note.id, attachmentID: pdf.attachment.id },
          {}
        )
      ).content ?? "{}"
    ) as { readable: boolean; reason: string }
    expect(pdfResult).toMatchObject({ readable: false })

    const bigData = base64OfSize(64 * 1024 + 1)
    const big = (await handlers.createAttachment(
      {
        noteID: note.note.id,
        name: "big.txt",
        mime: "text/plain",
        data: bigData,
      },
      call()
    )) as { note: { revision: number }; attachment: { id: string } }
    const bigResult = JSON.parse(
      (
        await readTool.execute(
          { noteID: note.note.id, attachmentID: big.attachment.id },
          {}
        )
      ).content ?? "{}"
    ) as { readable: boolean; reason: string }
    expect(bigResult.readable).toBe(false)
    expect(bigResult.reason).toContain("too large")
    expect(JSON.stringify(bigResult)).not.toContain(bigData)

    const missing = await handlers.readAttachment(
      { noteID: note.note.id, attachmentID: "missing" },
      call()
    )
    expect(missing).toMatchObject({
      type: "attachment_not_found",
      data: { noteID: note.note.id, attachmentID: "missing" },
    })

    const invalid = await handlers.createAttachment(
      {
        noteID: note.note.id,
        name: "bad.html",
        mime: "text/html",
        data: btoa("x"),
      },
      call()
    )
    expect(invalid).toMatchObject({
      type: "invalid",
      data: { field: "mime" },
    })

    const deleted = (await handlers.deleteAttachment(
      {
        noteID: note.note.id,
        attachmentID: image.attachment.id,
        expectedRevision: big.note.revision,
      },
      call()
    )) as { note: { attachments: unknown[] } }
    expect(deleted.note.attachments).toHaveLength(3)
    expect(
      storage.values.has(`${ATTACHMENT_PREFIX}${image.attachment.id}`)
    ).toBe(false)
    expect(new Set(state.tools.map((tool) => tool.name)).size).toBe(
      state.tools.length
    )
  }, 30_000)
})
