import { afterEach, expect, test } from "bun:test"
import {
  NotesApiError,
  createNotesAdapter,
  listNotesScoped,
  listSpacesScoped,
  notesRequest,
  setNotesAuthHandler,
  subscribeNotesEvents,
} from "../src/lib/notes-api"

const realFetch = globalThis.fetch
const realEventSource = globalThis.EventSource

afterEach(() => {
  globalThis.fetch = realFetch
  if (realEventSource === undefined) delete globalThis.EventSource
  else globalThis.EventSource = realEventSource
  setNotesAuthHandler(null)
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function captureFetch(handler) {
  const calls = []
  globalThis.fetch = async (request, init) => {
    const url = typeof request === "string" ? request : String(request?.url ?? request)
    calls.push({ url, init })
    return await handler(url, init)
  }
  return calls
}

const note = (id, overrides = {}) => ({
  id,
  title: `Note ${id}`,
  body: "Body",
  status: "todo",
  pinned: false,
  spaceID: null,
  revision: 1,
  attachments: [],
  ...overrides,
})

test("requests are same-origin POSTs to the method path", async () => {
  const calls = captureFetch(async () => json({ ok: true }))
  const output = await notesRequest("list", { directory: "/work", limit: 5 })
  expect(output).toEqual({ ok: true })
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("/api/ui/notes/list")
  expect(calls[0].init.method).toBe("POST")
  expect(calls[0].init.credentials).toBe("same-origin")
  expect(calls[0].init.cache).toBe("no-store")
  expect(JSON.parse(calls[0].init.body)).toEqual({ directory: "/work", limit: 5 })
})

test("server errors keep the status and the stable code", async () => {
  const cases = [
    [400, "invalid", "invalid"],
    [404, "note_not_found", "note_not_found"],
    [409, "revision_conflict", "revision_conflict"],
    [413, "limit_exceeded", "limit_exceeded"],
    [415, "mime_rejected", "mime_rejected"],
    [500, "unknown_error", null],
  ]
  for (const [status, code, expected] of cases) {
    globalThis.fetch = async () =>
      json({ error: { code, message: `${code} happened` } }, status)
    let failure
    try {
      await notesRequest("update", {})
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(NotesApiError)
    expect(failure.status).toBe(status)
    expect(failure.code).toBe(expected ?? code)
    expect(failure.message).toBe(`${code} happened`)
  }
})

test("unreadable error bodies fall back to a status message", async () => {
  globalThis.fetch = async () => new Response("not json", { status: 502 })
  let failure
  try {
    await notesRequest("list", {})
  } catch (error) {
    failure = error
  }
  expect(failure.code).toBe("unknown_error")
  expect(failure.message).toContain("rejected")
  expect(failure.status).toBe(502)
})

test("a network failure is normalized instead of thrown raw", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch")
  }
  let failure
  try {
    await notesRequest("spaces", {})
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(NotesApiError)
  expect(failure.status).toBe(0)
  expect(failure.code).toBe("network_error")
})

test("a gated 401 signals the auth gate with the server code", async () => {
  const seen = []
  setNotesAuthHandler((code) => seen.push(code))
  globalThis.fetch = async () =>
    json({ error: { code: "auth_required" } }, 401)
  let failure
  try {
    await notesRequest("list", {})
  } catch (error) {
    failure = error
  }
  expect(failure.status).toBe(401)
  expect(seen).toEqual(["auth_required"])

  globalThis.fetch = async () =>
    json({ error: { code: "setup_required" } }, 401)
  try {
    await notesRequest("list", {})
  } catch {
    // expected
  }
  expect(seen).toEqual(["auth_required", "setup_required"])
})

test("non-auth 401s and auth-gate failures do not break the error path", async () => {
  const seen = []
  setNotesAuthHandler(() => {
    seen.push("called")
    throw new Error("gate unavailable")
  })
  globalThis.fetch = async () => json({ error: { code: "teapot" } }, 401)
  let failure
  try {
    await notesRequest("list", {})
  } catch (error) {
    failure = error
  }
  expect(seen).toEqual([])
  expect(failure.code).toBe("teapot")

  globalThis.fetch = async () =>
    json({ error: { code: "auth_required" } }, 401)
  try {
    await notesRequest("list", {})
  } catch (error) {
    failure = error
  }
  expect(seen).toEqual(["called"])
  expect(failure.code).toBe("auth_required")
})

test("scoped list requests pass the directory and map wire notes", async () => {
  const calls = captureFetch(async (url) => {
    if (url.endsWith("/list"))
      return json({ notes: [note("a", { attachments: undefined })], total: 1 })
    return json({ spaces: [] })
  })
  const result = await listNotesScoped("/work", { pinned: true, limit: 5 })
  expect(result.total).toBe(1)
  expect(result.notes[0].content).toBe("Body")
  expect(result.notes[0].status).toBe("todo")
  expect(JSON.parse(calls[0].init.body)).toEqual({
    directory: "/work",
    pinned: true,
    limit: 5,
  })
})

test("spaces are mapped with projectDir and de-duplicated by id", async () => {
  const calls = captureFetch(async () =>
    json({
      spaces: [
        { id: "global", name: "Ideas", projectDir: null, pinned: false, revision: 1 },
        { id: "work", name: "Work", projectDir: "/synthetic/notes", pinned: true, revision: 2 },
      ],
      total: 2,
    })
  )
  const spaces = await listSpacesScoped("/synthetic/notes")
  expect(spaces.map((space) => [space.id, space.projectDir])).toEqual([
    ["global", null],
    ["work", "/synthetic/notes"],
  ])
  expect(JSON.parse(calls[0].init.body)).toEqual({ directory: "/synthetic/notes" })
})

test("the adapter pages through list results and reports the workspace", async () => {
  const pages = {
    0: { notes: [note("a")], total: 2 },
    1: { notes: [note("b")], total: 2 },
  }
  const calls = captureFetch(async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.endsWith("/spaces"))
      return json({
        spaces: [
          { id: "work", name: "Work", projectDir: "/work", pinned: false, revision: 1 },
        ],
      })
    return json(pages[body.offset] ?? { notes: [], total: 2 })
  })
  const adapter = createNotesAdapter("/work")
  const snapshot = await adapter.list()
  expect(snapshot.workspaceDirectory).toBe("/work")
  expect(snapshot.notes.map((item) => item.id)).toEqual(["a", "b"])
  expect(snapshot.spaces).toHaveLength(1)
  const listCalls = calls.filter((call) => call.url.endsWith("/list"))
  expect(listCalls).toHaveLength(2)
  expect(JSON.parse(listCalls[0].init.body)).toEqual({
    limit: 1000,
    offset: 0,
  })
  expect(JSON.parse(calls.find((call) => call.url.endsWith("/spaces")).init.body)).toEqual({})
})

