import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import {
  createSessionShortcutsService,
  SESSION_SHORTCUTS_ROUTE,
} from "../server/session-shortcuts.ts"

const dirs = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true })
})

async function api() {
  const dir = await mkdtemp("/tmp/opencode/shortcuts-test-")
  dirs.push(dir)
  const stateFile = join(dir, "shortcuts.json")
  return { service: createSessionShortcutsService({ stateFile }), stateFile }
}

const request = (method, body) =>
  new Request(`http://localhost${SESSION_SHORTCUTS_ROUTE}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })

test("pins and labels are stored server-wide and survive a service restart", async () => {
  const { service, stateFile } = await api()
  const pinned = await service.handleRequest(
    request("POST", { id: "session-1", change: { pinned: true } })
  )
  expect((await pinned.json()).shortcuts["session-1"].pinned).toBe(true)

  const labeled = await service.handleRequest(
    request("POST", { id: "session-1", change: { label: "  My session  " } })
  )
  expect((await labeled.json()).shortcuts["session-1"]).toEqual({
    pinned: true,
    label: "My session",
  })

  const raw = JSON.parse(await readFile(stateFile, "utf8"))
  expect(raw["session-1"].label).toBe("My session")

  service.dispose()
  const reopened = createSessionShortcutsService({ stateFile })
  const got = await reopened.handleRequest(request("GET"))
  expect((await got.json()).shortcuts["session-1"].pinned).toBe(true)
  reopened.dispose()
})

test("an unpinned, unlabeled session is removed from the shared record", async () => {
  const { service } = await api()
  await service.handleRequest(
    request("POST", { id: "session-2", change: { pinned: true } })
  )
  const cleared = await service.handleRequest(
    request("POST", { id: "session-2", change: { pinned: false } })
  )
  expect((await cleared.json()).shortcuts["session-2"]).toBeUndefined()
  service.dispose()
})

test("invalid requests are rejected", async () => {
  const { service } = await api()
  expect((await service.handleRequest(request("PUT"))).status).toBe(405)
  expect(
    (await service.handleRequest(request("POST", { id: "", change: {} }))).status
  ).toBe(400)
  expect(
    (
      await service.handleRequest(
        request("POST", { id: "s", change: { pinned: "yes" } })
      )
    ).status
  ).toBe(400)
  service.dispose()
})
