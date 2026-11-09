import { describe, expect, test } from "bun:test"
import type { Context } from "@opencode/plugin"
import { setupNotesServer } from "../src/server.js"
import { NOTES_RPC } from "../src/rpc.js"
import { NOTE_PREFIX, SPACE_PREFIX } from "../src/types.js"
import { MemoryStorage } from "./helpers.js"

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
  return { ctx: ctx as unknown as Context, storage, events, state }
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
      "notes_create",
      "notes_update",
      "notes_delete",
      "notes_spaces",
      "notes_create_space",
      "notes_update_space",
      "notes_delete_space",
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
})
