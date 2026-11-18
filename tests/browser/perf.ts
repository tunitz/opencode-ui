/**
 * Wave 0 performance baseline harness.
 *
 * Run with: bun tests/browser/perf.ts  (or: bun run test:browser:perf)
 *
 * Reuses the synthetic browser machinery from tests/browser: buildFixture()
 * bundles tests/browser/fixture.tsx, a temporary Bun server serves it on an
 * ephemeral 127.0.0.1 port, and the installed Playwright Chromium drives it.
 * No engine, provider, credential, filesystem, or external network is used.
 *
 * Every interaction runs under CDP CPU throttling (6x). Long tasks come from a
 * PerformanceObserver, in-page timing from performance.mark/measure and an INP
 * proxy, row counts from window.__opencodePerf and the rendered DOM.
 *
 * The result is saved to tests/browser/perf-baseline.json as the "before"
 * snapshot for later optimisation waves. Gates are recorded verbatim; a gate
 * failing here is expected in the baseline and is not a harness error.
 */
import { existsSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { chromium, type Page } from "playwright-core"

import { buildFixture } from "./build"

const repoRoot = resolve(import.meta.dir, "../..")
const outDir = await mkdtemp("/tmp/opencode/ui-browser-perf-")
/** Immutable "before" snapshot captured in Wave 0; never overwritten by a run. */
const baselinePath = join(repoRoot, "tests/browser/perf-baseline.json")
/** Mutable latest measurement, safe to overwrite on every run. */
const resultsPath = join(repoRoot, "tests/browser/perf-results.json")
const THROTTLE_RATE = 6

type PerfWindow = Window & {
  __opencodePerf?: {
    enabled: boolean
    counts: Record<string, number>
    longtasks: Array<{ startTime: number; duration: number }>
    marks: Array<{ name: string; at: number; detail?: unknown }>
  }
  __perfNativeCalls?: Record<string, number>
  __inpSamples?: Array<{ at: number; duration: number }>
}

type Metric = {
  name: string
  value: number
  unit: string
  gate: string
  pass: boolean
  fixture: string
  detail?: string
}

const metrics: Metric[] = []
const notes: string[] = []
let pageErrors: string[] = []

function addMetric(
  name: string,
  value: number,
  unit: string,
  gate: string,
  pass: boolean,
  fixture: string,
  detail?: string
) {
  const rounded = Math.round(value * 100) / 100
  metrics.push({ name, value: rounded, unit, gate, pass, fixture, ...(detail ? { detail } : {}) })
}

function fmt(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "n/a"
}

await buildFixture(outDir)

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    // Synthetic auth status: the real Conversation waits for this gate before
    // mounting any messages. No credential or engine is involved.
    if (pathname === "/api/ui/auth/status") {
      return Response.json(
        { configured: true, required: true, authenticated: true },
        { headers: { "cache-control": "no-store" } }
      )
    }
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 })
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
    const filePath = resolve(outDir, relative)
    if (!filePath.startsWith(`${outDir}/`) && filePath !== join(outDir, "index.html")) {
      return new Response("Not found", { status: 404 })
    }
    const file = Bun.file(filePath)
    if (!(await file.exists())) return new Response("Not found", { status: 404 })
    return new Response(file, { headers: { "cache-control": "no-store" } })
  },
})

const base = `http://127.0.0.1:${server.port}`

function findExecutable(): string | null {
  const candidates = [
    process.env.OPENCODE_UI_CHROMIUM,
    join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1255/chrome-linux64/chrome"),
    join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome"),
    join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1247/chrome-linux64/chrome"),
    join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1255/chrome-linux/chrome"),
    join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1248/chrome-linux/chrome"),
  ].filter((entry): entry is string => Boolean(entry))
  return candidates.find((entry) => existsSync(entry)) ?? null
}

const executablePath = findExecutable()
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
let blocker: string | null = null

if (!executablePath) {
  blocker =
    "No installed Chromium executable was found under ~/.cache/ms-playwright; no perf numbers were measured."
} else {
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
}

type PerfRead = {
  counts: Record<string, number>
  longtasks: Array<{ startTime: number; duration: number }>
  marks: Array<{ name: string; at: number }>
  nativeCalls: Record<string, number>
  inpSamples: Array<{ at: number; duration: number }>
  domRows: Record<string, number>
}

