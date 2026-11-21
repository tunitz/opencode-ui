import { describe, expect, test } from "bun:test"
import { createNotesService } from "../src/index.js"
import { listResources, spacesInventory } from "../src/mcp/resources.js"
import { MemoryNotesStore } from "../src/store.js"
import type { Scope } from "../src/types.js"
import { base64OfSize, makeService } from "./helpers.js"

const connA: Scope = { connectionId: "conn_a" }
const connB: Scope = { connectionId: "conn_b" }
const noConnection: Scope = { connectionId: null }

const idsOf = (notes: readonly { id: string }[]): string[] =>
  notes.map((note) => note.id).toSorted()

describe("NotesService connection scope", () => {
  test("createSpace stamps the owner; Global and unowned spaces stay null", async () => {
    const { service } = makeService()

    const owned = await service.createSpace(
      { name: "A plan", projectDir: "/repo" },
      connA
    )
    expect(owned.connectionId).toBe("conn_a")

    const global = await service.createSpace({ name: "Ideas" }, connA)
    expect(global.projectDir).toBeNull()
    expect(global.connectionId).toBeNull()

    // A linked space created with no active connection is still created and
    // becomes legacy/pending rather than failing.
    const pending = await service.createSpace(
      { name: "Pending", projectDir: "/repo" },
      noConnection
    )
    expect(pending.connectionId).toBeNull()

    const unscoped = await service.createSpace({
      name: "Library",
      projectDir: "/repo",
    })
    expect(unscoped.connectionId).toBeNull()
  })

  test("a linked space is visible only to its owner even with an identical directory", async () => {
    const { service } = makeService()
    const a = await service.createSpace(
      { name: "A plan", projectDir: "/shared" },
      connA
    )
    const b = await service.createSpace(
      { name: "B plan", projectDir: "/shared" },
      connB
    )
    const noteA = await service.create({ spaceID: a.id, title: "A note" }, connA)
    const noteB = await service.create({ spaceID: b.id, title: "B note" }, connB)

    expect(
      (await service.spaces({ directory: "/shared" }, connA)).spaces.map(
        (space) => space.id
      )
    ).toEqual([a.id])
    expect(
      (await service.spaces({ directory: "/shared" }, connB)).spaces.map(
        (space) => space.id
      )
    ).toEqual([b.id])
    expect(
      idsOf((await service.list({ directory: "/shared" }, connA)).notes)
    ).toEqual([noteA.id])
    expect(
      idsOf((await service.list({ directory: "/shared" }, connB)).notes)
    ).toEqual([noteB.id])

    // An unscoped library caller still sees both.
    expect((await service.spaces({ directory: "/shared" })).spaces).toHaveLength(
      2
    )
  })

  test("Global spaces and unassigned notes stay shared across connections", async () => {
    const { service } = makeService()
    const global = await service.createSpace({ name: "Ideas" }, connA)
    const globalNote = await service.create(
      { spaceID: global.id, title: "Shared" },
      connA
    )
    const inbox = await service.create({ title: "Inbox" }, connA)

    const a = await service.list({ directory: "/repo" }, connA)
    const b = await service.list({ directory: "/repo" }, connB)
    expect(idsOf(a.notes)).toEqual(idsOf(b.notes))
    expect(idsOf(a.notes)).toEqual([globalNote.id, inbox.id].toSorted())
    expect(
      (await service.spaces({ directory: "/repo" }, connB)).spaces.map(
        (space) => space.id
      )
    ).toEqual([global.id])
  })

  test("a legacy linked space is hidden by default and returned with includeLegacy", async () => {
    const { service } = makeService()
    const legacy = await service.createSpace(
      { name: "Legacy", projectDir: "/repo" },
      noConnection
    )
    // Simulate preserved legacy data: the note was written before scoping.
    const note = await service.create({
      spaceID: legacy.id,
      title: "Legacy note",
    })

    expect((await service.spaces({ directory: "/repo" }, connA)).spaces).toEqual(
      []
    )
    expect(
      idsOf((await service.list({ directory: "/repo" }, connA)).notes)
    ).toEqual([])
    expect(
      (
        await service.spaces(
          { directory: "/repo", includeLegacy: true },
          connA
        )
      ).spaces.map((space) => space.id)
    ).toEqual([legacy.id])
    // includeLegacy still respects the directory filter.
    expect(
      (await service.spaces({ directory: "/other", includeLegacy: true }, connA))
        .spaces
    ).toEqual([])

    // Unscoped callers still see legacy records.
    expect(
      (await service.spaces({ directory: "/repo" })).spaces.map(
        (space) => space.id
      )
    ).toEqual([legacy.id])
    expect(idsOf((await service.list({ directory: "/repo" })).notes)).toEqual([
      note.id,
    ])
  })

  test("direct note and attachment access rejects another connection's note", async () => {
    const { service } = makeService()
    const a = await service.createSpace(
      { name: "A", projectDir: "/repo" },
      connA
    )
    const note = await service.create({ spaceID: a.id, title: "Secret" }, connA)
    const { attachment } = await service.createAttachment(
      {
        noteID: note.id,
        name: "a.txt",
        mime: "text/plain",
        data: base64OfSize(2),
      },
      connA
    )

    const foreignCalls = [
      () => service.get({ noteID: note.id }, connB),
      () => service.update({ noteID: note.id, title: "Changed" }, connB),
      () => service.delete({ noteID: note.id }, connB),
      () =>
        service.createAttachment(
          {
            noteID: note.id,
            name: "b.txt",
            mime: "text/plain",
            data: base64OfSize(2),
          },
          connB
        ),
      () =>
        service.readAttachment(
          { noteID: note.id, attachmentID: attachment.id },
          connB
        ),
      () =>
        service.deleteAttachment(
          { noteID: note.id, attachmentID: attachment.id },
          connB
        ),
      () => service.history({ noteID: note.id }, connB),
      () => service.restore({ noteID: note.id, revision: 1 }, connB),
    ]
    for (const call of foreignCalls) {
      await expect(call()).rejects.toMatchObject({ type: "note_not_found" })
    }
    expect((await service.get({ noteID: note.id }, connA)).id).toBe(note.id)
  })

  test("an explicit connectionId adopts a legacy space across scopes", async () => {
    const { service } = makeService()
    const legacy = await service.createSpace(
      { name: "Legacy", projectDir: "/repo" },
      noConnection
    )
    expect((await service.spaces({ directory: "/repo" }, connA)).spaces).toEqual(
      []
    )

    // An explicit assignment bypasses the ordinary scope guard.
    const adopted = await service.updateSpace(
      { spaceID: legacy.id, connectionId: "conn_a" },
      connB
    )
    expect(adopted.connectionId).toBe("conn_a")
    expect(
      (await service.spaces({ directory: "/repo" }, connA)).spaces.map(
        (space) => space.id
      )
    ).toEqual([legacy.id])
    expect((await service.spaces({ directory: "/repo" }, connB)).spaces).toEqual(
      []
    )

    // Turning it Global clears the owner and makes it shared again.
    const global = await service.updateSpace(
      { spaceID: legacy.id, projectDir: null },
      connA
    )
    expect(global.connectionId).toBeNull()
    expect(
      (await service.spaces({ directory: "/repo" }, connB)).spaces.map(
        (space) => space.id
      )
    ).toEqual([legacy.id])
  })

  test("MCP resources and the spaces inventory respect the service scope", async () => {
    const { service } = makeService()
    const a = await service.createSpace(
      { name: "A plan", projectDir: "/repo" },
      connA
    )
    const b = await service.createSpace(
      { name: "B plan", projectDir: "/repo" },
      connB
    )
    await service.create({ spaceID: a.id, title: "A note" }, connA)
    await service.create({ spaceID: b.id, title: "B note" }, connB)

    const resources = await listResources(service, connA)
    expect(resources.some((resource) => resource.name === "A note")).toBe(true)
    expect(resources.some((resource) => resource.name === "B note")).toBe(false)

    const [listedSpaces, listedNotes] = await Promise.all([
      service.spaces({}, connA),
      service.list({}, connA),
    ])
    const inventory = spacesInventory(listedSpaces.spaces, listedNotes.notes)
    expect(inventory).toContain("A plan")
    expect(inventory).not.toContain("B plan")
  })

  test("a service-level scope is the default when a call omits one", async () => {
    const store = new MemoryNotesStore()
    const service = createNotesService({ store, migrate: false, scope: connA })
    const a = await service.createSpace({ name: "A", projectDir: "/repo" })
    expect(a.connectionId).toBe("conn_a")
    expect(
      (await service.spaces({ directory: "/repo" })).spaces.map(
        (space) => space.id
      )
    ).toEqual([a.id])
    // A per-call scope overrides the service default.
    expect((await service.spaces({ directory: "/repo" }, connB)).spaces).toEqual(
      []
    )
  })
})
