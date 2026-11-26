import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  const dir = await mkdtemp("/tmp/opencode/shortcuts-conn-test-")
  dirs.push(dir)
  const stateFile = join(dir, "shortcuts.json")
  return { service: createSessionShortcutsService({ stateFile }), stateFile }
}

const post = (connectionId, id, change) =>
  new Request(`http://localhost${SESSION_SHORTCUTS_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connectionId, id, change }),
  })

const get = (connectionId) =>
  new Request(
    `http://localhost${SESSION_SHORTCUTS_ROUTE}?connectionId=${encodeURIComponent(connectionId)}`
  )

const assign = (connectionId) =>
  new Request(`http://localhost${SESSION_SHORTCUTS_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "assignLegacy", connectionId }),
  })

const shortcutsFor = async (service, connectionId) =>
  (await (await service.handleRequest(get(connectionId))).json()).shortcuts

test("pins saved on connection A are never returned for connection B", async () => {
  const { service } = await api()
  await service.handleRequest(post("conn-a", "session-a", { pinned: true }))
  expect(Object.keys(await shortcutsFor(service, "conn-a"))).toEqual(["session-a"])
  expect(Object.keys(await shortcutsFor(service, "conn-b"))).toEqual([])
  service.dispose()
})

test("switching A -> B -> A restores A's pins without mixing in B's", async () => {
  const { service } = await api()
  await service.handleRequest(post("conn-a", "a-only", { pinned: true }))
  await service.handleRequest(post("conn-b", "b-only", { pinned: true, label: "B" }))

  expect(Object.keys(await shortcutsFor(service, "conn-a"))).toEqual(["a-only"])
  const onB = await shortcutsFor(service, "conn-b")
  expect(Object.keys(onB)).toEqual(["b-only"])
  expect(onB["b-only"]).toEqual({ pinned: true, label: "B" })

  const backOnA = await shortcutsFor(service, "conn-a")
  expect(Object.keys(backOnA)).toEqual(["a-only"])
  expect(backOnA["a-only"]).toEqual({ pinned: true, label: "" })
  service.dispose()
})

test("unpinning on A does not affect B", async () => {
  const { service } = await api()
  await service.handleRequest(post("conn-a", "shared", { pinned: true }))
  await service.handleRequest(post("conn-b", "shared", { pinned: true, label: "Keep me" }))

  await service.handleRequest(post("conn-a", "shared", { pinned: false }))

  expect(Object.keys(await shortcutsFor(service, "conn-a"))).toEqual([])
  const onB = await shortcutsFor(service, "conn-b")
  expect(onB["shared"]).toEqual({ pinned: true, label: "Keep me" })
  service.dispose()
})

test("an identical session id pinned on both connections stays independent", async () => {
  const { service } = await api()
  await service.handleRequest(post("conn-a", "same-id", { pinned: true, label: "From A" }))
  await service.handleRequest(post("conn-b", "same-id", { pinned: true, label: "From B" }))

  const onA = await shortcutsFor(service, "conn-a")
  const onB = await shortcutsFor(service, "conn-b")
  expect(onA["same-id"].label).toBe("From A")
  expect(onB["same-id"].label).toBe("From B")

  await service.handleRequest(post("conn-b", "same-id", { label: "B renamed" }))
  expect((await shortcutsFor(service, "conn-a"))["same-id"].label).toBe("From A")
  expect((await shortcutsFor(service, "conn-b"))["same-id"].label).toBe("B renamed")
  service.dispose()
})

test("v1 legacy data is preserved, hidden, and only moved by assignLegacy", async () => {
  const dir = await mkdtemp("/tmp/opencode/shortcuts-legacy-test-")
  dirs.push(dir)
  const stateFile = join(dir, "shortcuts.json")
  await writeFile(
    stateFile,
    JSON.stringify({ "legacy-session": { pinned: true, label: "Old pin" } })
  )

  const service = createSessionShortcutsService({ stateFile })

  const onA = await (await service.handleRequest(get("conn-a"))).json()
  expect(Object.keys(onA.shortcuts)).toEqual([])
  expect(onA.legacyCount).toBe(1)

  const onB = await (await service.handleRequest(get("conn-b"))).json()
  expect(Object.keys(onB.shortcuts)).toEqual([])
  expect(onB.legacyCount).toBe(1)

  // The flat v1 map was migrated on load and never discarded.
  const raw = JSON.parse(await readFile(stateFile, "utf8"))
  expect(raw.version).toBe(2)
  expect(raw.legacy["legacy-session"]).toEqual({ pinned: true, label: "Old pin" })

  // A normal mutation does not move legacy data.
  await service.handleRequest(post("conn-a", "new-pin", { pinned: true }))
  const untouched = await (await service.handleRequest(get("conn-a"))).json()
  expect(Object.keys(untouched.shortcuts)).toEqual(["new-pin"])
  expect(untouched.legacyCount).toBe(1)

  // assignLegacy moves everything into the target connection only.
  const assigned = await (await service.handleRequest(assign("conn-b"))).json()
  expect(assigned.shortcuts["legacy-session"]).toEqual({ pinned: true, label: "Old pin" })
  expect(assigned.legacyCount).toBe(0)
  expect(Object.keys(await shortcutsFor(service, "conn-a"))).toEqual(["new-pin"])

  const migrated = JSON.parse(await readFile(stateFile, "utf8"))
  expect(Object.keys(migrated.legacy)).toEqual([])
  expect(migrated.byConnection["conn-b"]["legacy-session"]).toEqual({ pinned: true, label: "Old pin" })
  service.dispose()
})

test("assignLegacy merges with existing active values winning", async () => {
  const dir = await mkdtemp("/tmp/opencode/shortcuts-legacy-merge-test-")
  dirs.push(dir)
  const stateFile = join(dir, "shortcuts.json")
  await writeFile(
    stateFile,
    JSON.stringify({
      "same-id": { pinned: true, label: "Legacy label" },
      "legacy-only": { pinned: true, label: "" },
    })
  )

  const service = createSessionShortcutsService({ stateFile })
  await service.handleRequest(
    post("conn-a", "same-id", { pinned: true, label: "Active label" })
  )

  const assigned = await (await service.handleRequest(assign("conn-a"))).json()
  expect(assigned.shortcuts["same-id"].label).toBe("Active label")
  expect(assigned.shortcuts["legacy-only"]).toEqual({ pinned: true, label: "" })
  expect(assigned.legacyCount).toBe(0)
  service.dispose()
})

test("unpinning a re-assigned pin clears its matching legacy entry", async () => {
  const dir = await mkdtemp("/tmp/opencode/shortcuts-reassign-test-")
  dirs.push(dir)
  const stateFile = join(dir, "shortcuts.json")
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 2,
      byConnection: { "conn-a": { reassigned: { pinned: true, label: "" } } },
      legacy: { reassigned: { pinned: true, label: "" } },
    })
  )

  const service = createSessionShortcutsService({ stateFile })
  const before = await (await service.handleRequest(get("conn-a"))).json()
  expect(Object.keys(before.shortcuts)).toEqual(["reassigned"])
  expect(before.legacyCount).toBe(1)

  // A pin copied from legacy still has a legacy copy; unpinning on A removes
  // both so it can be cleared normally.
  await service.handleRequest(post("conn-a", "reassigned", { pinned: false }))
  const after = await (await service.handleRequest(get("conn-a"))).json()
  expect(Object.keys(after.shortcuts)).toEqual([])
  expect(after.legacyCount).toBe(0)
  service.dispose()
})
