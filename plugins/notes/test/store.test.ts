import { describe, expect, test } from "bun:test"
import { NotesStore, parseNote, parseSpace } from "../src/store.js"
import { ATTACHMENT_PREFIX, NOTE_PREFIX, SPACE_PREFIX } from "../src/types.js"
import { MemoryStorage, seededClock, seededIDs } from "./helpers.js"

function makeStore() {
  const storage = new MemoryStorage()
  const store = new NotesStore(storage, {
    now: seededClock(),
    createID: seededIDs(),
  })
  return { storage, store }
}

describe("NotesStore", () => {
  test("uses namespaced keys and round-trips spaces and notes", async () => {
    const { storage, store } = makeStore()
    const now = store.now()
    const space = {
      id: "space_1",
      name: "Space",
      kind: "global" as const,
      project: null,
      pinned: false,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    const note = {
      id: "note_1",
      spaceID: space.id,
      title: "Note",
      body: "",
      status: "todo" as const,
      pinned: false,
      attachments: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    await store.putSpace(space)
    await store.putNote(note)
    expect(storage.values.has(`${SPACE_PREFIX}${space.id}`)).toBe(true)
    expect(storage.values.has(`${NOTE_PREFIX}${note.id}`)).toBe(true)
    expect(await store.getSpace(space.id)).toEqual(space)
    expect(await store.getNote(note.id)).toEqual(note)
    expect(await store.listSpaces()).toEqual([space])
    expect(await store.listNotes()).toEqual([note])
  })

  test("paginates scans and filters corrupt entries", async () => {
    const { storage, store } = makeStore()
    const now = store.now()
    for (let index = 0; index < 5; index++) {
      await store.putNote({
        id: `note_${index}`,
        spaceID: "space_1",
        title: `Note ${index}`,
        body: "",
        status: "todo",
        pinned: false,
        attachments: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
    }
    await storage.set(`${NOTE_PREFIX}broken`, { id: "broken" })
    const notes = await store.listNotes()
    expect(notes).toHaveLength(5)
    expect(notes.map((note) => note.id).toSorted()).toEqual([
      "note_0",
      "note_1",
      "note_2",
      "note_3",
      "note_4",
    ])
  })

  test("parsers reject malformed records", () => {
    expect(parseSpace({ id: "s" })).toBeUndefined()
    expect(
      parseSpace({
        id: "s",
        name: "n",
        kind: "global",
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toEqual({
      id: "s",
      name: "n",
      kind: "global",
      project: null,
      pinned: false,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    })
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
        status: "todo",
        pinned: false,
        revision: -1,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined()
    expect(
      parseSpace({
        id: "s",
        name: "n",
        kind: "global",
        pinned: false,
        revision: 1.5,
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined()
  })

  test("decodes legacy notes without attachments as an empty list", () => {
    const note = parseNote({
      id: "legacy",
      spaceID: null,
      title: "Legacy",
      body: "",
      status: "todo",
      pinned: false,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(note?.attachments).toEqual([])
  })

  test("keeps well-formed attachment metadata and drops malformed entries", () => {
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
        { id: "attachment_2", name: "bad.png", mime: "image/png", size: -1, createdAt: 1 },
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
  })

  test("stores attachment bytes under id-only keys", async () => {
    const { storage, store } = makeStore()
    await store.putAttachment("attachment_1", "aGVsbG8=")
    expect(storage.values.has(`${ATTACHMENT_PREFIX}attachment_1`)).toBe(true)
    expect(storage.values.get(`${ATTACHMENT_PREFIX}attachment_1`)).toEqual({
      data: "aGVsbG8=",
    })
    expect(await store.getAttachment("attachment_1")).toBe("aGVsbG8=")
    await store.removeAttachment("attachment_1")
    expect(await store.getAttachment("attachment_1")).toBeUndefined()
  })

  test("ignores malformed stored attachment values", async () => {
    const { storage, store } = makeStore()
    await storage.set(`${ATTACHMENT_PREFIX}raw`, "aGVsbG8=")
    await storage.set(`${ATTACHMENT_PREFIX}wrong`, { data: 4 })
    expect(await store.getAttachment("raw")).toBeUndefined()
    expect(await store.getAttachment("wrong")).toBeUndefined()
  })
})
