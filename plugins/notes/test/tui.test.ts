import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import { setupNotesTui } from "../src/tui.js"
import type { Note, ProjectLink, Space } from "../src/types.js"

interface Command {
  id?: string
  title?: string
  run: (input?: string, event?: unknown) => void | false | Promise<void>
}

interface FakeProject {
  id: string
  canonical: string
  name?: string
}

interface FakeOptions {
  spacesError?: boolean
  projects?: FakeProject[]
  extraSpaces?: Space[]
  spaceNoteCount?: number
  notes?: Note[]
  repeatFirstOnLaterPage?: boolean
}

function fakeContext(options: FakeOptions = {}) {
  const calls: string[] = []
  const toasts: Array<{ title?: string; message: string; variant?: string }> =
    []
  const alerts: Array<{ title: string; message: string }> = []
  const space: Space = {
    id: "space_1",
    name: "Plan",
    kind: "planning",
    project: { id: "project-1", directory: "/repo", canonical: "/repo" },
    pinned: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }
  const spaces = [space, ...(options.extraSpaces ?? [])]
  const note: Note = {
    id: "note_1",
    spaceID: space.id,
    title: "Existing",
    body: "Body",
    status: "todo",
    pinned: false,
    attachments: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }
  const allNotes = options.notes ?? [note]
  const projects = options.projects ?? [
    { id: "project-1", canonical: "/repo", name: "Repo" },
  ]
  const prompts: Array<string | undefined> = []
  const selects: unknown[] = []
  const confirms: Array<boolean | undefined> = []
  const selectCalls: Array<{
    title: string
    options: ReadonlyArray<{ title: string; value: unknown }>
    current?: unknown
  }> = []

  const notes = {
    list: async (input?: unknown) => {
      calls.push(`list:${JSON.stringify(input)}`)
      const value = input as
        { spaceID?: string | null; limit?: number; offset?: number } | undefined
      if (value && Object.prototype.hasOwnProperty.call(value, "spaceID")) {
        const filtered = allNotes.filter(
          (candidate) => candidate.spaceID === value.spaceID
        )
        const total = options.spaceNoteCount ?? filtered.length
        return {
          notes: filtered.slice(0, value.limit ?? filtered.length),
          total,
        }
      }
      const offset = value?.offset ?? 0
      const limit = value?.limit ?? allNotes.length
      if (options.repeatFirstOnLaterPage && offset > 0 && allNotes.length > 0) {
        return {
          notes: [
            allNotes[0]!,
            ...allNotes.slice(offset, offset + Math.max(0, limit - 1)),
          ],
          total: allNotes.length,
        }
      }
      return {
        notes: allNotes.slice(offset, offset + limit),
        total: allNotes.length,
      }
    },
    create: async (input: unknown) => {
      calls.push(`create:${JSON.stringify(input)}`)
      const value = input as { title: string; spaceID?: string | null }
      return {
        note: {
          ...note,
          id: "note_2",
          title: value.title,
          spaceID: value.spaceID ?? null,
        },
      }
    },
    update: async (input: unknown) => {
      calls.push(`update:${JSON.stringify(input)}`)
      return { note }
    },
    delete: async (input: unknown) => {
      calls.push(`delete:${JSON.stringify(input)}`)
      return { deleted: true }
    },
    spaces: async (input?: unknown) => {
      calls.push(`spaces:${JSON.stringify(input)}`)
      if (options.spacesError) throw new Error("backend unavailable")
      return { spaces, total: spaces.length }
    },
    createSpace: async (input: unknown) => {
      calls.push(`createSpace:${JSON.stringify(input)}`)
      return { space: { ...space, name: (input as { name: string }).name } }
    },
    updateSpace: async (input: unknown) => {
      calls.push(`updateSpace:${JSON.stringify(input)}`)
      return { space }
    },
    deleteSpace: async (input: unknown) => {
      calls.push(`deleteSpace:${JSON.stringify(input)}`)
      return { deleted: true, deletedNotes: 0 }
    },
  }

  let layer: { commands: Command[] } | undefined
  const ctx = {
    location: { directory: "/repo" },
    client: { rpc: () => notes },
    data: {
      project: {
        list: () =>
          projects.map((project) => ({
            id: project.id,
            canonical: project.canonical,
            name: project.name,
          })),
      },
    },
    keymap: {
      layer: (factory: () => { commands: Command[] }) => {
        layer = factory()
      },
    },
    ui: {
      toast: {
        show: (toast: { title?: string; message: string; variant?: string }) =>
          toasts.push(toast),
      },
      dialog: {
        alert: async (alert: { title: string; message: string }) => {
          alerts.push(alert)
        },
        prompt: async () => prompts.shift(),
        select: async (options: {
          title: string
          options: ReadonlyArray<{ title: string; value: unknown }>
          current?: unknown
        }) => {
          selectCalls.push(options)
          return selects.shift()
        },
        confirm: async () => confirms.shift(),
      },
    },
  }
  return {
    ctx: ctx as unknown as Plugin.Context,
    calls,
    toasts,
    alerts,
    prompts,
    selects,
    confirms,
    selectCalls,
    space,
    note,
    commands: () => layer?.commands ?? [],
  }
}