async function readPerf(page: Page): Promise<PerfRead> {
  return page.evaluate(() => {
    const target = window as PerfWindow
    const perf = target.__opencodePerf
    const rows: Record<string, number> = {}
    for (const element of document.querySelectorAll<HTMLElement>("[data-perf-row]")) {
      const key = element.dataset.perfRow ?? "unknown"
      rows[key] = (rows[key] ?? 0) + 1
    }
    return {
      counts: { ...(perf?.counts ?? {}) },
      longtasks: (perf?.longtasks ?? []).map((task) => ({ ...task })),
      marks: (perf?.marks ?? []).map((mark) => ({ name: mark.name, at: mark.at })),
      nativeCalls: { ...(target.__perfNativeCalls ?? {}) },
      inpSamples: (target.__inpSamples ?? []).map((sample) => ({ ...sample })),
      domRows: rows,
    }
  })
}

function longTaskSlice(
  state: PerfRead,
  startIndex: number
): { count: number; max: number } {
  const slice = state.longtasks.slice(startIndex)
  return {
    count: slice.length,
    max: slice.reduce((max, task) => Math.max(max, task.duration), 0),
  }
}

async function markAction(page: Page, name: string, action: () => Promise<void>): Promise<number> {
  await page.evaluate((label) => performance.mark(`${label}:start`), name)
  await action()
  return page.evaluate((label) => {
    performance.mark(`${label}:end`)
    performance.measure(label, `${label}:start`, `${label}:end`)
    const entries = performance.getEntriesByName(label, "measure")
    return entries.length ? entries[entries.length - 1].duration : -1
  }, name)
}

async function openFixture(fixture: string) {
  if (!browser) throw new Error("Browser is unavailable.")
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  })
  await context.addInitScript(() => {
    const target = window as PerfWindow
    target.__opencodePerf = { enabled: true, counts: {}, longtasks: [], marks: [] }
    target.__perfNativeCalls = {}
    target.__inpSamples = []
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          target.__opencodePerf?.longtasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          })
        }
      }).observe({ entryTypes: ["longtask"] })
    } catch {
      // Observers are an enhancement; absence must not block the harness.
    }
    // Component-local INP proxy: input event -> the next animation frame, at
    // which point React has committed the controlled-input update.
    document.addEventListener(
      "input",
      () => {
        const at = performance.now()
        requestAnimationFrame(() => {
          target.__inpSamples?.push({ at, duration: performance.now() - at })
        })
      },
      true
    )
  })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    return url.origin === base ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const cdp = await context.newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE_RATE })
  await page.goto(`${base}/?fixture=${encodeURIComponent(fixture)}`, {
    waitUntil: "networkidle",
  })
  await page.locator("[data-fixture]").waitFor({ state: "visible", timeout: 30_000 })
  pageErrors = errors
  return { context, page }
}

