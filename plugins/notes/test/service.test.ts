import { describe, expect, test } from "bun:test"
import { NotesService } from "../src/service.js"
import { NOTE_PREFIX } from "../src/types.js"
import { MemoryStorage, seededClock, seededIDs } from "./helpers.js"

function makeService(
  options: {
    defaultProject?: { id: string; directory: string; canonical: string }
    now?: () => number
  } = {}
) {
  const storage = new MemoryStorage()
  const events: Array<{ entity: string; action: string; id: string }> = []
  const service = new NotesService({
    storage,
    defaultProject: options.defaultProject,
    now: options.now ?? seededClock(),
    createID: seededIDs(),
    onChange: (event) => events.push(event),
  })
  return { service, storage, events }
}

describe("NotesService", () => {
  test("creates a global space and a todo note", async () => {
    const { service } = makeService()
    const space = await service.createSpace({ name: "Global" })
    expect(space.kind).toBe("global")
    expect(space.project).toBeNull()
    expect(space.pinned).toBe(false)
    expect(space.revision).toBe(1)

    const note = await service.create({
      spaceID: space.id,
      title: "First note",
    })
    expect(note.status).toBe("todo")
    expect(note.body).toBe("")
    expect(note.pinned).toBe(false)
    expect(note.spaceID).toBe(space.id)
    expect(note.revision).toBe(1)

    const listed = await service.list()
    expect(listed.total).toBe(1)
    expect(listed.notes[0]).toEqual(note)
    expect(listed.notes[0]?.revision).toBe(1)
  })

  test("supports unassigned notes and null-space filtering", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Inbox" })
    expect(note.spaceID).toBeNull()
    expect((await service.list({ spaceID: null })).notes[0]?.id).toBe(note.id)
    expect((await service.list()).notes.map((item) => item.id)).toEqual([
      note.id,
    ])

    const space = await service.createSpace({ name: "Space" })
    const moved = await service.update({ noteID: note.id, spaceID: space.id })
    expect(moved.spaceID).toBe(space.id)
    const unassigned = await service.update({ noteID: note.id, spaceID: null })
    expect(unassigned.spaceID).toBeNull()
  })

  test("links planning spaces to the current project and includes global spaces in project views", async () => {
    const project = { id: "project-1", directory: "/repo", canonical: "/repo" }
    const { service } = makeService({ defaultProject: project })
    const planning = await service.createSpace({
      name: "Plan",
      kind: "planning",
      linkCurrentProject: true,
    })
    expect(planning.project).toEqual(project)

    const global = await service.createSpace({ name: "Global" })
    await service.create({ spaceID: planning.id, title: "Plan note" })
    await service.create({ spaceID: global.id, title: "Global note" })

    const all = await service.list({ projectID: project.id })
    expect(all.total).toBe(2)
    const linkedOnly = await service.list({
      projectID: project.id,
      includeGlobal: false,
    })
    expect(linkedOnly.notes.map((note) => note.title)).toEqual(["Plan note"])

    const spaces = await service.spaces({ projectID: project.id })
    expect(spaces.spaces.map((space) => space.name).toSorted()).toEqual([
      "Global",
      "Plan",
    ])
    const linkedSpaces = await service.spaces({
      projectID: project.id,
      includeGlobal: false,
    })
    expect(linkedSpaces.spaces.map((space) => space.name)).toEqual(["Plan"])
  })

  test("unlinks and relinks a space through updates", async () => {
    const project = { id: "project-1", directory: "/repo", canonical: "/repo" }
    const { service } = makeService({ defaultProject: project })
    const space = await service.createSpace({
      name: "Plan",
      kind: "planning",
      project: { id: "other", directory: "/other", canonical: "/other" },
    })
    expect(space.project?.id).toBe("other")

    const unlinked = await service.updateSpace({
      spaceID: space.id,
      project: null,
    })
    expect(unlinked.project).toBeNull()

    const relinked = await service.updateSpace({
      spaceID: space.id,
      linkCurrentProject: true,
    })
    expect(relinked.project).toEqual(project)
  })

  test("updates note fields, moves it between spaces, and preserves createdAt", async () => {
    const { service } = makeService()
    const first = await service.createSpace({ name: "First" })
    const second = await service.createSpace({ name: "Second" })
    const note = await service.create({
      spaceID: first.id,
      title: "Draft",
      body: "old",
    })

    const updated = await service.update({
      noteID: note.id,
      spaceID: second.id,
      title: "  Final  ",
      body: "new",
      status: "in-progress",
      pinned: true,
    })
    expect(updated.spaceID).toBe(second.id)
    expect(updated.title).toBe("Final")
    expect(updated.body).toBe("new")
    expect(updated.status).toBe("in-progress")
    expect(updated.pinned).toBe(true)
    expect(updated.createdAt).toBe(note.createdAt)
    expect(updated.updatedAt).toBeGreaterThan(note.updatedAt)
    expect(updated.revision).toBe(note.revision + 1)

    const unchanged = await service.update({ noteID: note.id })
    expect(unchanged).toEqual(updated)
  })

  test("deletes notes idempotently and refuses non-empty spaces even with cascade", async () => {
    const { service, events } = makeService()
    const space = await service.createSpace({ name: "Space" })
    const note = await service.create({ spaceID: space.id, title: "Keep" })

    expect(await service.delete({ noteID: note.id })).toEqual({ deleted: true })
    expect(await service.delete({ noteID: note.id })).toEqual({
      deleted: false,
    })

    const second = await service.create({ spaceID: space.id, title: "Again" })
    await expect(
      service.deleteSpace({ spaceID: space.id })
    ).rejects.toMatchObject({
      type: "space_not_empty",
      data: { spaceID: space.id, noteCount: 1 },
    })
    await expect(
      service.deleteSpace({ spaceID: space.id, cascade: true })
    ).rejects.toMatchObject({
      type: "space_not_empty",
      data: { spaceID: space.id, noteCount: 1 },
    })
    expect((await service.list()).notes.map((item) => item.id)).toEqual([
      second.id,
    ])
    expect((await service.spaces()).spaces.map((item) => item.id)).toEqual([
      space.id,
    ])

    await service.delete({ noteID: second.id })
    const deleted = await service.deleteSpace({ spaceID: space.id })
    expect(deleted).toEqual({ deleted: true, deletedNotes: 0 })
    expect((await service.list()).total).toBe(0)
    expect(events).toContainEqual({
      entity: "note",
      action: "deleted",
      id: second.id,
    })
    expect(events).toContainEqual({
      entity: "space",
      action: "deleted",
      id: space.id,
    })
  })

  test("filters and paginates notes", async () => {
    const { service } = makeService()
    const alpha = await service.createSpace({ name: "Alpha" })
    const beta = await service.createSpace({ name: "Beta" })
    await service.create({
      spaceID: alpha.id,
      title: "One",
      body: "alpha body",
    })
    const two = await service.create({
      spaceID: alpha.id,
      title: "Two",
      body: "needle",
      status: "finished",
      pinned: true,
    })
    await service.create({
      spaceID: beta.id,
      title: "Three",
      body: "alpha body",
    })

    expect((await service.list({ spaceID: beta.id })).total).toBe(1)
    expect((await service.list({ status: "finished" })).notes[0]?.id).toBe(
      two.id
    )
    expect((await service.list({ pinned: true })).notes[0]?.id).toBe(two.id)
    expect((await service.list({ query: "NEEDLE" })).notes[0]?.id).toBe(two.id)
    expect((await service.list({ query: "alpha body" })).total).toBe(2)

    const page = await service.list({ limit: 1, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.notes).toHaveLength(1)
  })

  test("sorts pinned spaces first and notes by pin then recency", async () => {
    const { service } = makeService()
    const zeta = await service.createSpace({ name: "Zeta", pinned: true })
    const alpha = await service.createSpace({ name: "Alpha" })
    expect((await service.spaces()).spaces.map((space) => space.name)).toEqual([
      "Zeta",
      "Alpha",
    ])

    const first = await service.create({ spaceID: alpha.id, title: "First" })
    await service.create({ spaceID: zeta.id, title: "Second" })
    expect((await service.list()).notes.map((note) => note.title)).toEqual([
      "Second",
      "First",
    ])
    const pinned = await service.update({ noteID: first.id, pinned: true })
    expect((await service.list()).notes[0]?.id).toBe(pinned.id)
  })

  test("assigns unique monotonic revisions even when timestamps collide", async () => {
    const { service } = makeService({ now: () => 1_000 })
    const note = await service.create({ title: "First" })
    expect(note.revision).toBe(1)
    const second = await service.update({ noteID: note.id, title: "Second" })
    const third = await service.update({ noteID: note.id, body: "Body" })
    expect(second.revision).toBe(2)
    expect(third.revision).toBe(3)
    expect(second.updatedAt).toBe(note.updatedAt)
    expect(third.updatedAt).toBe(note.updatedAt)
    expect(new Set([note.revision, second.revision, third.revision]).size).toBe(
      3
    )
  })

  test("serializes concurrent expectedRevision checks inside the mutation queue", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Note" })
    const results = await Promise.allSettled([
      service.update({
        noteID: note.id,
        title: "First",
        expectedRevision: note.revision,
      }),
      service.update({
        noteID: note.id,
        title: "Second",
        expectedRevision: note.revision,
      }),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected).toBeDefined()
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      type: "conflict",
    })
    expect((await service.list()).notes[0]?.revision).toBe(2)
  })

  test("treats legacy records without revision as revision 0, then increments", async () => {
    const { service, storage } = makeService()
    await storage.set(`${NOTE_PREFIX}legacy`, {
      id: "legacy",
      spaceID: null,
      title: "Legacy",
      body: "",
      status: "todo",
      pinned: false,
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    const legacy = await service.list()
    expect(legacy.notes[0]?.revision).toBe(0)
    const updated = await service.update({ noteID: "legacy", title: "Updated" })
    expect(updated.revision).toBe(1)
  })

  test("checks expectedRevision before note update and delete mutations", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Note" })
    const updated = await service.update({
      noteID: note.id,
      title: "Changed",
      expectedRevision: note.revision,
    })
    expect(updated.revision).toBe(2)

    await expect(
      service.update({
        noteID: note.id,
        title: "Stale",
        expectedRevision: note.revision,
      })
    ).rejects.toMatchObject({
      type: "conflict",
      data: {
        entity: "note",
        id: note.id,
        expectedRevision: note.revision,
        revision: updated.revision,
      },
    })
    expect((await service.list()).notes[0]?.title).toBe("Changed")

    await expect(
      service.delete({ noteID: note.id, expectedRevision: note.revision })
    ).rejects.toMatchObject({ type: "conflict" })
    expect((await service.list()).total).toBe(1)

    expect(
      await service.delete({
        noteID: note.id,
        expectedRevision: updated.revision,
      })
    ).toEqual({ deleted: true })
  })

  test("checks expectedRevision before space update and cascade refusal", async () => {
    const { service } = makeService()
    const space = await service.createSpace({ name: "Space" })
    const note = await service.create({ spaceID: space.id, title: "Note" })
    const updated = await service.updateSpace({
      spaceID: space.id,
      name: "Renamed",
      expectedRevision: space.revision,
    })
    expect(updated.revision).toBe(2)

    await expect(
      service.updateSpace({
        spaceID: space.id,
        name: "Stale",
        expectedRevision: space.revision,
      })
    ).rejects.toMatchObject({
      type: "conflict",
      data: {
        entity: "space",
        id: space.id,
        expectedRevision: space.revision,
        revision: updated.revision,
      },
    })
    await expect(
      service.deleteSpace({
        spaceID: space.id,
        cascade: true,
        expectedRevision: space.revision,
      })
    ).rejects.toMatchObject({ type: "conflict" })
    expect((await service.list()).notes[0]?.id).toBe(note.id)
    expect((await service.spaces()).spaces[0]?.name).toBe("Renamed")

    await expect(
      service.deleteSpace({
        spaceID: space.id,
        cascade: true,
        expectedRevision: updated.revision,
      })
    ).rejects.toMatchObject({
      type: "space_not_empty",
      data: { spaceID: space.id, noteCount: 1 },
    })
    expect((await service.list()).notes[0]?.id).toBe(note.id)
    expect((await service.spaces()).spaces[0]?.id).toBe(space.id)
  })

  test("validates inputs and reports typed errors", async () => {
    const { service } = makeService()
    await expect(service.createSpace({ name: "   " })).rejects.toMatchObject({
      type: "invalid",
      data: { field: "name" },
    })
    await expect(
      service.create({ spaceID: "missing", title: "Note" })
    ).rejects.toMatchObject({
      type: "space_not_found",
      data: { spaceID: "missing" },
    })
    const space = await service.createSpace({ name: "Space" })
    await expect(
      service.update({ noteID: "missing", title: "Note" })
    ).rejects.toMatchObject({
      type: "note_not_found",
      data: { noteID: "missing" },
    })
    await expect(
      service.createSpace({
        name: "Plan",
        project: { id: "p" },
        linkCurrentProject: true,
      })
    ).rejects.toMatchObject({
      type: "invalid",
      data: { field: "linkCurrentProject" },
    })
    await expect(
      service.create({
        spaceID: space.id,
        title: "Note",
        status: "done" as never,
      })
    ).rejects.toMatchObject({
      type: "invalid",
      data: { field: "status" },
    })
    await expect(service.list({ limit: 0 })).rejects.toMatchObject({
      type: "invalid",
      data: { field: "limit" },
    })
    await expect(
      service.update({ noteID: "missing", expectedRevision: -1 })
    ).rejects.toMatchObject({
      type: "invalid",
      data: { field: "expectedRevision" },
    })
  })

  test("emits change events after committed writes", async () => {
    const { service, events } = makeService()
    const space = await service.createSpace({ name: "Space" })
    const note = await service.create({ spaceID: space.id, title: "Note" })
    await service.update({ noteID: note.id, status: "finished" })
    await service.delete({ noteID: note.id })

    expect(events).toEqual([
      { entity: "space", action: "created", id: space.id },
      { entity: "note", action: "created", id: note.id },
      { entity: "note", action: "updated", id: note.id },
      { entity: "note", action: "deleted", id: note.id },
    ])
  })
})
