import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStaticHandler } from "./web-static.ts"

let root
let serve
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "opencode-ui-static-"))
  await mkdir(join(root, "assets"))
  await writeFile(join(root, "index.html"), "app")
  await writeFile(join(root, "assets", "app.js"), "script")
  await symlink("/etc/passwd", join(root, "leak"))
  serve = createStaticHandler(root)
})
afterAll(async () => { await rm(root, { recursive: true, force: true }) })
const req = (path, init) => new Request(`http://localhost${path}`, init)
describe("static production assets", () => {
  test("serves entry and typed assets", async () => {
    expect(await (await serve(req("/"))).text()).toBe("app")
    expect((await serve(req("/assets/app.js"))).headers.get("content-type")).toBe("text/javascript; charset=utf-8")
  })
  test("does not expose symlinks or return HTML for missing assets", async () => {
    expect((await serve(req("/leak"))).status).toBe(404)
    expect((await serve(req("/assets/missing.js"))).status).toBe(404)
  })
  test("allows HEAD but rejects mutations", async () => {
    expect(await (await serve(req("/", { method: "HEAD" }))).text()).toBe("")
    expect((await serve(req("/", { method: "POST" }))).status).toBe(405)
  })
})