test("mutations send the service input shape and expectedRevision", async () => {
  const calls = captureFetch(async (url) => {
    if (url.endsWith("/createAttachment"))
      return json({
        note: note("a", { attachments: [] }),
        attachment: { id: "att", name: "a.txt", mime: "text/plain", size: 2 },
      })
    if (url.endsWith("/readAttachment"))
      return json({
        attachment: { id: "att", name: "a.txt", mime: "text/plain", size: 2 },
        data: "aGk=",
      })
    if (url.endsWith("/deleteAttachment"))
      return json({ note: note("a") })
    return json({ ok: true })
  })
  const adapter = createNotesAdapter("/work")
  await adapter.createSpace({ name: "Ideas", projectDir: null })
  await adapter.updateSpace("s1", { name: "Work", projectDir: "/work" }, 3)
  await adapter.updateNote(
    "n1",
    { title: "T", content: "C", status: "blocked", pinned: true, spaceID: null },
    4
  )
  await adapter.deleteSpace("s1", 5)
  const created = await adapter.createAttachment(
    "n1",
    { name: "a.txt", mime: "text/plain", data: "aGk=" },
    6
  )
  expect(created.attachment.id).toBe("att")
  expect((await adapter.readAttachment("n1", "att")).data).toBe("aGk=")
  expect((await adapter.deleteAttachment("n1", "att", 7)).note.id).toBe("a")

  const bodies = calls.map((call) => [call.url.split("/").at(-1), JSON.parse(call.init.body)])
  expect(bodies).toEqual([
    ["createSpace", { name: "Ideas", projectDir: null }],
    [
      "updateSpace",
      { spaceID: "s1", name: "Work", projectDir: "/work", expectedRevision: 3 },
    ],
    [
      "update",
      {
        noteID: "n1",
        title: "T",
        body: "C",
        status: "blocked",
        pinned: true,
        spaceID: null,
        expectedRevision: 4,
      },
    ],
    ["deleteSpace", { spaceID: "s1", expectedRevision: 5 }],
    [
      "createAttachment",
      { noteID: "n1", name: "a.txt", mime: "text/plain", data: "aGk=", expectedRevision: 6 },
    ],
    ["readAttachment", { noteID: "n1", attachmentID: "att" }],
    ["deleteAttachment", { noteID: "n1", attachmentID: "att", expectedRevision: 7 }],
  ])
})

