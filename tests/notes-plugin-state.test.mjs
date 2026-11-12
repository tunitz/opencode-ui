import { afterEach, expect, test } from "bun:test"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stub(body, status = 200) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
}

async function readState() {
  const { fetchNotesPluginState } = await import("../src/lib/notes-plugin-state")
  return fetchNotesPluginState()
}

test("an enabled Notes entry reads as registered", async () => {
  stub({ plugins: [{ id: "notes", registered: true, engineSynced: true }] })
  expect(await readState()).toEqual({ registered: true, available: true })
})

test("a disabled, engine-synchronized Notes entry reads as not registered", async () => {
  stub({ plugins: [{ id: "notes", registered: false, engineSynced: true }] })
  expect(await readState()).toEqual({ registered: false, available: true })
})

test("a disabled config whose engine entry remains is unknown, not hidden", async () => {
  stub({ plugins: [{ id: "notes", registered: false, engineSynced: false }] })
  expect(await readState()).toEqual({ registered: null, available: true })
})

test("a legacy payload without engineSynced keeps the config answer", async () => {
  stub({ plugins: [{ id: "notes", registered: false }] })
  expect(await readState()).toEqual({ registered: false, available: true })
})
