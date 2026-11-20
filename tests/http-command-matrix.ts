/**
 * Non-loopback plain-HTTP end-to-end command matrix.
 *
 * Run with: bun run test:http-matrix
 *
 * Serves a synthetic app fixture (the real Composer against an in-memory
 * controller) from a global IPv4 over plain HTTP, opens it in the installed
 * Playwright Chromium, and drives every in-scope built-in slash command and
 * alias plus a synthetic dynamic server command (`team/review`). Also checks a
 * stale-catalog freshness case and plain-HTTP/secure-context invariants.
 *
 * No real engine, credential, model call, or live session is touched. The only
 * network mutation is a same-origin POST to the synthetic `/api/command` route.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"

import { buildFixture } from "./browser/build"
import { findChromiumExecutable } from "./browser/chromium"

const repoRoot = resolve(import.meta.dir, "..")
const resultsPath = "/tmp/opencode/http-command-matrix-results.json"

const CANONICAL = [
  "help", "sessions", "new", "clear", "open", "models", "agents", "variants",
  "mcps", "connect", "settings", "status", "themes", "diff", "copy", "rename",
  "timeline", "fork", "compact", "undo", "redo", "export", "btw", "cd",
  "skills", "worktrees", "terminal", "plugins", "stats", "usage", "highlights",
  "pair", "reload", "debug",
] as const

const ALIASES = [
  "resume", "continue", "projects", "project", "thinking", "effort", "web",
] as const

type Expectation = { status?: string[]; calls?: string[] }
const EXPECT: Record<string, Expectation> = {
  help: { status: ["Type / to search commands"] },
  sessions: { status: ["session navigator"], calls: ["ui:Open sessions"] },
  resume: { status: ["session navigator"], calls: ["ui:Open sessions"] },
  continue: { status: ["session navigator"], calls: ["ui:Open sessions"] },
  new: { status: ["Opened New session"], calls: ["ui:New session"] },
  clear: { status: ["Cleared the conversation view"], calls: ["clearSessionView"] },
  open: { status: ["session navigator"], calls: ["ui:Open sessions"] },
  projects: { status: ["session navigator"], calls: ["ui:Open sessions"] },
  project: { status: ["session navigator"], calls: ["ui:Open sessions"] },
  models: { status: ["model settings"], calls: ["onModelSettingsOpenChange", "ui:Active model"] },
  agents: { status: ["model settings"], calls: ["onModelSettingsOpenChange", "ui:Active model"] },
  variants: { status: ["model settings"], calls: ["onModelSettingsOpenChange", "ui:Active model"] },
  thinking: { status: ["model settings"], calls: ["onModelSettingsOpenChange", "ui:Active model"] },
  effort: { status: ["model settings"], calls: ["onModelSettingsOpenChange", "ui:Active model"] },
  mcps: { status: ["MCP status"] },
  connect: { status: ["provider/integration catalog"] },
  settings: { status: ["Preferences"], calls: ["onOpenSettings"] },
  status: { status: ["native status"] },
  themes: { status: ["theme picker"], calls: ["onOpenSettings"] },
  diff: { status: ["Opened Changes"], calls: ["openInspector"] },
  copy: { status: ["Copied the last assistant message", "No assistant message text to copy"] },
  rename: { status: ["rename dialog"] },
  timeline: { status: ["message timeline"] },
  fork: { status: ["fork boundary"] },
  compact: { status: ["compaction confirmation"] },
  undo: { status: ["undo preview"] },
  redo: { status: ["redo confirmation"] },
  export: { status: ["session export"] },
  btw: { status: ["side-question"] },
  cd: { status: ["change-directory"] },
  skills: { status: ["skill catalog"] },
  worktrees: { status: ["worktree manager"] },
  terminal: { status: ["browser terminal"] },
  plugins: { status: ["plugin metadata"] },
  stats: { status: ["usage statistics"] },
  usage: { status: ["usage limits"] },
  highlights: { status: ["release highlights"] },
  pair: { status: ["device pairing"] },
  web: { status: ["device pairing"] },
  reload: { status: ["reload confirmation"] },
  debug: { status: ["client diagnostics"] },
}

const BASELINE_STATUS = ["Prompt composer ready.", "Select a session to prompt."]
const sleep = (ms: number) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function discoverHost(): string {
  const override = process.env.OPENCODE_UI_HTTP_HOST?.trim()
  if (override) return override
  const output = Bun.spawnSync(["hostname", "-I"], { stdout: "pipe" })
  const addresses = new TextDecoder()
    .decode(output.stdout)
    .split(/\s+/)
    .filter(Boolean)
  const ipv4 = addresses.find((address) => {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false
    if (address.startsWith("127.")) return false
    if (address.startsWith("169.254.")) return false
    // Skip the default Docker bridge networks; prefer a real LAN address.
    if (/^172\.(17|18)\./.test(address)) return false
    return true
  })
  assert(ipv4, "No non-loopback IPv4 found from `hostname -I` (set OPENCODE_UI_HTTP_HOST).")
  return ipv4
}

type QACall = { kind: string; value?: string; args?: Record<string, unknown> }
type CommandPost = { name: string; text: string; skills: unknown[] }

type CommandResult = {
  name: string
  kind: "canonical" | "alias" | "dynamic" | "freshness"
  status: "PASS" | "FAIL"
  outcome: string
  statusText?: string
  calls?: QACall[]
  detail?: string
}

const commandPosts: CommandPost[] = []
const commandResults: CommandResult[] = []

function json(body: unknown, statusCode = 200) {
  return Response.json(body, {
    status: statusCode,
    headers: { "cache-control": "no-store" },
  })
}

// ---------------------------------------------------------------------------
// Build + synthetic server
// ---------------------------------------------------------------------------
await mkdir("/tmp/opencode", { recursive: true })
const outDir = await mkdtemp("/tmp/opencode/http-command-matrix-fixture-")
await buildFixture(outDir, join(repoRoot, "tests/http-command-matrix/fixture.tsx"))

const host = discoverHost()
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === "/api/command") {
      if (request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          name?: string
          text?: string
          skills?: unknown[]
          simulateUnknown?: boolean
        }
        commandPosts.push({
          name: typeof body.name === "string" ? body.name : "",
          text: typeof body.text === "string" ? body.text : "",
          skills: Array.isArray(body.skills) ? body.skills : [],
        })
        if (body.simulateUnknown) {
          return json(
            { _tag: "CommandNotFoundError", message: "Command not found" },
            404
          )
        }
        return json({ ok: true })
      }
      return json({ error: "method_not_allowed" }, 405)
    }
    if (pathname === "/api/ui/auth/status") {
      return json({ configured: true, required: false, authenticated: true })
    }
    if (pathname === "/api/ui/plugins") return json({ plugins: [], engineAvailable: true })
    if (pathname === "/api/ui/agents") return json({ agents: [] })
    if (pathname === "/api/location") {
      return json({ project: { id: "p-alpha" }, directory: "/synthetic/alpha" })
    }
    if (pathname === "/api/fs/find") return json({ data: [] })
    if (pathname === "/api/ui/notes/events") {
      return new Response("retry: 60000\n\n", {
        headers: { "cache-control": "no-store", "content-type": "text/event-stream" },
      })
    }
    if (pathname.startsWith("/api/ui/notes/")) return json({ notes: [], spaces: [], total: 0 })
    if (pathname.startsWith("/api/")) return json({ message: "Synthetic route not configured." }, 404)
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 })

    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
    const filePath = resolve(outDir, relative)
    if (!filePath.startsWith(`${outDir}/`) && filePath !== join(outDir, "index.html")) {
      return new Response("Not found", { status: 404 })
    }
    const file = Bun.file(filePath)
    if (!(await file.exists())) return new Response("Not found", { status: 404 })
    return new Response(file)
  },
})

const base = `http://${host}:${server.port}`

// Confirm the LAN address is genuinely reachable before involving the browser.
try {
  const probe = await fetch(`${base}/`)
  assert(probe.ok, `LAN probe returned ${probe.status}`)
} catch (error) {
  console.error(`[http-matrix] LAN URL ${base} is not reachable: ${String(error)}`)
  server.stop(true)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
const executablePath = findChromiumExecutable()
if (!executablePath) {
  console.error("[http-matrix] No installed Playwright Chromium executable was found.")
  await writeFile(resultsPath, JSON.stringify({ error: "chromium_unavailable", base }, null, 2))
  server.stop(true)
  process.exit(1)
}

const browser: Browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "en-US",
  timezoneId: "UTC",
})
// Start every navigation from clean browser-local state.
await context.addInitScript(() => {
  try {
    window.localStorage.clear()
  } catch {
    // Ignore storage failures; synthetic drafts are not essential.
  }
})
const page: Page = await context.newPage()
const pageErrors: string[] = []
page.on("pageerror", (error) => pageErrors.push(error.message))

async function loadPage() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" })
  await page.locator("[data-fixture='command-matrix']").waitFor({ state: "visible", timeout: 10_000 })
  await page.locator("textarea[data-composer-input]").waitFor({ state: "visible", timeout: 10_000 })
}

async function statusText(): Promise<string> {
  return (await page.locator("#composer-status").textContent())?.trim() ?? ""
}

async function calls(): Promise<QACall[]> {
  return page.evaluate(
    () => (window as unknown as { __qa: { calls: QACall[] } }).__qa.calls.slice()
  )
}

function statusMatches(text: string, expected: Expectation): boolean {
  const lower = text.toLowerCase()
  return (expected.status ?? []).some((needle) => lower.includes(needle.toLowerCase()))
}

function callsMatch(observed: QACall[], expected: Expectation): boolean {
  return (expected.calls ?? []).some((kind) => observed.some((call) => call.kind === kind))
}

async function driveCommand(name: string, draft: string) {
  await loadPage()
  const input = page.locator("textarea[data-composer-input]")
  await input.fill(draft)
  await input.press("Enter")

  const expected = EXPECT[name] ?? {}
  const deadline = Date.now() + 3_000
  let lastStatus = ""
  let observed: QACall[] = []
  while (Date.now() < deadline) {
    lastStatus = await statusText()
    observed = await calls()
    const nonBaseline = lastStatus.length > 0 && !BASELINE_STATUS.includes(lastStatus)
    if ((statusMatches(lastStatus, expected) || callsMatch(observed, expected)) && (nonBaseline || observed.length > 0)) {
      return { ok: true, statusText: lastStatus, calls: observed }
    }
    await sleep(50)
  }
  return { ok: false, statusText: lastStatus, calls: observed }
}

function record(name: string, kind: CommandResult["kind"], outcome: {
  ok: boolean
  statusText: string
  calls: QACall[]
}, detail?: string) {
  commandResults.push({
    name,
    kind,
    status: outcome.ok ? "PASS" : "FAIL",
    outcome: outcome.ok ? "observable feedback/nav call" : "no expected observable outcome",
    statusText: outcome.statusText,
    calls: outcome.calls,
    detail,
  })
}

// ---------------------------------------------------------------------------
// 1. Plain-HTTP invariants
// ---------------------------------------------------------------------------
await loadPage()
const httpInfo = await page.evaluate(() => ({
  protocol: window.location.protocol,
  hostname: window.location.hostname,
  href: window.location.href,
  isSecureContext: window.isSecureContext,
}))
const plainHttp = {
  ...httpInfo,
  expectedHost: host,
  note: isLoopback(httpInfo.hostname)
    ? "FAIL: page loaded from a loopback address"
    : "page loaded from a non-loopback LAN address",
}
function isLoopback(value: string) {
  return value === "127.0.0.1" || value === "localhost" || value === "::1" || value.startsWith("127.")
}
commandResults.push({
  name: "plain-http invariants",
  kind: "canonical",
  status:
    httpInfo.protocol === "http:" &&
    httpInfo.hostname === host &&
    !isLoopback(httpInfo.hostname) &&
    !base.includes("127.0.0.1")
      ? "PASS"
      : "FAIL",
  outcome: `protocol=${httpInfo.protocol} host=${httpInfo.hostname} isSecureContext=${httpInfo.isSecureContext}`,
})

// ---------------------------------------------------------------------------
// 2. Canonical commands + aliases
// ---------------------------------------------------------------------------
for (const name of CANONICAL) {
  const outcome = await driveCommand(name, `/${name} `)
  record(name, "canonical", outcome)
}
for (const name of ALIASES) {
  const outcome = await driveCommand(name, `/${name} `)
  record(name, "alias", outcome)
}

// ---------------------------------------------------------------------------
// 3. Dynamic server command: exactly one executeCommand call, no fallback
// ---------------------------------------------------------------------------
{
  await loadPage()
  const postsBefore = commandPosts.length
  const input = page.locator("textarea[data-composer-input]")
  await input.fill("/team/review alpha beta")
  await input.press("Enter")

  const deadline = Date.now() + 3_000
  let observed: QACall[] = []
  while (Date.now() < deadline) {
    observed = await calls()
    if (observed.some((call) => call.kind === "executeCommand")) break
    await sleep(50)
  }
  const executeCalls = observed.filter((call) => call.kind === "executeCommand")
  const promptCalls = observed.filter((call) => call.kind === "sendPrompt")
  const newPosts = commandPosts.slice(postsBefore)
  const first = executeCalls[0]
  const args = first?.args ?? {}
  const ok =
    executeCalls.length === 1 &&
    args.name === "team/review" &&
    args.text === "alpha beta" &&
    Array.isArray(args.skills) &&
    (args.skills as unknown[]).length === 0 &&
    promptCalls.length === 0 &&
    newPosts.length === 1 &&
    newPosts[0]?.name === "team/review" &&
    newPosts[0]?.text === "alpha beta"

  commandResults.push({
    name: "team/review",
    kind: "dynamic",
    status: ok ? "PASS" : "FAIL",
    outcome: ok
      ? "exactly one executeCommand with raw args; one synthetic POST; no fallback prompt"
      : "dynamic command contract violated",
    statusText: await statusText(),
    calls: observed,
    detail: JSON.stringify({ executeCalls, promptCalls: promptCalls.length, newPosts }),
  })
}

// ---------------------------------------------------------------------------
// 4. Stale-catalog freshness cases: selection then stale/removal, no POST
// ---------------------------------------------------------------------------
type StaleMutator = "directory" | "removal"
async function freshnessCase(mutator: StaleMutator) {
  await loadPage()
  const input = page.locator("textarea[data-composer-input]")
  await input.fill("/team/review")
  await input.press("Enter") // selects the server command; does not execute

  const before = await calls()
  const postsBefore = commandPosts.length
  const selected = before.some((call) => call.kind === "executeCommand")
  if (selected) {
    commandResults.push({
      name: `freshness:${mutator}`,
      kind: "freshness",
      status: "FAIL",
      outcome: "executeCommand fired before the catalog was changed",
      calls: before,
    })
    return
  }

  await page.evaluate((which: StaleMutator) => {
    const target = window as unknown as {
      __staleCatalog: () => void
      __setCommandAvailable: (name: string, available: boolean) => void
      __setCatalogEpoch: (epoch: number) => void
      __setCommandsStatus: (status: string) => void
    }
    if (which === "removal") target.__setCommandAvailable("team/review", false)
    else target.__staleCatalog()
    // Also exercise epoch/status hooks so a guard built by another worker is
    // covered regardless of which signal it keys on.
    target.__setCatalogEpoch(99)
    target.__setCommandsStatus("stale")
  }, mutator)

  await input.press("Enter") // submit after the catalog changed
  await sleep(500)

  const after = await calls()
  const executed = after.filter((call) => call.kind === "executeCommand")
  const newPosts = commandPosts.slice(postsBefore)
  const status = await statusText()
  const lower = status.toLowerCase()
  const errorLike =
    /catalog changed|stale|reopen|unknown command|unavailable|changed|reload/i.test(lower) ||
    (await page.locator("#composer-status").getAttribute("role")) === "alert"
  const ok = executed.length === 0 && newPosts.length === 0 && errorLike
  commandResults.push({
    name: `freshness:${mutator}`,
    kind: "freshness",
    status: ok ? "PASS" : "FAIL",
    outcome: ok
      ? "catalog change blocked execution with a clear error and no POST"
      : "catalog change did not block cleanly",
    statusText: status,
    calls: after,
    detail: JSON.stringify({ executed: executed.length, posts: newPosts.length, errorLike }),
  })
}
await freshnessCase("directory")
await freshnessCase("removal")

// ---------------------------------------------------------------------------
// 4b. Native unknown-command rejection: refresh hint, no retry mutation
// ---------------------------------------------------------------------------
{
  await loadPage()
  await page.evaluate(() => {
    const target = window as unknown as { __failNextCommand: () => void }
    target.__failNextCommand()
  })
  const input = page.locator("textarea[data-composer-input]")
  const postsBefore = commandPosts.length
  await input.fill("/team/review ")
  await input.press("Enter")

  const deadline = Date.now() + 3_000
  let observed: QACall[] = []
  let status = ""
  while (Date.now() < deadline) {
    observed = await calls()
    status = await statusText()
    if (/no longer available/i.test(status)) break
    await sleep(50)
  }
  const executeCalls = observed.filter((call) => call.kind === "executeCommand")
  const promptCalls = observed.filter((call) => call.kind === "sendPrompt")
  const reloadCalls = observed.filter((call) => call.kind === "reloadCommands")
  const newPosts = commandPosts.slice(postsBefore)
  const ok =
    executeCalls.length === 1 &&
    newPosts.length === 1 &&
    promptCalls.length === 0 &&
    reloadCalls.length >= 1 &&
    /no longer available/i.test(status)

  commandResults.push({
    name: "unknown-command",
    kind: "freshness",
    status: ok ? "PASS" : "FAIL",
    outcome: ok
      ? "native CommandNotFoundError refreshed the catalog with no retry"
      : "unknown-command handling did not complete cleanly",
    statusText: status,
    calls: observed,
    detail: JSON.stringify({
      executeCalls: executeCalls.length,
      posts: newPosts.length,
      promptCalls: promptCalls.length,
      reloadCalls: reloadCalls.length,
    }),
  })
}

// ---------------------------------------------------------------------------
// 5. HTTPS-gating sweep: no command reported an HTTPS/secure-context block
// ---------------------------------------------------------------------------
const gatingHits = commandResults.filter((result) =>
  /https is required|https only|secure context|requires https|not available over http/i.test(
    result.statusText ?? ""
  )
)
commandResults.push({
  name: "no-https-gating",
  kind: "canonical",
  status: gatingHits.length === 0 && pageErrors.length === 0 ? "PASS" : "FAIL",
  outcome:
    gatingHits.length === 0 && pageErrors.length === 0
      ? "no command blocked by HTTPS gating; no page errors"
      : `gating hits=${gatingHits.length} pageErrors=${JSON.stringify(pageErrors)}`,
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failures = commandResults.filter((result) => result.status === "FAIL")
const summary = {
  total: commandResults.length,
  passed: commandResults.length - failures.length,
  failed: failures.length,
  canonical: CANONICAL.length,
  aliases: ALIASES.length,
  dynamic: 1,
  freshness: 3,
}
const report = {
  generatedAt: new Date().toISOString(),
  base,
  host,
  port: server.port,
  plainHttp,
  summary,
  failures,
  results: commandResults,
}
await writeFile(resultsPath, JSON.stringify(report, null, 2))

await context.close()
await browser.close()
server.stop(true)

console.log(`[http-matrix] URL: ${base}/ (protocol=${plainHttp.protocol ?? "?"}, isSecureContext=${String(plainHttp.isSecureContext)})`)
console.log(`[http-matrix] canonical=${CANONICAL.length} aliases=${ALIASES.length} dynamic=1 freshness=3`)
console.log(`[http-matrix] PASS=${summary.passed} FAIL=${summary.failed} total=${summary.total}`)
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`[http-matrix] FAIL ${failure.kind}:${failure.name} — ${failure.statusText ?? ""} ${failure.detail ?? ""}`)
  }
  console.log(`[http-matrix] results: ${resultsPath}`)
  process.exit(1)
}
console.log(`[http-matrix] results: ${resultsPath}`)