async function runModelScenario() {
  const fixture = "perf-models"
  const { context, page } = await openFixture(fixture)
  try {
    let startIndex = (await readPerf(page)).longtasks.length
    const openMs = await markAction(page, "model-open", async () => {
      await page.locator('[data-perf-trigger="Model"]').click()
      await page
        .locator('[data-perf-list="Model"] [data-perf-row="picker"]')
        .first()
        .waitFor({ state: "visible", timeout: 30_000 })
    })
    let state = await readPerf(page)
    let tasks = longTaskSlice(state, startIndex)
    const modelRows = state.domRows.picker ?? 0
    addMetric("model_picker_open_ms", openMs, "ms", "<=150 ms", openMs <= 150, fixture)
    addMetric(
      "model_picker_open_longtask_max_ms",
      tasks.max,
      "ms",
      "<=100 ms",
      tasks.max <= 100,
      fixture
    )
    addMetric(
      "model_dom_rows",
      modelRows,
      "rows",
      "informational (2000 synthetic models)",
      true,
      fixture
    )

    // Favorite toggle: with memoized rows, only the toggled row re-renders.
    const beforeFavorite = state.counts.PickerSelectRow ?? 0
    const nativeBeforeFavorite = state.nativeCalls.models ?? 0
    startIndex = state.longtasks.length
    await page.locator('[data-perf-favorite="provider-0/model-0"]').click()
    state = await readPerf(page)
    const favoriteDelta = (state.counts.PickerSelectRow ?? 0) - beforeFavorite
    addMetric(
      "favorite_toggle_row_render_delta",
      favoriteDelta,
      "renders",
      "flat (no all-row re-render; <=2)",
      favoriteDelta <= 2,
      fixture,
      `native catalog calls unchanged: ${state.nativeCalls.models === nativeBeforeFavorite}`
    )

    // Reopen within TTL: the catalog is cached, so no native call is made.
    await page.keyboard.press("Escape")
    await page.locator('[data-perf-trigger="Model"]').waitFor({ state: "visible" })
    const nativeBeforeReopen = (await readPerf(page)).nativeCalls.models ?? 0
    await page.locator('[data-perf-trigger="Model"]').click()
    await page
      .locator('[data-perf-list="Model"] [data-perf-row="picker"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
    state = await readPerf(page)
    const nativeReopenDelta = (state.nativeCalls.models ?? 0) - nativeBeforeReopen
    addMetric(
      "reopen_within_ttl_native_calls",
      nativeReopenDelta,
      "calls",
      "= 0 native calls",
      nativeReopenDelta === 0,
      fixture,
      `cumulative catalog calls: ${state.nativeCalls.models ?? 0}`
    )

    // Type an 8-character query. The INP proxy is captured in-page.
    const beforeInp = state.inpSamples.length
    startIndex = state.longtasks.length
    const search = page.locator('[data-perf-search="Model"]')
    const keyTimes: number[] = []
    for (const character of "abcdefgh") {
      keyTimes.push(
        await markAction(page, `key-${character}`, async () => {
          await search.press(character)
        })
      )
    }
    state = await readPerf(page)
    const inp = state.inpSamples.slice(beforeInp)
    const inpAvg = inp.length
      ? inp.reduce((sum, sample) => sum + sample.duration, 0) / inp.length
      : keyTimes.reduce((sum, time) => sum + time, 0) / Math.max(keyTimes.length, 1)
    tasks = longTaskSlice(state, startIndex)
    const actionAvg = keyTimes.reduce((sum, time) => sum + time, 0) / Math.max(keyTimes.length, 1)
    addMetric(
      "query_per_keystroke_inp_ms",
      inpAvg,
      "ms",
      "<=50 ms",
      inpAvg <= 50,
      fixture,
      `${inp.length} in-page samples; automation-inclusive action avg ${fmt(actionAvg)} ms`
    )
    addMetric(
      "query_longtasks",
      tasks.count,
      "tasks",
      "zero long tasks",
      tasks.count === 0,
      fixture,
      `max ${fmt(tasks.max)} ms`
    )
    addMetric(
      "query_filtered_dom_rows",
      state.domRows.picker ?? 0,
      "rows",
      "informational",
      true,
      fixture
    )
  } finally {
    await context.close()
  }
}

async function runAgentScenario() {
  const fixture = "perf-agents"
  const { context, page } = await openFixture(fixture)
  try {
    const startIndex = (await readPerf(page)).longtasks.length
    const openMs = await markAction(page, "agent-open", async () => {
      await page.locator('[data-perf-trigger="Agent"]').click()
      await page
        .locator('[data-perf-list="Agent"] [data-perf-row="picker"]')
        .first()
        .waitFor({ state: "visible", timeout: 30_000 })
    })
    const state = await readPerf(page)
    const tasks = longTaskSlice(state, startIndex)
    addMetric("agent_picker_open_ms", openMs, "ms", "<=150 ms", openMs <= 150, fixture)
    addMetric(
      "agent_picker_open_longtask_max_ms",
      tasks.max,
      "ms",
      "<=100 ms",
      tasks.max <= 100,
      fixture
    )
    addMetric(
      "agent_dom_rows",
      state.domRows.picker ?? 0,
      "rows",
      "informational (200 synthetic agents)",
      true,
      fixture
    )
  } finally {
    await context.close()
  }
}

async function runWorktreeScenario() {
  const fixture = "perf-worktrees"
  const { context, page } = await openFixture(fixture)
  try {
    const openMs = await markAction(page, "worktree-open", async () => {
      await page.locator("[data-perf-browse]").click()
      await page.locator('[data-perf-list="worktrees"]').waitFor({ state: "visible" })
    })
    let state = await readPerf(page)
    const openRows = state.domRows.worktree ?? 0

    const filterMs = await markAction(page, "worktree-filter", async () => {
      await page.locator('[data-perf-filter="worktrees"]').fill("0007")
      await page.waitForFunction(
        () => document.querySelectorAll('[data-perf-row="worktree"]').length < 1_500,
        undefined,
        { timeout: 30_000 }
      )
    })
    state = await readPerf(page)
    const filteredRows = state.domRows.worktree ?? 0
    const combined = openMs + filterMs
    addMetric(
      "worktree_browse_filter_ms",
      combined,
      "ms",
      "<=150 ms",
      combined <= 150,
      fixture,
      `open ${fmt(openMs)} ms + filter ${fmt(filterMs)} ms`
    )
    addMetric(
      "worktree_dom_rows",
      filteredRows,
      "rows",
      "bounded DOM rows (<=500 after filter)",
      filteredRows <= 500,
      fixture,
      `open rendered ${openRows} rows`
    )
    addMetric(
      "worktree_longtask_max_ms",
      longTaskSlice(state, 0).max,
      "ms",
      "informational",
      true,
      fixture
    )
  } finally {
    await context.close()
  }
}

async function runNotesScenario() {
  const fixture = "perf-notes"
  const { context, page } = await openFixture(fixture)
  try {
    let state = await readPerf(page)
    const renderedRows = state.domRows.note ?? 0
    const startIndex = state.longtasks.length
    await page.locator('[data-perf-filter="notes"]').fill("0999")
    await page.waitForFunction(
      () => document.querySelectorAll('[data-perf-row="note"]').length < 1_000,
      undefined,
      { timeout: 30_000 }
    )
    state = await readPerf(page)
    const tasks = longTaskSlice(state, startIndex)
    addMetric(
      "notes_dom_rows",
      renderedRows,
      "rows",
      "informational (1000 synthetic notes)",
      true,
      fixture
    )
    addMetric(
      "notes_row_renders",
      state.counts.NotesRow ?? 0,
      "renders",
      "informational",
      true,
      fixture
    )
    addMetric(
      "notes_filter_longtask_max_ms",
      tasks.max,
      "ms",
      "informational",
      true,
      fixture
    )
  } finally {
    await context.close()
  }
}

async function runMessagesScenario() {
  const fixture = "perf-messages"
  const { context, page } = await openFixture(fixture)
  try {
    // The transcript renders on mount; the observer was installed by the init
    // script before navigation, so these long tasks cover that first render.
    const state = await readPerf(page)
    const tasks = longTaskSlice(state, 0)
    addMetric(
      "messages_longtask_max_ms",
      tasks.max,
      "ms",
      "<=100 ms",
      tasks.max <= 100,
      fixture,
      `${tasks.count} long task(s) during the 1k-message mount (includes page load)`
    )
    addMetric(
      "messages_assistant_renders",
      state.counts.AssistantMessage ?? 0,
      "renders",
      "informational",
      true,
      fixture
    )
  } finally {
    await context.close()
  }
}

let status: "measured" | "unmeasured" = "unmeasured"
try {
  if (blocker) {
    console.log(`[perf] BLOCKED: ${blocker}`)
  } else {
    await runModelScenario()
    await runAgentScenario()
    await runWorktreeScenario()
    await runNotesScenario()
    await runMessagesScenario()
    status = "measured"
  }
} finally {
  await server.stop(true)
  if (browser) await browser.close()
}

const result = {
  status,
  throttleRate: THROTTLE_RATE,
  generatedAt: new Date().toISOString(),
  browser: executablePath ? "installed Playwright Chromium" : "unavailable",
  fixtureDir: outDir,
  ...(blocker ? { blocker } : {}),
  metrics,
  ...(notes.length ? { notes } : {}),
  ...(pageErrors.length ? { pageErrors } : {}),
}

await writeFile(resultsPath, `${JSON.stringify(result, null, 2)}\n`)

console.log("\n[perf] Wave 0 baseline (CPU throttle 6x)")
console.log("[perf] " + "-".repeat(72))
console.log(
  "[perf] " +
    "metric".padEnd(34) +
    "value".padStart(10) +
    "  gate".padEnd(30) +
    "  status"
)
for (const metric of metrics) {
  console.log(
    "[perf] " +
      metric.name.padEnd(34) +
      `${fmt(metric.value)} ${metric.unit}`.padStart(10) +
      "  " +
      metric.gate.padEnd(30) +
      "  " +
      (metric.pass ? "PASS" : "FAIL")
  )
}
console.log("[perf] " + "-".repeat(72))

// Compare against the immutable Wave 0 snapshot so regressions and wins are
// visible without ever rewriting the baseline file.
try {
  const baseline = JSON.parse(await Bun.file(baselinePath).text()) as {
    metrics?: Array<{ name: string; value: number; unit: string }>
  }
  const before = new Map(
    (baseline.metrics ?? []).map((metric) => [metric.name, metric.value])
  )
  console.log("[perf] delta vs baseline:")
  for (const metric of metrics) {
    const prior = before.get(metric.name)
    if (prior === undefined) continue
    const delta = metric.value - prior
    const pct = prior === 0 ? "n/a" : `${((delta / prior) * 100).toFixed(1)}%`
    console.log(
      `[perf]   ${metric.name.padEnd(34)} ${fmt(prior)} -> ${fmt(metric.value)} ${metric.unit} (${delta >= 0 ? "+" : ""}${pct})`
    )
  }
} catch {
  console.log("[perf] baseline comparison unavailable")
}

console.log(`[perf] results written to ${resultsPath}`)
console.log(`[perf] fixture build retained at ${outDir}`)
