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

const cliArgs = process.argv.slice(2)
if (cliArgs.includes("--help") || cliArgs.includes("-h") || cliArgs.includes("--version") || cliArgs.includes("-v")) {
  const child = spawn(process.execPath, ["server/bun-server.ts", ...cliArgs], { cwd: root, stdio: "inherit" })
  child.once("exit", (code) => process.exit(code ?? 0))
} else {
  if (!await runBuild()) process.exit(1)
  const port = process.env.OPENCODE_UI_PORT ?? "5175"
  const host = process.env.OPENCODE_UI_HOST ?? "127.0.0.1"
  const devOrigin = process.env.OPENCODE_UI_DEV_ORIGIN ?? `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ["--watch", "server/bun-server.ts", ...cliArgs], {
    cwd: root, stdio: "inherit",
    env: { ...process.env, OPENCODE_UI_PORT: port, OPENCODE_UI_HOST: host, OPENCODE_UI_DEV_ORIGIN: devOrigin, OPENCODE_UI_BUILD_TARGET: "dev" },
  })
  console.log(`OpenCode UI dev server: http://${host === "0.0.0.0" ? "<lan-ip-or-hostname>" : host}:${port}`)
  server.once("error", () => { console.error("Could not start the Bun development server."); stop(1) })
  server.once("exit", (code) => stop(code && code !== 0 ? code : 0))
  const watchers = ["src", "public"].map((path) => {
    const w = watch(resolve(root, path), { recursive: true }, schedule)
    w.on("error", () => {})
    return w
  })
  const htmlWatcher = watch(resolve(root, "index.html"), schedule)
  htmlWatcher.on("error", () => {})
  watchers.push(htmlWatcher)
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => void rebuild(), 150)
  }
  function stop(exitCode) {
    if (stopping) return
    stopping = true
    clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
    server?.kill()
    if (typeof exitCode === "number" && exitCode !== 0) process.exitCode = exitCode
  }
  process.once("SIGINT", () => stop(0))
  process.once("SIGTERM", () => stop(0))
}
