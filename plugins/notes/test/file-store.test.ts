import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FileNotesStore,
  NotesError,
  createNotesService,
  type Note,
} from "../src/index.js"

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "opencode-notes-fs-"))
}

function clock(start = 1_000): () => number {
  let current = start
  return () => current++
}

function ids(): (prefix: string) => string {
  let current = 0
  return (prefix) => `${prefix}_${++current}`
}

describe("FileNotesStore", () => {
  test("writes records atomically with restricted modes and no temp leftovers", async () => {
    const dataDir = await tempDir()
    const store = new FileNotesStore({
      dataDir,
      now: clock(),
      createID: ids(),
    })
    const service = createNotesService({ store, migrate: false })
    const space = await service.createSpace({ name: "Space" })
    const note = await service.create({
      spaceID: space.id,
      title: "Note",
      body: "Body",
    })

    const notePath = join(dataDir, "notes", `${note.id}.json`)
    expect(JSON.parse(await readFile(notePath, "utf8"))).toMatchObject({
      id: note.id,
      title: "Note",
    })
    expect((await stat(notePath)).mode & 0o777).toBe(0o600)
    expect((await stat(join(dataDir, "notes"))).mode & 0o777).toBe(0o700)

    for (let index = 0; index < 20; index++) {
      await service.update({ noteID: note.id, body: `body ${index}` })
    }
    const entries = await readdir(join(dataDir, "notes"))
    expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false)
    expect(entries.filter((name) => name.endsWith(".json"))).toHaveLength(1)
    expect(JSON.parse(await readFile(notePath, "utf8"))).toMatchObject({
      body: "body 19",
      revision: 21,
    })
  })

  test("serializes two writers and surfaces revision_conflict without lost updates", async () => {
    const dataDir = await tempDir()
    const serviceA = createNotesService({
      store: new FileNotesStore({ dataDir, now: clock(1_000), createID: ids() }),
      migrate: false,
    })
    const serviceB = createNotesService({
      store: new FileNotesStore({ dataDir, now: clock(2_000), createID: ids() }),
      migrate: false,
    })
    const note = await serviceA.create({ title: "Shared" })

    const results = await Promise.allSettled([
      serviceA.update({
        noteID: note.id,
        title: "From A",
        expectedRevision: note.revision,
      }),
      serviceB.update({
        noteID: note.id,
        title: "From B",
        expectedRevision: note.revision,
      }),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      type: "revision_conflict",
    })
    const stored = await serviceA.get({ noteID: note.id })
    expect(stored.revision).toBe(2)
    expect(["From A", "From B"]).toContain(stored.title)
  })

  test("takes over a stale lock and rejects unsafe record IDs", async () => {
    const dataDir = await tempDir()
    const store = new FileNotesStore({ dataDir, now: clock(), createID: ids() })
    const service = createNotesService({ store, migrate: false })
    const note = await service.create({ title: "Note" })

    const lockPath = join(dataDir, "notes", `${note.id}.json.lock`)
    await writeFile(lockPath, "stale")
    const old = new Date(Date.now() - 10_000)
    await utimes(lockPath, old, old)

    const updated = await service.update({ noteID: note.id, title: "Updated" })
    expect(updated.revision).toBe(2)

    const unsafe: Note = {
      ...updated,
      id: "../../escape",
      revision: 1,
    }
    await expect(store.putNote(unsafe)).rejects.toBeInstanceOf(NotesError)
    await expect(service.get({ noteID: "../../escape" })).rejects.toMatchObject({
      type: "note_not_found",
    })
  })

  test("ignores corrupt record files while listing valid ones", async () => {
    const dataDir = await tempDir()
    const store = new FileNotesStore({ dataDir, now: clock(), createID: ids() })
    const service = createNotesService({ store, migrate: false })
    const note = await service.create({ title: "Valid" })

    await writeFile(join(dataDir, "notes", "broken.json"), "{not json")
    await writeFile(join(dataDir, "notes", "partial.json"), JSON.stringify({ id: "x" }))
    await writeFile(join(dataDir, "notes", "ignored.txt"), "not a record")

    const listed = await service.list()
    expect(listed.notes.map((item) => item.id)).toEqual([note.id])
    expect(listed.total).toBe(1)
  })

  test("prunes on-disk history to 50 snapshots per note", async () => {
    const dataDir = await tempDir()
    const store = new FileNotesStore({ dataDir, now: clock(), createID: ids() })
    const service = createNotesService({ store, migrate: false })
    const note = await service.create({ title: "Note" })
    for (let index = 0; index < 60; index++) {
      await service.update({ noteID: note.id, body: `body ${index}` })
    }
    const history = await service.history({ noteID: note.id })
    expect(history.total).toBe(50)
    expect(history.snapshots[0]?.revision).toBe(60)
    const files = (await readdir(join(dataDir, "history", note.id))).filter(
      (name) => name.endsWith(".json")
    )
    expect(files).toHaveLength(50)
  })
})
