import { watch } from "node:fs"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
let building = false
let pending = false
let stopping = false
let server
let timer

function runBuild() {
  return new Promise((resolveBuild) => {
    const child = spawn(process.execPath, ["scripts/build-bun.ts"], { cwd: root, stdio: "inherit", env: { ...process.env, OPENCODE_UI_BUILD_TARGET: "dev" } })
    child.once("error", () => resolveBuild(false))
    child.once("exit", (code) => resolveBuild(code === 0))
  })
}

async function rebuild() {
  if (stopping) return
  if (building) { pending = true; return }
  building = true
  const ok = await runBuild()
  building = false
  if (!ok) console.error("Bun frontend build failed; fix the error to rebuild.")
  if (pending) { pending = false; void rebuild() }
}

if (!await runBuild()) process.exit(1)
const port = process.env.OPENCODE_UI_PORT ?? "5175"
server = spawn(process.execPath, ["--watch", "server/bun-server.ts"], {
  cwd: root, stdio: "inherit",
  env: { ...process.env, OPENCODE_UI_PORT: port, OPENCODE_UI_DEV_ORIGIN: `http://127.0.0.1:${port}`, OPENCODE_UI_BUILD_TARGET: "dev" },
})
server.once("error", () => { console.error("Could not start the Bun development server."); stop() })
server.once("exit", () => stop())
const watchers = ["src", "public"].map((path) => watch(resolve(root, path), { recursive: true }, schedule))
watchers.push(watch(resolve(root, "index.html"), schedule))
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => void rebuild(), 150)
}
function stop() {
  if (stopping) return
  stopping = true
  clearTimeout(timer)
  for (const watcher of watchers) watcher.close()
  server?.kill()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
