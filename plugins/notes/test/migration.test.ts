import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MIGRATION_FILE,
  createNotesService,
  readMigrationMarker,
} from "../src/index.js"

const HEX = Buffer.from("opencode-notes", "utf16le").toString("hex")

interface Fixture {
  readonly dataDir: string
  readonly dbPath: string
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "opencode-notes-migrate-"))
  return {
    dataDir: join(root, "data"),
    dbPath: join(root, "opencode.db"),
  }
}

function key(kind: string, id: string): string {
  return `plugin:${HEX}:opencode-notes/v1/${kind}/${id}`
}

function buildEngineDatabase(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    db.run(
      "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT, time_created INTEGER, time_updated INTEGER)"
    )
    const insert = db.prepare(
      "INSERT INTO kv (key, value, time_created, time_updated) VALUES (?, ?, 1, 1)"
    )
    insert.run(
      key("space", "space_global"),
      JSON.stringify({
        id: "space_global",
        name: "Global",
        kind: "global",
        project: null,
        pinned: false,
        revision: 1,
        createdAt: 10,
        updatedAt: 10,
      })
    )
    insert.run(
      key("space", "space_plan"),
      JSON.stringify({
        id: "space_plan",
        name: "Plan",
        kind: "planning",
        project: {
          id: "project_1",
          directory: "/repo-link",
          canonical: "/repo",
        },
        pinned: true,
        revision: 2,
        createdAt: 11,
        updatedAt: 12,
      })
    )
    insert.run(
      key("space", "space_unlinked"),
      JSON.stringify({
        id: "space_unlinked",
        name: "Unlinked",
        kind: "planning",
        project: null,
        pinned: false,
        createdAt: 13,
        updatedAt: 13,
      })
    )
    insert.run(
      key("note", "note_legacy"),
      JSON.stringify({
        id: "note_legacy",
        spaceID: "space_plan",
        title: "Legacy note",
        body: "legacy body",
        status: "in-progress",
        pinned: false,
        attachments: [
          {
            id: "attachment_legacy",
            name: "hello.txt",
            mime: "text/plain",
            size: 5,
            createdAt: 20,
          },
        ],
        revision: 3,
        createdAt: 14,
        updatedAt: 15,
      })
    )
    insert.run(
      key("attachment", "attachment_legacy"),
      JSON.stringify({ data: btoa("hello") })
    )
    insert.run(key("note", "note_broken"), "{not json")
    // Not plugin-namespaced: must be ignored.
    insert.run(
      "opencode-notes/v1/note/direct",
      JSON.stringify({
        id: "direct",
        spaceID: null,
        title: "Direct",
        body: "",
        status: "todo",
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      })
    )
  } finally {
    db.close()
  }
}

describe("engine kv migration", () => {
  test("imports notes, spaces, and attachment bytes into the v2 store", async () => {
    const { dataDir, dbPath } = await fixture()
    buildEngineDatabase(dbPath)
    const service = createNotesService({ dataDir, engineDbPath: dbPath })
    await service.ready()

    const spaces = await service.spaces()
    expect(spaces.total).toBe(3)
    const byID = new Map(spaces.spaces.map((space) => [space.id, space]))
    expect(byID.get("space_global")?.projectDir).toBeNull()
    expect(byID.get("space_plan")?.projectDir).toBe("/repo")
    expect(byID.get("space_plan")?.pinned).toBe(true)
    expect(byID.get("space_unlinked")?.projectDir).toBeNull()

    const notes = await service.list()
    expect(notes.total).toBe(1)
    expect(notes.notes[0]).toMatchObject({
      id: "note_legacy",
      title: "Legacy note",
      status: "in-progress",
      spaceID: "space_plan",
      revision: 3,
    })
    expect((await service.list()).notes.map((note) => note.id)).not.toContain(
      "direct"
    )

    const attachment = await service.readAttachment({
      noteID: "note_legacy",
      attachmentID: "attachment_legacy",
    })
    expect(attachment.data).toBe(btoa("hello"))
    expect(attachment.attachment).toMatchObject({
      name: "hello.txt",
      mime: "text/plain",
      size: 5,
    })

    const marker = await readMigrationMarker(dataDir)
    expect(marker).toMatchObject({ notes: 1, spaces: 3, attachments: 1 })
    expect(JSON.parse(await readFile(join(dataDir, MIGRATION_FILE), "utf8")))
      .toMatchObject({ notes: 1, spaces: 3, attachments: 1 })
  })

  test("is idempotent and never overwrites records already in the store", async () => {
    const { dataDir, dbPath } = await fixture()
    buildEngineDatabase(dbPath)
    const first = createNotesService({ dataDir, engineDbPath: dbPath })
    await first.ready()
    const updated = await first.update({
      noteID: "note_legacy",
      title: "Edited locally",
    })
    expect(updated.revision).toBe(4)

    const second = createNotesService({ dataDir, engineDbPath: dbPath })
    await second.ready()
    expect((await second.get({ noteID: "note_legacy" })).title).toBe(
      "Edited locally"
    )

    // Remove the marker and rerun: existing IDs must still win.
    await unlink(join(dataDir, MIGRATION_FILE))
    const third = createNotesService({ dataDir, engineDbPath: dbPath })
    await third.ready()
    expect((await third.get({ noteID: "note_legacy" })).title).toBe(
      "Edited locally"
    )
    expect(await readMigrationMarker(dataDir)).toMatchObject({
      notes: 0,
      spaces: 0,
      attachments: 0,
    })
  })

  test("writes a zero marker when the engine database is missing", async () => {
    const { dataDir, dbPath } = await fixture()
    const service = createNotesService({
      dataDir,
      engineDbPath: join(dbPath, "does-not-exist.db"),
    })
    await service.ready()
    expect(await service.list()).toEqual({ notes: [], total: 0 })
    expect(await readMigrationMarker(dataDir)).toMatchObject({
      notes: 0,
      spaces: 0,
      attachments: 0,
    })
  })

  test("skips migration entirely for an injected memory store", async () => {
    const { makeService } = await import("./helpers.js")
    const { service, store } = makeService()
    await service.ready()
    expect(store.dataDir).toBeUndefined()
    expect(await service.list()).toEqual({ notes: [], total: 0 })
  })
})
