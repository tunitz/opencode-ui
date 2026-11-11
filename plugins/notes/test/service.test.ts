import { describe, expect, test } from "bun:test"
import {
  LIMITS,
  NOTE_STATUSES,
  STATUS_CATEGORIES,
  statusCategory,
  type Note,
} from "../src/index.js"
import { base64OfSize, makeService } from "./helpers.js"

describe("NotesService", () => {
  test("exposes the seven statuses and their categories", () => {
    expect(NOTE_STATUSES).toEqual([
      "idea",
      "todo",
      "in-progress",
      "blocked",
      "finished",
      "cancelled",
      "archived",
    ])
    expect(STATUS_CATEGORIES).toEqual({
      backlog: ["idea", "todo"],
      active: ["in-progress", "blocked"],
      done: ["finished", "cancelled", "archived"],
    })
    expect(statusCategory("idea")).toBe("backlog")
    expect(statusCategory("blocked")).toBe("active")
    expect(statusCategory("archived")).toBe("done")
  })

  test("creates a Global space and a todo note", async () => {
    const { service } = makeService()
    const space = await service.createSpace({ name: "Global" })
    expect(space.projectDir).toBeNull()
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
    expect(note.statusUpdatedAt).toBe(note.createdAt)

    const listed = await service.list()
    expect(listed.total).toBe(1)
    expect(listed.notes[0]).toEqual(note)
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

  test("scopes notes and spaces by projectDir, Global visibility, and unassigned notes", async () => {
    const { service } = makeService()
    const global = await service.createSpace({ name: "Global" })
    const project = await service.createSpace({
      name: "Plan",
      projectDir: "/repo",
    })
    const other = await service.createSpace({
      name: "Other",
      projectDir: "/other",
    })
    const globalNote = await service.create({
      spaceID: global.id,
      title: "Global note",
    })
    const projectNote = await service.create({
      spaceID: project.id,
      title: "Project note",
    })
    const otherNote = await service.create({
      spaceID: other.id,
      title: "Other note",
    })
    const unassigned = await service.create({ title: "Inbox" })

    expect(
      (await service.list({ directory: "/repo" })).notes.map((note) => note.id)
        .toSorted()
    ).toEqual(
      [globalNote.id, projectNote.id, unassigned.id].toSorted()
    )
    expect(
      (await service.list({ directory: "/repo", includeGlobal: false })).notes
        .map((note) => note.id)
        .toSorted()
    ).toEqual([projectNote.id, unassigned.id].toSorted())
    expect(
      (await service.list({ directory: "/other" })).notes.map((note) => note.id)
        .toSorted()
    ).toEqual([globalNote.id, otherNote.id, unassigned.id].toSorted())

    expect(
      (await service.spaces({ directory: "/repo" })).spaces.map(
        (space) => space.name
      )
    ).toEqual(["Global", "Plan"])
    expect(
      (
        await service.spaces({ directory: "/repo", includeGlobal: false })
      ).spaces.map((space) => space.name)
    ).toEqual(["Plan"])
  })

  test("updates space scope between Global and project", async () => {
    const { service } = makeService()
    const space = await service.createSpace({
      name: "Plan",
      projectDir: "/repo",
    })
    expect(space.projectDir).toBe("/repo")

    const global = await service.updateSpace({
      spaceID: space.id,
      projectDir: null,
    })
    expect(global.projectDir).toBeNull()
    expect(global.revision).toBe(2)

    const relinked = await service.updateSpace({
      spaceID: space.id,
      projectDir: "/repo",
    })
    expect(relinked.projectDir).toBe("/repo")
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
      status: "blocked",
      pinned: true,
    })
    expect(updated.spaceID).toBe(second.id)
    expect(updated.title).toBe("Final")
    expect(updated.body).toBe("new")
    expect(updated.status).toBe("blocked")
    expect(updated.pinned).toBe(true)
    expect(updated.createdAt).toBe(note.createdAt)
    expect(updated.updatedAt).toBeGreaterThan(note.updatedAt)
    expect(updated.revision).toBe(note.revision + 1)
    expect(updated.statusUpdatedAt).toBe(updated.updatedAt)

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

    await service.delete({ noteID: second.id })
    const deleted = await service.deleteSpace({ spaceID: space.id })
    expect(deleted).toEqual({ deleted: true, deletedNotes: 0 })
    expect(await service.spaces()).toEqual({ spaces: [], total: 0 })
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
      status: "blocked",
    })

    expect((await service.list({ spaceID: beta.id })).total).toBe(1)
    expect((await service.list({ status: "finished" })).notes[0]?.id).toBe(
      two.id
    )
    expect(
      (await service.list({ statuses: ["finished", "blocked"] })).total
    ).toBe(2)
    expect((await service.list({ statuses: [] })).total).toBe(0)
    expect((await service.list({ pinned: true })).notes[0]?.id).toBe(two.id)
    expect((await service.list({ query: "NEEDLE" })).notes[0]?.id).toBe(two.id)
    expect((await service.list({ query: "alpha body" })).total).toBe(2)

    const page = await service.list({ limit: 1, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.notes).toHaveLength(1)
  })

  test("reads one note by ID and rejects unknown IDs", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Note", body: "Body" })
    expect(await service.get({ noteID: note.id })).toEqual(note)

    await expect(service.get({ noteID: "missing" })).rejects.toMatchObject({
      type: "note_not_found",
      data: { noteID: "missing" },
    })
    await expect(service.get({ noteID: "   " })).rejects.toMatchObject({
      type: "invalid",
      data: { field: "noteID" },
    })
  })

  test("omits list bodies on request without changing filtering or totals", async () => {
    const { service } = makeService()
    const alpha = await service.createSpace({ name: "Alpha" })
    const beta = await service.createSpace({ name: "Beta" })
    const first = await service.create({
      spaceID: alpha.id,
      title: "First",
      body: "needle body",
    })
    const second = await service.create({
      spaceID: beta.id,
      title: "Second",
      body: "other body",
      status: "finished",
      pinned: true,
    })
    const attached = await service.create({
      title: "Attached",
      body: "attachment body",
    })
    const created = await service.createAttachment({
      noteID: attached.id,
      name: "note.txt",
      mime: "text/plain",
      data: btoa("text"),
    })

    const all = await service.list({ includeBodies: false })
    expect(all.total).toBe(3)
    expect(all.notes).toHaveLength(3)
    expect(all.notes.every((note) => note.body === "")).toBe(true)
    expect(
      (await service.list()).notes.filter((note) => note.body !== "")
    ).toHaveLength(3)

    expect(
      (await service.list({ includeBodies: false, status: "finished" })).notes[0]
    ).toMatchObject({
      id: second.id,
      body: "",
      status: "finished",
      pinned: true,
      revision: second.revision,
    })

    expect(
      (
        await service.list({ includeBodies: false, spaceID: alpha.id })
      ).notes.map((note) => note.id)
    ).toEqual([first.id])
    expect(
      (await service.list({ includeBodies: false, pinned: true })).notes.map(
        (note) => note.id
      )
    ).toEqual([second.id])
    expect(
      (await service.list({ includeBodies: false, query: "NEEDLE" })).notes.map(
        (note) => note.id
      )
    ).toEqual([first.id])

    const projected = (
      await service.list({ includeBodies: false, spaceID: null })
    ).notes.find((note) => note.id === attached.id)
    expect(projected?.body).toBe("")
    expect(projected?.attachments).toEqual([created.attachment])
    expect(projected?.revision).toBe(created.note.revision)
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

  test("serializes concurrent expectedRevision checks and reports revision_conflict", async () => {
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
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      type: "revision_conflict",
    })
    expect((await service.list()).notes[0]?.revision).toBe(2)
  })

  test("treats legacy records without revision as revision 0, then increments", async () => {
    const { service, store } = makeService()
    const legacy: Note = {
      id: "legacy",
      spaceID: null,
      title: "Legacy",
      body: "",
      status: "todo",
      pinned: false,
      attachments: [],
      revision: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
    }
    await store.putNote(legacy)
    expect((await service.list()).notes[0]?.revision).toBe(0)
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
      type: "revision_conflict",
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
    ).rejects.toMatchObject({ type: "revision_conflict" })
    expect((await service.list()).total).toBe(1)

    expect(
      await service.delete({
        noteID: note.id,
        expectedRevision: updated.revision,
      })
    ).toEqual({ deleted: true })
  })

  test("checks expectedRevision before space updates and refusal", async () => {
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
      type: "revision_conflict",
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
    ).rejects.toMatchObject({ type: "revision_conflict" })
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
    await expect(
      service.update({ noteID: "missing", title: "Note" })
    ).rejects.toMatchObject({
      type: "note_not_found",
      data: { noteID: "missing" },
    })
    await expect(
      service.create({
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
    await expect(
      service.search({ query: "x".repeat(LIMITS.query + 1) })
    ).rejects.toMatchObject({
      type: "invalid",
      data: { field: "query" },
    })
  })

  test("emits change events after committed writes only", async () => {
    const { service, events } = makeService()
    const space = await service.createSpace({ name: "Space" })
    const note = await service.create({ spaceID: space.id, title: "Note" })
    await service.update({ noteID: note.id, status: "finished" })
    await service.update({ noteID: note.id })
    await service.delete({ noteID: note.id })

    expect(events).toEqual([
      { entity: "space", action: "created", id: space.id },
      { entity: "note", action: "created", id: note.id },
      { entity: "note", action: "updated", id: note.id },
      { entity: "note", action: "deleted", id: note.id },
    ])
  })

  test("starts notes with no attachments and preserves them across updates", async () => {
    const { service, store } = makeService()
    const note = await service.create({ title: "Note" })
    expect(note.attachments).toEqual([])

    const data = btoa("hello attachment")
    const created = await service.createAttachment({
      noteID: note.id,
      name: "  notes.txt  ",
      mime: "text/plain; charset=utf-8",
      data,
    })
    expect(created.attachment.name).toBe("notes.txt")
    expect(created.attachment.mime).toBe("text/plain")
    expect(created.attachment.size).toBe(16)
    expect(created.note.revision).toBe(note.revision + 1)
    expect(created.note.attachments).toEqual([created.attachment])
    expect(await store.getAttachment(created.attachment.id)).toEqual(
      new TextEncoder().encode("hello attachment")
    )

    const updated = await service.update({ noteID: note.id, title: "Renamed" })
    expect(updated.attachments).toEqual([created.attachment])
    expect(updated.revision).toBe(created.note.revision + 1)
  })

  test("reads and deletes attachment bytes while lists expose metadata only", async () => {
    const { service, store } = makeService()
    const note = await service.create({ title: "Note" })
    const data = btoa("hello")
    const created = await service.createAttachment({
      noteID: note.id,
      name: "hello.txt",
      mime: "text/plain",
      data,
    })

    const read = await service.readAttachment({
      noteID: note.id,
      attachmentID: created.attachment.id,
    })
    expect(read).toEqual({ attachment: created.attachment, data })

    const listed = await service.list()
    expect(listed.notes[0]?.attachments).toEqual([created.attachment])
    expect(JSON.stringify(listed)).not.toContain(data)
    expect(await store.getNote(note.id)).toMatchObject({
      attachments: [created.attachment],
    })

    const deleted = await service.deleteAttachment({
      noteID: note.id,
      attachmentID: created.attachment.id,
      expectedRevision: created.note.revision,
    })
    expect(deleted.note.attachments).toEqual([])
    expect(deleted.note.revision).toBe(created.note.revision + 1)
    expect(await store.getAttachment(created.attachment.id)).toBeUndefined()
    await expect(
      service.readAttachment({
        noteID: note.id,
        attachmentID: created.attachment.id,
      })
    ).rejects.toMatchObject({ type: "attachment_not_found" })
  })

  test("checks expectedRevision on attachment writes and emits note updates", async () => {
    const { service, events } = makeService()
    const note = await service.create({ title: "Note" })
    const created = await service.createAttachment({
      noteID: note.id,
      name: "note.txt",
      mime: "text/plain",
      data: btoa("text"),
    })

    await expect(
      service.createAttachment({
        noteID: note.id,
        name: "second.txt",
        mime: "text/plain",
        data: btoa("text"),
        expectedRevision: note.revision,
      })
    ).rejects.toMatchObject({
      type: "revision_conflict",
      data: { entity: "note", id: note.id, revision: created.note.revision },
    })
    await expect(
      service.deleteAttachment({
        noteID: note.id,
        attachmentID: created.attachment.id,
        expectedRevision: note.revision,
      })
    ).rejects.toMatchObject({ type: "revision_conflict" })

    expect(events).toEqual([
      { entity: "note", action: "created", id: note.id },
      { entity: "note", action: "updated", id: note.id },
    ])
  })

  test("enforces attachment count, per-file, and total size limits", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Note" })
    for (let index = 0; index < LIMITS.attachmentCount; index++) {
      await service.createAttachment({
        noteID: note.id,
        name: `file-${index}.bin`,
        mime: "application/octet-stream",
        data: base64OfSize(1),
      })
    }
    await expect(
      service.createAttachment({
        noteID: note.id,
        name: "extra.bin",
        mime: "application/octet-stream",
        data: base64OfSize(1),
      })
    ).rejects.toMatchObject({
      type: "limit_exceeded",
      data: {
        noteID: note.id,
        attachmentCount: LIMITS.attachmentCount,
        limit: LIMITS.attachmentCount,
      },
    })

    const oversized = await service.create({ title: "Oversized" })
    await expect(
      service.createAttachment({
        noteID: oversized.id,
        name: "too-big.bin",
        mime: "application/octet-stream",
        data: base64OfSize(LIMITS.attachmentFileSize + 1),
      })
    ).rejects.toMatchObject({
      type: "limit_exceeded",
      data: {
        noteID: oversized.id,
        size: LIMITS.attachmentFileSize + 1,
        limit: LIMITS.attachmentFileSize,
      },
    })

    const total = await service.create({ title: "Total" })
    const full = base64OfSize(LIMITS.attachmentFileSize)
    await service.createAttachment({
      noteID: total.id,
      name: "one.bin",
      mime: "application/octet-stream",
      data: full,
    })
    await service.createAttachment({
      noteID: total.id,
      name: "two.bin",
      mime: "application/octet-stream",
      data: full,
    })
    await expect(
      service.createAttachment({
        noteID: total.id,
        name: "three.bin",
        mime: "application/octet-stream",
        data: base64OfSize(1),
      })
    ).rejects.toMatchObject({
      type: "limit_exceeded",
      data: {
        noteID: total.id,
        attachmentCount: 3,
        size: LIMITS.attachmentTotalSize + 1,
        limit: LIMITS.attachmentTotalSize,
      },
    })
  }, 30_000)

  test("rejects active MIME types, malformed names, and invalid base64", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Note" })
    const base = { noteID: note.id, name: "file", data: btoa("data") }

    for (const mime of [
      "image/svg+xml",
      "image/svg+xml; charset=utf-8",
      "text/html",
      "application/xhtml+xml",
      "application/javascript",
      "text/javascript",
      "application/ecmascript",
      "text/ecmascript",
      "image/javascript",
    ]) {
      await expect(
        service.createAttachment({ ...base, mime })
      ).rejects.toMatchObject({ type: "mime_rejected", data: { field: "mime" } })
    }

    await expect(
      service.createAttachment({ ...base, mime: "not-a-mime" })
    ).rejects.toMatchObject({ type: "invalid", data: { field: "mime" } })
    await expect(
      service.createAttachment({
        noteID: note.id,
        name: "   ",
        mime: "text/plain",
        data: btoa("data"),
      })
    ).rejects.toMatchObject({ type: "invalid", data: { field: "name" } })
    await expect(
      service.createAttachment({
        noteID: note.id,
        name: "bad\u0000name",
        mime: "text/plain",
        data: btoa("data"),
      })
    ).rejects.toMatchObject({ type: "invalid", data: { field: "name" } })
    await expect(
      service.createAttachment({
        noteID: note.id,
        name: "x".repeat(LIMITS.attachmentName + 1),
        mime: "text/plain",
        data: btoa("data"),
      })
    ).rejects.toMatchObject({ type: "invalid", data: { field: "name" } })

    for (const data of ["not base64!", "abc", "aGVs bG8=", ""]) {
      await expect(
        service.createAttachment({
          noteID: note.id,
          name: "file.txt",
          mime: "text/plain",
          data,
        })
      ).rejects.toMatchObject({ type: "invalid", data: { field: "data" } })
    }
  })

  test("rejects cross-note attachment access", async () => {
    const { service } = makeService()
    const first = await service.create({ title: "First" })
    const second = await service.create({ title: "Second" })
    const created = await service.createAttachment({
      noteID: first.id,
      name: "secret.txt",
      mime: "text/plain",
      data: btoa("secret"),
    })

    await expect(
      service.readAttachment({
        noteID: second.id,
        attachmentID: created.attachment.id,
      })
    ).rejects.toMatchObject({
      type: "attachment_not_found",
      data: { noteID: second.id, attachmentID: created.attachment.id },
    })
    await expect(
      service.deleteAttachment({
        noteID: second.id,
        attachmentID: created.attachment.id,
      })
    ).rejects.toMatchObject({ type: "attachment_not_found" })
    expect(
      (await service.list()).notes.find((note) => note.id === first.id)
    ).toMatchObject({ attachments: [created.attachment] })
  })

  test("best-effort removes attachment files when deleting a note", async () => {
    const { service, store } = makeService()
    const note = await service.create({ title: "Note" })
    const first = await service.createAttachment({
      noteID: note.id,
      name: "one.txt",
      mime: "text/plain",
      data: btoa("one"),
    })
    const second = await service.createAttachment({
      noteID: note.id,
      name: "two.txt",
      mime: "text/plain",
      data: btoa("two"),
    })

    expect(await service.delete({ noteID: note.id })).toEqual({ deleted: true })
    for (const attachment of [first.attachment, second.attachment]) {
      expect(await store.getAttachment(attachment.id)).toBeUndefined()
    }
  })

  test("deletes the note even when attachment cleanup fails", async () => {
    const { service, store } = makeService()
    const note = await service.create({ title: "Note" })
    const created = await service.createAttachment({
      noteID: note.id,
      name: "one.txt",
      mime: "text/plain",
      data: btoa("one"),
    })
    const remove = store.removeAttachment.bind(store)
    store.removeAttachment = async (attachmentID: string) => {
      if (attachmentID === created.attachment.id) throw new Error("cleanup failed")
      await remove(attachmentID)
    }

    expect(await service.delete({ noteID: note.id })).toEqual({ deleted: true })
    expect(await service.list()).toEqual({ notes: [], total: 0 })
    expect(await store.getAttachment(created.attachment.id)).toBeDefined()
  })

  test("searches titles and bodies with scores, snippets, and scoping", async () => {
    const { service } = makeService()
    const global = await service.createSpace({ name: "Global" })
    const project = await service.createSpace({
      name: "Plan",
      projectDir: "/repo",
    })
    const other = await service.createSpace({
      name: "Other",
      projectDir: "/other",
    })
    const titled = await service.create({
      spaceID: project.id,
      title: "Deploy checklist",
      body: "unrelated words",
    })
    const bodyOnly = await service.create({
      spaceID: project.id,
      title: "Random",
      body:
        "The deploy is ready. " +
        "We need to deploy carefully. " +
        "deploy deploy deploy deploy deploy deploy".repeat(2),
      status: "blocked",
    })
    const globalNote = await service.create({
      spaceID: global.id,
      title: "Deploy notes",
      body: "global deploy",
    })
    const otherNote = await service.create({
      spaceID: other.id,
      title: "Deploy elsewhere",
      body: "deploy",
    })

    const all = await service.search({ query: "DEPLOY" })
    expect(all.total).toBe(4)
    expect(all.results[0]?.score).toBe(110)
    expect(
      all.results.find((result) => result.note.id === titled.id)?.score
    ).toBe(100)
    expect(all.results.every((result) => result.note.body === "")).toBe(true)
    const bodyResult = all.results.find((result) => result.note.id === bodyOnly.id)
    expect(bodyResult?.score).toBe(50)
    expect(bodyResult?.snippet).toContain("deploy")
    expect(bodyResult?.snippet.endsWith("…")).toBe(true)

    const scoped = await service.search({ query: "deploy", directory: "/repo" })
    expect(scoped.total).toBe(3)
    expect(
      scoped.results.map((result) => result.note.id).toSorted()
    ).toEqual(
      [titled.id, bodyOnly.id, globalNote.id].toSorted()
    )
    expect(
      (
        await service.search({
          query: "deploy",
          directory: "/repo",
          includeGlobal: false,
        })
      ).total
    ).toBe(2)
    expect(
      (await service.search({ query: "deploy", statuses: ["blocked"] })).results
        .map((result) => result.note.id)
    ).toEqual([bodyOnly.id])
    expect(
      (await service.search({ query: "deploy", directory: "/other" })).results
        .map((result) => result.note.id)
        .toSorted()
    ).toEqual([globalNote.id, otherNote.id].toSorted())

    expect((await service.search({ query: "nothing-matches" })).total).toBe(0)
  })

  test("snapshots note history, omits bodies, and restores as a new revision", async () => {
    const { service } = makeService()
    const note = await service.create({
      title: "First",
      body: "body one",
      status: "todo",
    })
    const second = await service.update({
      noteID: note.id,
      title: "Second",
      status: "in-progress",
    })
    const third = await service.update({ noteID: note.id, body: "body three" })

    const history = await service.history({ noteID: note.id })
    expect(history.total).toBe(2)
    expect(history.snapshots[0]).toEqual({
      revision: second.revision,
      title: "Second",
      status: "in-progress",
      spaceID: null,
      savedAt: third.updatedAt,
      updatedAt: second.updatedAt,
    })
    expect(history.snapshots[1]?.revision).toBe(note.revision)
    expect(JSON.stringify(history)).not.toContain("body one")

    const restored = await service.restore({
      noteID: note.id,
      revision: note.revision,
      expectedRevision: third.revision,
    })
    expect(restored.note.title).toBe("First")
    expect(restored.note.body).toBe("body one")
    expect(restored.note.status).toBe("todo")
    expect(restored.note.revision).toBe(third.revision + 1)

    const after = await service.history({ noteID: note.id })
    expect(after.total).toBe(3)
    expect(after.snapshots[0]?.revision).toBe(third.revision)

    await expect(
      service.restore({ noteID: note.id, revision: 999 })
    ).rejects.toMatchObject({
      type: "snapshot_not_found",
      data: { noteID: note.id, revision: 999 },
    })
    await expect(
      service.restore({
        noteID: note.id,
        revision: note.revision,
        expectedRevision: third.revision,
      })
    ).rejects.toMatchObject({ type: "revision_conflict" })
    await expect(service.history({ noteID: "missing" })).resolves.toEqual({
      snapshots: [],
      total: 0,
    })
  })

  test("does not snapshot no-op updates or keep more than 50 snapshots", async () => {
    const { service } = makeService()
    const note = await service.create({ title: "Note" })
    await service.update({ noteID: note.id })
    expect((await service.history({ noteID: note.id })).total).toBe(0)

    let current = note
    for (let index = 0; index < 60; index++) {
      current = await service.update({
        noteID: note.id,
        body: `body ${index}`,
      })
    }
    const history = await service.history({ noteID: note.id })
    expect(history.total).toBe(50)
    expect(history.snapshots[0]?.revision).toBe(current.revision - 1)
    expect(history.snapshots.at(-1)?.revision).toBe(current.revision - 50)
  })
})