test("adapter sends the active connection and honors explicit space reassignment", async () => {
  const calls = captureFetch(async () => json({ ok: true }))
  const adapter = createNotesAdapter("/work", "conn_a")
  await adapter.createNote({
    title: "T",
    content: "C",
    status: "todo",
    pinned: false,
    spaceID: null,
  })
  await adapter.updateSpace(
    "s1",
    { name: "S", projectDir: "/work", connectionId: "conn_b" },
    1
  )
  expect(JSON.parse(calls[0].init.body)).toEqual({
    title: "T",
    body: "C",
    status: "todo",
    pinned: false,
    spaceID: null,
    connectionId: "conn_a",
  })
  expect(JSON.parse(calls[1].init.body)).toEqual({
    spaceID: "s1",
    name: "S",
    projectDir: "/work",
    connectionId: "conn_b",
    expectedRevision: 1,
  })
})

class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.listeners = new Map()
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, listener) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }
  close() {
    this.closed = true
  }
  emit(type, data) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data: JSON.stringify(data) })
  }
}

test("change events are read from the notes SSE endpoint and cleaned up", () => {
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  const seen = []
  const stop = subscribeNotesEvents((at) => seen.push(at))
  const source = FakeEventSource.instances[0]
  expect(source.url).toBe("/api/ui/notes/events")
  source.emit("changed", { at: 123 })
  source.emit("changed", { notAt: true })
  source.emit("open", {})
  expect(seen[0]).toBe(123)
  expect(typeof seen[1]).toBe("number")
  expect(typeof seen[2]).toBe("number")
  stop()
  expect(source.closed).toBe(true)
  expect(source.listeners.get("changed").size).toBe(0)
})

test("a silent notes stream is restarted and forces a refetch", async () => {
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  const seen = []
  const stop = subscribeNotesEvents((at) => seen.push(at), 20)
  const first = FakeEventSource.instances[0]
  await new Promise((resolve) => setTimeout(resolve, 70))
  expect(first.closed).toBe(true)
  expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2)
  expect(seen.length).toBeGreaterThanOrEqual(1)
  stop()
  expect(FakeEventSource.instances.every((instance) => instance.closed)).toBe(true)
})

test("missing EventSource support stays silent", () => {
  delete globalThis.EventSource
  const stop = subscribeNotesEvents(() => {
    throw new Error("must not fire")
  })
  expect(typeof stop).toBe("function")
  stop()
})

test("adapter change events are debounced into one refresh", async () => {
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  const adapter = createNotesAdapter("/work")
  let changes = 0
  const stop = adapter.subscribe(() => {
    changes += 1
  })
  const source = FakeEventSource.instances[0]
  source.emit("changed", { at: 1 })
  source.emit("changed", { at: 2 })
  source.emit("changed", { at: 3 })
  expect(changes).toBe(0)
  await new Promise((resolve) => setTimeout(resolve, 220))
  expect(changes).toBe(1)
  stop()
  expect(source.closed).toBe(true)
})

test("stopping a subscription cancels a pending debounced refresh", async () => {
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  const adapter = createNotesAdapter("/work")
  let changes = 0
  const stop = adapter.subscribe(() => {
    changes += 1
  })
  FakeEventSource.instances[0].emit("changed", { at: 1 })
  stop()
  await new Promise((resolve) => setTimeout(resolve, 220))
  expect(changes).toBe(0)
})