async function run(
  fake: ReturnType<typeof fakeContext>,
  id: string
): Promise<void> {
  const command = fake.commands().find((candidate) => candidate.id === id)
  expect(command).toBeDefined()
  await command!.run()
}

function noteWith(overrides: Partial<Note> = {}): Note {
  return {
    id: "note_1",
    spaceID: "space_1",
    title: "Existing",
    body: "Body",
    status: "todo",
    pinned: false,
    attachments: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const project2: ProjectLink = {
  id: "project-2",
  directory: "/other",
  canonical: "/other",
}

describe("notes TUI plugin", () => {
  test("registers the direct command surface", () => {
    const fake = fakeContext()
    setupNotesTui(fake.ctx)
    expect(fake.commands().map((command) => command.id)).toEqual([
      "notes.list",
      "notes.create",
      "notes.update",
      "notes.delete",
      "notes.move",
      "notes.spaces",
      "notes.createSpace",
      "notes.editSpace",
      "notes.deleteSpace",
    ])
  })

  test("lists all notes, including unassigned, and shows details", async () => {
    const fake = fakeContext()
    fake.selects.push(noteWith({ spaceID: null }))
    setupNotesTui(fake.ctx)
    await run(fake, "notes.list")
    expect(fake.calls.find((call) => call.startsWith("list:"))).toBe(
      'list:{"limit":500,"offset":0}'
    )
    expect(fake.alerts[0]?.message).toContain("Space: unassigned")
  })

  test("loads every note page beyond the first 500", async () => {
    const many = Array.from({ length: 1_001 }, (_, index) =>
      noteWith({
        id: `note_${index}`,
        title: `Note ${index}`,
      })
    )
    const fake = fakeContext({ notes: many })
    setupNotesTui(fake.ctx)
    await run(fake, "notes.list")
    expect(fake.calls.filter((call) => call.startsWith("list:"))).toEqual([
      'list:{"limit":500,"offset":0}',
      'list:{"limit":500,"offset":500}',
      'list:{"limit":500,"offset":1000}',
    ])
    const picker = fake.selectCalls.find((call) =>
      call.title.startsWith("All notes")
    )
    expect(picker?.options).toHaveLength(1_001)
    expect(
      picker?.options.some((option) => option.title.includes("Note 1000"))
    ).toBe(true)
  })

  test("deduplicates a note repeated on a later page without skipping one", async () => {
    const many = Array.from({ length: 1_001 }, (_, index) =>
      noteWith({
        id: `note_${index}`,
        title: `Note ${index}`,
      })
    )
    const fake = fakeContext({ notes: many, repeatFirstOnLaterPage: true })
    setupNotesTui(fake.ctx)
    await run(fake, "notes.list")
    expect(fake.calls.filter((call) => call.startsWith("list:"))).toEqual([
      'list:{"limit":500,"offset":0}',
      'list:{"limit":500,"offset":500}',
      'list:{"limit":500,"offset":999}',
    ])
    const picker = fake.selectCalls.find((call) =>
      call.title.startsWith("All notes")
    )
    expect(picker?.options).toHaveLength(1_001)
    expect(
      picker?.options.filter((option) => option.title.includes("Note 0"))
    ).toHaveLength(1)
  })

  test("creates an assigned note", async () => {
    const fake = fakeContext()
    fake.prompts.push("New note", "Body")
    fake.selects.push({ type: "space", space: fake.space }, "todo")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.create")
    expect(fake.calls.find((call) => call.startsWith("create:"))).toContain(
      '"spaceID":"space_1"'
    )
  })

  test("creates an unassigned note through the explicit No space option", async () => {
    const fake = fakeContext()
    fake.prompts.push("Inbox", "Body")
    fake.selects.push({ type: "none" }, "todo")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.create")
    expect(fake.calls.find((call) => call.startsWith("create:"))).toContain(
      '"spaceID":null'
    )
  })

  test("updates only changed fields with expectedRevision", async () => {
    const fake = fakeContext()
    fake.selects.push(noteWith(), "finished", false)
    fake.prompts.push("Existing", "New body")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.update")
    const call = fake.calls.find((value) => value.startsWith("update:"))
    expect(call).toContain('"expectedRevision":1')
    expect(call).toContain('"body":"New body"')
    expect(call).toContain('"status":"finished"')
    expect(call).not.toContain('"title"')
    expect(call).not.toContain('"pinned"')
    expect(call).not.toContain('"spaceID"')
  })

  test("cancelling the note body never clears it", async () => {
    const fake = fakeContext()
    fake.selects.push(noteWith(), "todo", false)
    fake.prompts.push("Existing")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.update")
    expect(fake.calls.some((value) => value.startsWith("update:"))).toBe(false)
    expect(fake.toasts.at(-1)?.message).toBe("No note changes.")
  })

  test("moves a note to another space with expectedRevision", async () => {
    const other: Space = {
      ...fakeContext().space,
      id: "space_2",
      name: "Other",
    }
    const fake = fakeContext({ extraSpaces: [other] })
    fake.selects.push(noteWith(), { type: "space", space: other })
    setupNotesTui(fake.ctx)
    await run(fake, "notes.move")
    const call = fake.calls.find((value) => value.startsWith("update:"))
    expect(call).toContain('"spaceID":"space_2"')
    expect(call).toContain('"expectedRevision":1')
  })

  test("moves a note to unassigned only through the explicit No space option", async () => {
    const fake = fakeContext()
    fake.selects.push(noteWith(), { type: "none" })
    setupNotesTui(fake.ctx)
    await run(fake, "notes.move")
    expect(fake.calls.find((value) => value.startsWith("update:"))).toContain(
      '"spaceID":null'
    )
  })

  test("cancelling the move target does not change the note", async () => {
    const fake = fakeContext()
    fake.selects.push(noteWith())
    setupNotesTui(fake.ctx)
    await run(fake, "notes.move")
    expect(fake.calls.some((value) => value.startsWith("update:"))).toBe(false)
  })

  test("deletes a note after confirmation with expectedRevision", async () => {
    const fake = fakeContext()
    fake.selects.push(noteWith())
    fake.confirms.push(true)
    setupNotesTui(fake.ctx)
    await run(fake, "notes.delete")
    expect(fake.calls).toContain(
      'delete:{"noteID":"note_1","expectedRevision":1}'
    )
  })

  test("creates a planning space linked to any project from the host list", async () => {
    const fake = fakeContext({
      projects: [
        { id: "project-1", canonical: "/repo", name: "Repo" },
        { id: "project-2", canonical: "/other", name: "Other" },
      ],
    })
    fake.prompts.push("Planning")
    fake.selects.push("planning", { type: "project", project: project2 }, true)
    setupNotesTui(fake.ctx)
    await run(fake, "notes.createSpace")
    const call = fake.calls.find((value) => value.startsWith("createSpace:"))
    expect(call).toContain('"kind":"planning"')
    expect(call).toContain('"id":"project-2"')
    expect(call).toContain('"pinned":true')
  })

  test("creates an unlinked space through the explicit No project option", async () => {
    const fake = fakeContext()
    fake.prompts.push("Global")
    fake.selects.push("global", { type: "none" }, false)
    setupNotesTui(fake.ctx)
    await run(fake, "notes.createSpace")
    const call = fake.calls.find((value) => value.startsWith("createSpace:"))
    expect(call).toContain('"project":null')
    expect(call).toContain('"pinned":false')
  })

  test("renames, relinks, re-scopes, and pins a space with expectedRevision", async () => {
    const fake = fakeContext({
      projects: [
        { id: "project-1", canonical: "/repo", name: "Repo" },
        { id: "project-2", canonical: "/other", name: "Other" },
      ],
    })
    fake.selects.push(
      { type: "space", space: fake.space },
      "global",
      { type: "project", project: project2 },
      true
    )
    fake.prompts.push("Renamed")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.editSpace")
    const call = fake.calls.find((value) => value.startsWith("updateSpace:"))
    expect(call).toContain('"expectedRevision":1')
    expect(call).toContain('"name":"Renamed"')
    expect(call).toContain('"kind":"global"')
    expect(call).toContain('"id":"project-2"')
    expect(call).toContain('"pinned":true')
  })

  test("unlinks a space only through the explicit No project option", async () => {
    const fake = fakeContext()
    fake.selects.push(
      { type: "space", space: fake.space },
      "planning",
      { type: "none" },
      false
    )
    fake.prompts.push("Plan")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.editSpace")
    const call = fake.calls.find((value) => value.startsWith("updateSpace:"))
    expect(call).toContain('"project":null')
    expect(call).toContain('"expectedRevision":1')
  })

  test("cancelling the project picker never silently unlinks the space", async () => {
    const fake = fakeContext()
    fake.selects.push(
      { type: "space", space: fake.space },
      "planning",
      undefined,
      undefined
    )
    fake.prompts.push("Plan")
    setupNotesTui(fake.ctx)
    await run(fake, "notes.editSpace")
    expect(fake.calls.some((value) => value.startsWith("updateSpace:"))).toBe(
      false
    )
    expect(fake.toasts.at(-1)?.message).toBe("No space changes.")
  })

  test("deletes an empty space only after confirmation", async () => {
    const fake = fakeContext({ spaceNoteCount: 0 })
    fake.selects.push({ type: "space", space: fake.space })
    fake.confirms.push(true)
    setupNotesTui(fake.ctx)
    await run(fake, "notes.deleteSpace")
    expect(fake.calls).toContain(
      'deleteSpace:{"spaceID":"space_1","expectedRevision":1}'
    )
  })

  test("refuses a non-empty space without calling deleteSpace", async () => {
    const fake = fakeContext({ spaceNoteCount: 2 })
    fake.selects.push({ type: "space", space: fake.space })
    setupNotesTui(fake.ctx)
    await run(fake, "notes.deleteSpace")
    expect(fake.alerts[0]?.title).toBe("Space not empty")
    expect(fake.alerts[0]?.message).toContain("2 note(s)")
    expect(fake.calls.some((value) => value.startsWith("deleteSpace:"))).toBe(
      false
    )
  })

  test("does not delete a space when confirmation is cancelled", async () => {
    const fake = fakeContext({ spaceNoteCount: 0 })
    fake.selects.push({ type: "space", space: fake.space })
    fake.confirms.push(false)
    setupNotesTui(fake.ctx)
    await run(fake, "notes.deleteSpace")
    expect(fake.calls.some((value) => value.startsWith("deleteSpace:"))).toBe(
      false
    )
  })

  test("reports errors through a toast instead of rejecting the keymap command", async () => {
    const fake = fakeContext({ spacesError: true })
    setupNotesTui(fake.ctx)
    await run(fake, "notes.spaces")
    expect(fake.toasts.at(-1)).toMatchObject({
      variant: "error",
      message: "backend unavailable",
    })
  })
})
