import { describe, expect, test } from "bun:test"
import {
  MemoryNotesStore,
  compareNotes,
  parseAttachment,
  parseNote,
  parseSpace,
  type Note,
  type Space,
} from "../src/index.js"
import { seededClock, seededIDs } from "./helpers.js"

function makeStore() {
  return new MemoryNotesStore({ now: seededClock(), createID: seededIDs() })
}

describe("NotesStore parsers", () => {
  test("parses v2 spaces and converts legacy kind/project records", () => {
    expect(
      parseSpace({
        id: "s",
        name: "n",
        projectDir: "/repo",
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toEqual({
      id: "s",
      name: "n",
      projectDir: "/repo",
      pinned: false,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    expect(
      parseSpace({
        id: "g",
        name: "Global",
        kind: "global",
        project: { id: "p", directory: "/repo", canonical: "/repo" },
        pinned: false,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toMatchObject({ projectDir: null })

    expect(
      parseSpace({
        id: "p",
        name: "Plan",
        kind: "planning",
        project: { id: "p", directory: "/repo-link", canonical: "/repo" },
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toMatchObject({ projectDir: "/repo" })

    expect(
      parseSpace({
        id: "p2",
        name: "Plan",
        kind: "planning",
        project: { id: "p", directory: "/only-directory", canonical: null },
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toMatchObject({ projectDir: "/only-directory" })

    expect(
      parseSpace({
        id: "p3",
        name: "Plan",
        kind: "planning",
        project: null,
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toMatchObject({ projectDir: null })

    expect(parseSpace({ id: "s" })).toBeUndefined()
    expect(
      parseSpace({
        id: "s",
        name: "n",
        projectDir: 4,
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined()
    expect(
      parseSpace({
        id: "s",
        name: "n",
        projectDir: null,
        pinned: false,
        revision: 1.5,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined()
    expect(
      parseSpace({
        id: "s",
        name: "n",
        kind: "unknown",
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toMatchObject({ projectDir: null })
  })

  test("parses notes, legacy revisions, status variants, and attachments", () => {
    expect(parseNote({ id: "n" })).toBeUndefined()
    expect(
      parseNote({
        id: "n",
        spaceID: null,
        title: "t",
        body: "",
        status: "todo",
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toEqual({
      id: "n",
      spaceID: null,
      title: "t",
      body: "",
      status: "todo",
      pinned: false,
      attachments: [],
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(
      parseNote({
        id: "n",
        spaceID: null,
        title: "t",
        body: "",
        status: "archived",
        pinned: false,
        revision: 3,
        statusUpdatedAt: 9,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toMatchObject({ status: "archived", revision: 3, statusUpdatedAt: 9 })
    expect(
      parseNote({
        id: "n",
        spaceID: null,
        title: "t",
        body: "",
        status: "todo",
        pinned: false,
        revision: -1,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined()

    const note = parseNote({
      id: "note",
      spaceID: null,
      title: "Note",
      body: "",
      status: "todo",
      pinned: false,
      attachments: [
        {
          id: "attachment_1",
          name: "photo.png",
          mime: "image/png",
          size: 12,
          createdAt: 5,
        },
        { id: "", name: "bad.png", mime: "image/png", size: 1, createdAt: 1 },
        {
          id: "attachment_2",
          name: "bad.png",
          mime: "image/png",
          size: -1,
          createdAt: 1,
        },
        { id: "attachment_3", name: "bad.png", mime: 4, size: 1, createdAt: 1 },
        "nope",
      ],
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(note?.attachments).toEqual([
      {
        id: "attachment_1",
        name: "photo.png",
        mime: "image/png",
        size: 12,
        createdAt: 5,
      },
    ])
    expect(parseAttachment({ id: "a" })).toBeUndefined()
  })
})

describe("MemoryNotesStore", () => {
  test("round-trips spaces, notes, and attachment bytes", async () => {
    const store = makeStore()
    const now = store.now()
    const space: Space = {
      id: "space_1",
      name: "Space",
      projectDir: null,
      pinned: false,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    const note: Note = {
      id: "note_1",
      spaceID: space.id,
      title: "Note",
      body: "",
      status: "todo",
      pinned: false,
      attachments: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    await store.putSpace(space)
    await store.putNote(note)
    expect(await store.getSpace(space.id)).toEqual(space)
    expect(await store.getNote(note.id)).toEqual(note)
    expect(await store.listSpaces()).toEqual([space])
    expect(await store.listNotes()).toEqual([note])

    const bytes = new Uint8Array([1, 2, 3])
    await store.putAttachment("attachment_1", bytes)
    expect(await store.getAttachment("attachment_1")).toEqual(bytes)
    await store.removeAttachment("attachment_1")
    expect(await store.getAttachment("attachment_1")).toBeUndefined()

    await store.removeNote(note.id)
    await store.removeSpace(space.id)
    expect(await store.listNotes()).toEqual([])
    expect(await store.listSpaces()).toEqual([])
  })

  test("returns defensive copies", async () => {
    const store = makeStore()
    const now = store.now()
    const note: Note = {
      id: "note_1",
      spaceID: null,
      title: "Note",
      body: "body",
      status: "todo",
      pinned: false,
      attachments: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    await store.putNote(note)
    const read = await store.getNote(note.id)
    if (read) (read as { title: string }).title = "mutated"
    expect((await store.getNote(note.id))?.title).toBe("Note")
  })

  test("sorts notes pinned-first, then by recency, then by ID", () => {
    const base = {
      spaceID: null,
      body: "",
      status: "todo" as const,
      attachments: [],
      revision: 1,
      createdAt: 1,
    }
    const oldPinned = {
      ...base,
      id: "b",
      title: "b",
      pinned: true,
      updatedAt: 1,
    }
    const newer = {
      ...base,
      id: "a",
      title: "a",
      pinned: false,
      updatedAt: 3,
    }
    const older = {
      ...base,
      id: "c",
      title: "c",
      pinned: false,
      updatedAt: 2,
    }
    expect([newer, older, oldPinned].toSorted(compareNotes)).toEqual([
      oldPinned,
      newer,
      older,
    ])
  })

  test("caps snapshots at 50 and lists newest first", async () => {
    const store = makeStore()
    const makeSnapshot = (revision: number, savedAt: number) => ({
      savedAt,
      note: {
        id: "note_1",
        spaceID: null,
        title: `rev ${revision}`,
        body: "",
        status: "todo" as const,
        pinned: false,
        attachments: [],
        revision,
        createdAt: 1,
        updatedAt: savedAt,
      },
    })
    for (let revision = 0; revision < 60; revision++) {
      await store.putSnapshot(makeSnapshot(revision, 1_000 + revision))
    }
    const snapshots = await store.listSnapshots("note_1")
    expect(snapshots).toHaveLength(50)
    expect(snapshots[0]?.note.revision).toBe(59)
    expect(snapshots.at(-1)?.note.revision).toBe(10)
  })
})
