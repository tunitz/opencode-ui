/**
 * Synthetic browser interaction checks for OpenCode UI.
 *
 * Run with: bun tests/browser/run.ts
 *
 * The runner builds the fixture, serves it from 127.0.0.1 on an ephemeral port,
 * answers only synthetic same-origin API reads, and drives the installed
 * Playwright Chromium. It never connects to an engine, provider, live session,
 * or external service. Results are written to a fresh fixture directory under
 * /tmp/opencode.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { chromium, type Browser, type Locator, type Page } from "playwright-core"

import { buildFixture } from "./build"

const repoRoot = resolve(import.meta.dir, "../..")
const outDir = await mkdtemp("/tmp/opencode/ui-browser-fixture-")
const resultPath = join(outDir, "results.json")
const shotDir = join("/tmp/opencode/shots", basename(outDir))

type ApiRequest = { method: string; path: string; projectID: string | null }
type Step = { name: string; ok: boolean; detail?: string }
type Result = {
  name: string
  status: "PASS" | "FAIL" | "BLOCKED"
  steps: Step[]
  pageErrors: string[]
  consoleErrors: string[]
  blocker?: string
  screenshot?: string
}

const requests: ApiRequest[] = []
const notFound: string[] = []
const results: Result[] = []

const syntheticNotes = [
  {
    id: "note-plan",
    spaceID: "space-work",
    title: "Release plan",
    body: `# Release plan

Ship the notes workspace with a container-aware layout, verified previews, and safe attachments.

## Steps

- Land the layout fix
- Verify on every viewport
- Deploy

${"Detail line. ".repeat(80)}`,
    status: "in-progress" as const,
    pinned: true,
    attachments: [],
    revision: 2,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "note-bugs",
    spaceID: "space-work",
    title: "Bugs",
    body: "Clicking the chevron twice should not be needed.\n\n**Fixed** in the row controls.",
    status: "todo" as const,
    pinned: false,
    attachments: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "note-shipped",
    spaceID: null,
    title: "Shipped",
    body: "# Shipped\n\nEverything verified end to end.",
    status: "finished" as const,
    pinned: false,
    attachments: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

const syntheticSpaces = [
  { id: "space-work", name: "Work", kind: "planning", project: null, pinned: false, revision: 1, createdAt: 1, updatedAt: 1 },
]

const syntheticDiff = {
  data: [
    {
      file: "src/app.ts",
      patch:
        "@@ -1,2 +1,3 @@\n const synthetic = true\n-old value\n+new value\n+added value\n",
      additions: 2,
      deletions: 1,
      status: "modified" as const,
    },
    {
      file: "src/deleted.ts",
      patch: "@@ -1 +0,0 @@\n-removed\n",
      additions: 0,
      deletions: 1,
      status: "deleted" as const,
    },
    {
      file: "../unsafe.ts",
      patch: "@@ -1 +1 @@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    },
  ],
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  })
}

await buildFixture(outDir)

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === "/api/plugin") {
      if (url.search.includes("synthetic%2Fnotes") || url.search.includes("synthetic/notes"))
        return json({
          location: { directory: "/synthetic/notes" },
          data: [
            {
              id: "opencode-notes",
              source: { type: "local", path: "/synthetic/plugin" },
              features: { server: true, rpc: true },
              state: { status: "active" },
            },
          ],
        })
      return json({ location: { directory: "/synthetic/alpha" }, data: [] })
    }
    if (pathname === "/api/rpc/opencode-notes/list") {
      const body = await request.json().catch(() => ({}))
      const input = (body as { input?: Record<string, unknown> }).input ?? {}
      const pinned = input.pinned === true
      const status = typeof input.status === "string" ? input.status : null
      const filtered = syntheticNotes.filter(
        (note) => (!pinned || note.pinned) && (!status || note.status === status)
      )
      const offset = typeof input.offset === "number" ? input.offset : 0
      const limit = typeof input.limit === "number" ? input.limit : 500
      const page = filtered.slice(offset, offset + limit)
      return json({
        output: {
          notes:
            input.includeBodies === false
              ? page.map((note) => ({ ...note, body: "" }))
              : page,
          total: filtered.length,
        },
      })
    }
    if (pathname === "/api/rpc/opencode-notes/spaces") {
      return json({ output: { spaces: syntheticSpaces, total: syntheticSpaces.length } })
    }
    if (pathname === "/api/rpc/opencode-notes/update") {
      const body = await request.json().catch(() => ({}))
      const input = (body as { input?: Record<string, unknown> }).input ?? {}
      const existing = syntheticNotes.find((note) => note.id === input.noteID)
      return json({
        output: {
          note: {
            ...(existing ?? syntheticNotes[0]),
            ...input,
            revision: (existing?.revision ?? 1) + 1,
            updatedAt: (existing?.updatedAt ?? 1) + 1,
          },
        },
      })
    }
    if (pathname === "/api/worktree") {
      requests.push({
        method: request.method,
        path: pathname,
        projectID: url.searchParams.get("projectID"),
      })
      if (request.method !== "GET") return json({ message: "Synthetic read-only route." }, 405)
      return json([
        {
          directory: "/synthetic/worktrees/alpha",
          strategy: "git",
        },
      ])
    }
    if (pathname === "/api/vcs/diff") {
      return json(syntheticDiff)
    }
    if (pathname === "/api/vcs") {
      return json({ data: { branch: { current: "synthetic-main" } } })
    }
    if (pathname === "/api/fs/list") {
      return json({
        data: [
          { path: "src", type: "directory" },
          { path: "README.md", type: "file" },
        ],
      })
    }
    if (pathname === "/api/fs/find") {
      return json({ data: [{ path: "src/app.ts", type: "file" }] })
    }
    if (pathname === "/api/fs/read/src/app.ts") {
      const text = "export const synthetic = true\n"
      return new Response(text, {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "content-length": String(Buffer.byteLength(text)),
        },
      })
    }
    if (pathname.startsWith("/api/")) {
      notFound.push(pathname)
      return json({ message: "Synthetic route not configured." }, 404)
    }
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 })
    if (pathname.startsWith("/node_modules/")) {
      const assetPath = resolve(repoRoot, pathname.slice(1))
      if (assetPath.startsWith(`${repoRoot}/node_modules/`)) {
        const asset = Bun.file(assetPath)
        if (await asset.exists()) return new Response(asset)
      }
      notFound.push(pathname)
      return new Response("Not found", { status: 404 })
    }

    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
    const filePath = resolve(outDir, relative)
    if (!filePath.startsWith(`${outDir}/`) && filePath !== join(outDir, "index.html")) {
      notFound.push(pathname)
      return new Response("Not found", { status: 404 })
    }
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      notFound.push(pathname)
      return new Response("Not found", { status: 404 })
    }
    return new Response(file)
  },
})

const base = `http://127.0.0.1:${server.port}`
await mkdir(shotDir, { recursive: true })

function findExecutable() {
  const candidates = [
    process.env.OPENCODE_UI_CHROMIUM,
    join(
      process.env.HOME ?? "",
      ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
    ),
    join(
      process.env.HOME ?? "",
      ".cache/ms-playwright/chromium-1247/chrome-linux64/chrome"
    ),
    join(
      process.env.HOME ?? "",
      ".cache/ms-playwright/chromium-1248/chrome-linux/chrome"
    ),
  ].filter((entry): entry is string => Boolean(entry))
  return candidates.find((entry) => existsSync(entry)) ?? null
}

const executablePath = findExecutable()
let browser: Browser | null = null
let blocker: string | null = null

if (!executablePath) {
  blocker =
    "No installed Chromium executable was found under ~/.cache/ms-playwright; no browser tests ran."
} else {
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function poll<T>(
  fn: () => Promise<T | null | undefined | false>,
  message: string,
  timeout = 5_000
): Promise<T> {
  const deadline = Date.now() + timeout
  let last: unknown = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value as T
      last = value
    } catch (error) {
      last = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error(`${message} (last value: ${String(last)})`)
}

let currentPage: Page | null = null

async function openPage(
  viewport: { width: number; height: number },
  fixture: string,
  storage?: Record<string, string>,
  options: { hasTouch?: boolean; reducedMotion?: "reduce" | "no-preference"; dir?: "ltr" | "rtl" } = {}
) {
  assert(browser, "Browser is unavailable.")
  const context = await browser.newContext({
    viewport,
    reducedMotion: options.reducedMotion ?? "no-preference",
    locale: "en-US",
    timezoneId: "UTC",
    hasTouch: options.hasTouch ?? false,
  })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    return url.origin === base ? route.continue() : route.abort()
  })
  if (storage || options.dir) {
    await context.addInitScript(
      ({ entries, dir }) => {
        if (dir) document.documentElement.setAttribute("dir", dir)
        for (const [key, value] of Object.entries(entries ?? {})) {
          window.localStorage.setItem(key, value)
        }
      },
      { entries: storage, dir: options.dir }
    )
  }
  const page = await context.newPage()
  currentPage = page
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.goto(`${base}/?fixture=${encodeURIComponent(fixture)}`, {
    waitUntil: "networkidle",
  })
  await page.locator("[data-fixture]").waitFor({ state: "visible", timeout: 10_000 })
  return { context, page, pageErrors, consoleErrors }
}

async function resetQa(page: Page) {
  await page.evaluate(() => {
    const qa = (window as unknown as { __qa: { calls: unknown[]; openedFiles: unknown[]; navigations: unknown[] } }).__qa
    qa.calls.length = 0
    qa.openedFiles.length = 0
    qa.navigations.length = 0
  })
}

async function qaCalls(page: Page): Promise<{ kind: string; value?: string }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qa: { calls: { kind: string; value?: string }[] } }).__qa
        .calls
  )
}

async function activeElement(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    return {
      tag: element?.tagName ?? null,
      ariaLabel: element?.getAttribute("aria-label") ?? null,
      title: element?.getAttribute("title") ?? null,
      text: element?.textContent?.trim().slice(0, 120) ?? null,
    }
  })
}

async function settledEdge(
  page: Page,
  locator: Locator,
  edge: "left" | "bottom"
) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error("Viewport is unavailable")
  return poll(
    async () => {
      const value = await locator.boundingBox()
      if (!value) return null
      if (edge === "left") return Math.abs(value.x) <= 1 ? value : null
      return Math.abs(value.y + value.height - viewport.height) <= 1
        ? value
        : null
    },
    `sheet did not settle at the ${edge} edge`
  )
}

async function run(
  name: string,
  work: (tools: {
    steps: Step[]
    check: (step: string, condition: unknown, detail?: string) => void
  }) => Promise<void>
) {
  if (!browser) {
    results.push({
      name,
      status: "BLOCKED",
      steps: [],
      pageErrors: [],
      consoleErrors: [],
      blocker: blocker ?? undefined,
    })
    return
  }
  const steps: Step[] = []
  currentPage = null
  currentDiagnostics = { pageErrors: [], consoleErrors: [] }
  try {
    await work({
      steps,
      check(step, condition, detail) {
        const ok = Boolean(condition)
        steps.push({ name: step, ok, detail })
        if (!ok) throw new Error(`${step}${detail ? `: ${detail}` : ""}`)
      },
    })
    results.push({
      name,
      status: "PASS",
      steps,
      pageErrors: [...currentDiagnostics.pageErrors],
      consoleErrors: [...currentDiagnostics.consoleErrors],
    })
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error)
    steps.push({ name: "failure", ok: false, detail: failure })
    let screenshot: string | undefined
    const pageAtFailure = currentPage as unknown as Page | null
    if (pageAtFailure) {
      screenshot = join(shotDir, `${name.replace(/[^a-z0-9]+/gi, "-")}.png`)
      await pageAtFailure
        .screenshot({ path: screenshot, fullPage: true })
        .catch(() => undefined)
    }
    results.push({
      name,
      status: "FAIL",
      steps,
      pageErrors: [...currentDiagnostics.pageErrors],
      consoleErrors: [...currentDiagnostics.consoleErrors],
      screenshot,
    })
  }
}

let currentDiagnostics: { pageErrors: string[]; consoleErrors: string[] } = {
  pageErrors: [],
  consoleErrors: [],
}

function mergeDiagnostics(
  _result: Result | undefined,
  diagnostics: { pageErrors: string[]; consoleErrors: string[] }
) {
  currentDiagnostics.pageErrors.push(...diagnostics.pageErrors)
  currentDiagnostics.consoleErrors.push(...diagnostics.consoleErrors)
}

// ---------------------------------------------------------------------------
// Desktop session navigation
// ---------------------------------------------------------------------------
if (browser) {
  await run("desktop session navigation, tree expansion, date grouping and local labels", async ({ check }) => {
    const opened = await openPage({ width: 1280, height: 900 }, "nav")
    const page = opened.page
    try {
      await resetQa(page)
      await page.locator("aside").waitFor({ state: "visible" })
      await page.getByText("Alpha", { exact: true }).waitFor({ state: "visible" })

      const sidebarVisible = await page.locator("aside").isVisible()
      check("desktop sidebar is visible", sidebarVisible)

      const alphaRow = page.locator('button[title="s-alpha"]')
      const alphaBox = await alphaRow.boundingBox()
      check("session row is at least 44px tall", (alphaBox?.height ?? 0) >= 44, `height=${alphaBox?.height}`)

      const expand = page.getByRole("button", {
        name: "Show 1 loaded subagent session for Alpha",
      })
      check("subagent expand control is visible", await expand.isVisible())
      check(
        "subagent expand control owns its hit target",
        await expand.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          )
          return Boolean(hit && (hit === node || node.contains(hit)))
        })
      )
      await expand.click()
      check(
        "subagent row is shown after expansion",
        await page.locator('button[title="s-beta"]').isVisible()
      )
      const collapse = page.getByRole("button", {
        name: "Hide 1 loaded subagent session for Alpha",
      })
      check(
        "subagent expand control reports expanded",
        (await collapse.getAttribute("aria-expanded")) === "true"
      )

      await page.locator('button[title="s-beta"]').click()
      await page.getByText("Active: s-beta").waitFor({ state: "visible" })
      const callsAfterSelect = await qaCalls(page)
      check(
        "selecting a nested session calls selectSession with its id",
        callsAfterSelect.some(
          (call) => call.kind === "selectSession" && call.value === "s-beta"
        ),
        JSON.stringify(callsAfterSelect)
      )

      check(
        "desktop sidebar no longer duplicates the parent return control",
        (await page.locator("aside").getByRole("button", { name: "Return to parent session" }).count()) === 0
      )
      await page.locator('button[title="s-alpha"]').click()
      await page.getByText("Active: s-alpha").waitFor({ state: "visible" })
      check(
        "pinned group is hidden when no session is pinned",
        (await page.getByRole("button", { name: /^Pinned sessions/ }).count()) === 0
      )

      await page.getByRole("button", { name: "Session actions: Alpha" }).click()
      await page.getByRole("menuitem", { name: "Pin session" }).click()
      const storage = await page.evaluate(() => {
        const key = `opencode-ui:session-shortcuts:v1:${encodeURIComponent(
          window.location.origin
        )}:${encodeURIComponent("2.1.4")}`
        return { key, value: window.localStorage.getItem(key) }
      })
      check(
        "pinning writes only the browser-local scoped shortcut record",
        Boolean(storage.value && JSON.parse(storage.value)["s-alpha"]?.pinned === true),
        `${storage.key}=${storage.value}`
      )

      await page.getByRole("button", { name: "Session actions: Alpha" }).click()
      await page.getByRole("menuitem", { name: "Edit local label" }).click()
      await page.getByRole("heading", { name: "Edit local label" }).waitFor()
      await page.getByLabel("Local session label").fill("Synthetic label")
      await page.getByRole("button", { name: "Save label" }).click()
      await page.getByText("Synthetic label", { exact: true }).waitFor({ state: "visible" })
      const labelRecord = await page.evaluate(() => {
        const key = `opencode-ui:session-shortcuts:v1:${encodeURIComponent(
          window.location.origin
        )}:${encodeURIComponent("2.1.4")}`
        return JSON.parse(window.localStorage.getItem(key) ?? "{}")
      })
      check(
        "local label is stored in the scoped browser-local record",
        labelRecord["s-alpha"]?.label === "Synthetic label",
        JSON.stringify(labelRecord)
      )

      const pinnedGroup = page.getByRole("button", { name: /^Pinned sessions/ })
      check(
        "pinned group appears once a session is pinned",
        await pinnedGroup.isVisible()
      )
      await pinnedGroup.click()
      check(
        "pinned sessions still show in their date group",
        (await page.locator('button[title="s-alpha"]').count()) === 2,
        `rows=${await page.locator('button[title="s-alpha"]').count()}`
      )
      await pinnedGroup.click()

      const yesterday = page.getByRole("button", { name: "Yesterday" })
      await yesterday.waitFor({ state: "visible" })
      await yesterday.click()
      check(
        "date grouping keeps older sessions reachable",
        await page.locator('button[title="s-gamma"]').isVisible()
      )

      const sidebar = page.locator('[data-sidebar="sessions"]')
      await page.getByRole("button", { name: "Collapse sidebar" }).click()
      await page.waitForFunction(() => {
        const element = document.querySelector('[data-sidebar="sessions"]')
        return element ? element.getBoundingClientRect().width < 100 : false
      })
      const collapsedBox = await sidebar.boundingBox()
      check(
        "collapsing the desktop sidebar leaves an icon rail",
        (collapsedBox?.width ?? Number.POSITIVE_INFINITY) < 100 &&
          (await page.locator('button[title="s-alpha"]').count()) === 0
      )
      await page.getByRole("button", { name: "Expand sidebar" }).click()
      await page.waitForFunction(() => {
        const element = document.querySelector('[data-sidebar="sessions"]')
        return element ? element.getBoundingClientRect().width > 260 : false
      })
      check(
        "expanding the desktop sidebar restores the session list",
        await page.locator('button[title="s-alpha"]').isVisible()
      )

      await page.getByRole("button", { name: /^Pinned sessions/ }).click()
      await page.getByRole("button", { name: "Session actions: Alpha" }).first().click()
      await page.getByRole("menuitem", { name: "Unpin session" }).click()
      check(
        "pinned group disappears when the last pinned session is unpinned",
        (await page.getByRole("button", { name: /^Pinned sessions/ }).count()) === 0
      )

      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("desktop session navigation"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Desktop and mobile project worktrees entry + focus
// ---------------------------------------------------------------------------
if (browser) {
  await run("desktop project worktrees entry uses the explicit active project id and restores focus", async ({ check }) => {
    const opened = await openPage({ width: 1280, height: 900 }, "nav")
    const page = opened.page
    try {
      requests.length = 0
      const entry = page.getByRole("button", { name: "Project worktrees" })
      await entry.waitFor({ state: "visible" })
      const entryBox = await entry.boundingBox()
      check("desktop worktrees entry is at least 44px tall", (entryBox?.height ?? 0) >= 44, `height=${entryBox?.height}`)
      await entry.click()

      const heading = page.getByRole("heading", { name: "Worktrees" })
      await heading.waitFor({ state: "visible" })
      const dialog = page.locator('[data-slot="dialog-content"]').filter({ has: heading })
      check("desktop worktrees surface is a centered dialog", await dialog.isVisible())

      const request = await poll(
        async () => requests.find((entryRequest) => entryRequest.path === "/api/worktree"),
        "synthetic worktree list request was not observed"
      )
      check(
        "worktree list passes the active session project id explicitly",
        request.projectID === "p-alpha",
        `projectID=${request.projectID}`
      )
      check(
        "worktree list is read-only in this fixture",
        requests.every((entryRequest) => entryRequest.method === "GET"),
        JSON.stringify(requests)
      )
      await page.getByText("/synthetic/worktrees/alpha").waitFor({ state: "visible" })

      await page.getByRole("button", { name: "Close", exact: true }).first().click()
      await dialog.waitFor({ state: "detached" })
      const focused = await activeElement(page)
      check(
        "closing worktrees returns focus to the Project worktrees entry",
        focused.text === "Project worktrees",
        JSON.stringify(focused)
      )

      requests.length = 0
      await page.getByRole("button", { name: "Set project scope" }).click()
      await page.getByText("Active: s-alpha").waitFor({ state: "visible" })
      await page.getByRole("button", { name: "Project worktrees" }).click()
      await page.getByRole("heading", { name: "Worktrees" }).waitFor({ state: "visible" })
      const scopedRequest = await poll(
        async () => requests.find((entryRequest) => entryRequest.path === "/api/worktree"),
        "scoped worktree request was not observed"
      )
      check(
        "project scope passes the selected project id instead of the active session project",
        scopedRequest.projectID === "p-location",
        `projectID=${scopedRequest.projectID}`
      )
      await page.getByRole("button", { name: "Close", exact: true }).first().click()
      await page.getByRole("heading", { name: "Worktrees" }).waitFor({ state: "detached" })
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("desktop project worktrees"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("mobile sessions sheet navigation, sheet closure and project worktrees focus", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "nav")
    const page = opened.page
    try {
      await resetQa(page)
      requests.length = 0
      const sheetTrigger = page.getByRole("button", { name: "Open sessions" })
      await sheetTrigger.waitFor({ state: "visible" })
      const triggerBox = await sheetTrigger.boundingBox()
      check(
        "mobile sessions trigger is a 44px touch target",
        (triggerBox?.width ?? 0) >= 44 && (triggerBox?.height ?? 0) >= 44,
        JSON.stringify(triggerBox)
      )
      check("desktop sidebar is hidden at 390px", !(await page.locator("aside").isVisible()))

      await sheetTrigger.click()
      const sessionsSheet = page.locator('[data-slot="sheet-content"][data-side="left"]')
      await sessionsSheet.waitFor({ state: "visible" })
      const sheetBox = await poll(
        async () => {
          const value = await sessionsSheet.boundingBox()
          return value && Math.abs(value.x) <= 1 ? value : null
        },
        "mobile sessions sheet did not settle at the left edge"
      )
      check(
        "mobile sessions sheet enters from the left and stays within the viewport",
        Boolean(sheetBox && Math.abs(sheetBox.x) <= 1 && sheetBox.width <= 390 && sheetBox.height >= 800),
        JSON.stringify(sheetBox)
      )
      const mobileAlpha = sessionsSheet.locator('button[title="s-alpha"]')
      const mobileRowBox = await mobileAlpha.boundingBox()
      check(
        "mobile session row remains a 44px touch target",
        (mobileRowBox?.height ?? 0) >= 44,
        `height=${mobileRowBox?.height}`
      )

      await mobileAlpha.click()
      await sessionsSheet.waitFor({ state: "hidden" })
      const calls = await qaCalls(page)
      check(
        "selecting a session in the mobile sheet calls selectSession and closes the sheet",
        calls.some(
          (call) => call.kind === "selectSession" && call.value === "s-alpha"
        ) && !(await sessionsSheet.isVisible()),
        JSON.stringify(calls)
      )
      const focusAfterSelection = await activeElement(page)
      check(
        "closing the sessions sheet returns focus to its trigger",
        focusAfterSelection.ariaLabel === "Open sessions",
        JSON.stringify(focusAfterSelection)
      )

      await sheetTrigger.click()
      await sessionsSheet.waitFor({ state: "visible" })
      await page.evaluate(() => {
        const state: {
          dialogSeen: boolean
          sheetVisibleAtDialog: boolean | null
        } = { dialogSeen: false, sheetVisibleAtDialog: null }
        ;(window as unknown as { __qaWorktreeOrder: typeof state }).__qaWorktreeOrder =
          state
        const isVisible = (element: Element) =>
          (element as HTMLElement).getClientRects().length > 0
        const check = () => {
          if (state.dialogSeen) return
          const left = document.querySelector(
            '[data-slot="sheet-content"][data-side="left"]'
          )
          const worktrees = [
            ...document.querySelectorAll(
              '[data-slot="sheet-content"][data-side="bottom"]'
            ),
          ].find((element) => element.textContent?.includes("Worktrees"))
          if (!worktrees) return
          state.dialogSeen = true
          state.sheetVisibleAtDialog = Boolean(left && isVisible(left))
        }
        const observer = new MutationObserver(check)
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["data-starting-style", "data-ending-style", "style", "class"],
        })
        ;(window as unknown as { __qaWorktreeObserver: MutationObserver }).__qaWorktreeObserver =
          observer
        check()
      })
      const worktreesEntry = sessionsSheet.getByRole("button", {
        name: "Project worktrees",
      })
      await worktreesEntry.click()
      await sessionsSheet.waitFor({ state: "hidden" })

      const heading = page.getByRole("heading", { name: "Worktrees" })
      await heading.waitFor({ state: "visible" })
      const order = await page.evaluate(
        () =>
          (
            window as unknown as {
              __qaWorktreeOrder: {
                dialogSeen: boolean
                sheetVisibleAtDialog: boolean | null
              }
            }
          ).__qaWorktreeOrder
      )
      check(
        "worktrees surface appears only after the mobile sessions sheet is no longer visible",
        order.dialogSeen && order.sheetVisibleAtDialog === false,
        JSON.stringify(order)
      )
      const worktreeRequest = await poll(
        async () => requests.find((entryRequest) => entryRequest.path === "/api/worktree"),
        "mobile worktree request was not observed"
      )
      check(
        "mobile worktree entry passes the explicit active project id",
        worktreeRequest.projectID === "p-alpha",
        `projectID=${worktreeRequest.projectID}`
      )
      const worktreeSheet = page.locator('[data-slot="sheet-content"][data-side="bottom"]')
        .filter({ has: heading })
      const worktreeBox = await settledEdge(page, worktreeSheet, "bottom")
      check(
        "mobile worktrees surface opens only after the sessions sheet closed and as a bottom sheet",
        (await sessionsSheet.isVisible()) === false &&
          Boolean(worktreeBox && Math.abs((worktreeBox.y + worktreeBox.height) - 844) <= 1 && worktreeBox.width === 390),
        JSON.stringify(worktreeBox)
      )

      await worktreeSheet.getByRole("button", { name: "Close", exact: true }).first().click()
      await worktreeSheet.waitFor({ state: "detached" })
      const focusAfterWorktrees = await activeElement(page)
      check(
        "closing mobile worktrees leaves focus on a visible control (not the closed sheet)",
        focusAfterWorktrees.tag !== "BODY" && Boolean(focusAfterWorktrees.ariaLabel || focusAfterWorktrees.text),
        JSON.stringify(focusAfterWorktrees)
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("mobile sessions sheet"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Mobile rename/label dialogs anchor and restore focus
// ---------------------------------------------------------------------------
if (browser) {
  await run("mobile rename dialog is a bottom sheet and restores focus to session actions", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "nav")
    const page = opened.page
    try {
      await page.getByRole("button", { name: "Open sessions" }).click()
      const sheet = page.locator('[data-slot="sheet-content"][data-side="left"]')
      await sheet.waitFor({ state: "visible" })
      await sheet.getByRole("button", { name: "Session actions: Alpha" }).click()
      await page.getByRole("menuitem", { name: /Rename session/ }).click()
      const heading = page.getByRole("heading", { name: "Rename session" })
      await heading.waitFor({ state: "visible" })
      const renameSheet = page.locator('[data-slot="sheet-content"][data-side="bottom"]')
        .filter({ has: heading })
      const renameBox = await settledEdge(page, renameSheet, "bottom")
      check(
        "mobile rename uses a bottom sheet anchored to the viewport bottom",
        Boolean(renameBox && Math.abs((renameBox.y + renameBox.height) - 844) <= 1),
        JSON.stringify(renameBox)
      )
      check(
        "rename sheet keeps the sessions sheet context behind it",
        await sheet.isVisible()
      )
      await renameSheet.getByRole("button", { name: "Cancel" }).click()
      await renameSheet.waitFor({ state: "detached" })
      const focus = await activeElement(page)
      check(
        "cancelling rename returns focus to the session actions button",
        focus.ariaLabel === "Session actions: Alpha",
        JSON.stringify(focus)
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("mobile rename dialog"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Command center
// ---------------------------------------------------------------------------
if (browser) {
  await run("desktop command center shortcut, search selection and focus return", async ({ check }) => {
    const opened = await openPage({ width: 1280, height: 900 }, "command")
    const page = opened.page
    try {
      await resetQa(page)
      const trigger = page.getByRole("button", { name: "Open command center" })
      await trigger.click()
      const dialog = page.locator('[data-slot="dialog-content"]').filter({
        has: page.getByRole("heading", { name: "Command center" }),
      })
      await dialog.waitFor({ state: "visible" })
      const search = page.getByLabel("Search command center")
      check(
        "opening the command center focuses its search input",
        (await activeElement(page)).ariaLabel === "Search command center"
      )
      check(
        "desktop command center is a centered dialog",
        Boolean((await dialog.boundingBox())?.y && (await dialog.boundingBox())!.y < 400)
      )

      await search.fill("beta")
      const resultButtons = dialog.locator("button")
      check(
        "search is case-insensitive and token matched",
        (await resultButtons.filter({ hasText: "Beta" }).count()) >= 1
      )
      const resultCount = await resultButtons.count()
      check(
        "search narrows out unrelated sessions",
        (await resultButtons.filter({ hasText: "Gamma" }).count()) === 0,
        `results=${resultCount}`
      )
      await search.press("Enter")
      await dialog.waitFor({ state: "detached" })
      const calls = await qaCalls(page)
      check(
        "Enter chooses the first matching session",
        calls.some((call) => call.kind === "selectSession" && call.value === "s-beta"),
        JSON.stringify(calls)
      )
      const focus = await activeElement(page)
      check(
        "closing the command center returns focus to its trigger",
        focus.ariaLabel === "Open command center",
        JSON.stringify(focus)
      )

      await page.keyboard.press("Control+k")
      await dialog.waitFor({ state: "visible" })
      check("Ctrl+K opens the command center outside inputs", await dialog.isVisible())
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })

      const note = page.getByLabel("Synthetic note field")
      await note.focus()
      await page.keyboard.press("Control+k")
      await page.waitForTimeout(250)
      check(
        "Ctrl+K does not open the command center from a text field",
        (await dialog.count()) === 0
      )
      await page.keyboard.press("Alt+Shift+c")
      check("composer shortcut leaves text editing focus alone", (await activeElement(page)).ariaLabel === "Synthetic note field")
      const terminal = page.getByLabel("Synthetic terminal")
      await terminal.focus()
      await page.keyboard.press("Alt+Shift+c")
      check("composer shortcut leaves terminal focus alone", (await activeElement(page)).ariaLabel === "Synthetic terminal")
      await trigger.focus()
      await page.keyboard.press("Alt+Shift+c")
      check("Alt+Shift+C focuses the composer outside editable surfaces", (await activeElement(page)).ariaLabel === "Message")

      await trigger.click()
      await search.fill("model settings")
      await search.press("Enter")
      const modelSheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Model settings" }) })
      await modelSheet.waitFor({ state: "visible" })
      check("command center opens the active session model settings", await modelSheet.isVisible())
      check(
        "desktop model settings open as an anchored popover, not a side sheet",
        (await page.locator('[data-slot="popover-content"]').filter({ has: page.getByRole("heading", { name: "Model settings" }) }).count()) === 1 &&
          (await page.locator('[data-slot="sheet-content"]').filter({ has: page.getByRole("heading", { name: "Model settings" }) }).count()) === 0
      )
      await page.keyboard.press("Alt+Shift+c")
      check("composer shortcut does not steal focus from a modal", (await activeElement(page)).ariaLabel !== "Message")
      await page.keyboard.press("Escape")
      await modelSheet.waitFor({ state: "detached" })

      await trigger.click()
      await search.fill("gamma project")
      await search.press("Enter")
      await dialog.waitFor({ state: "detached" })
      const projectCalls = await qaCalls(page)
      check(
        "project search result runs selectProject with the explicit id",
        projectCalls.some(
          (call) => call.kind === "selectProject" && call.value === "p-gamma"
        ),
        JSON.stringify(projectCalls)
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("desktop command center"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("mobile command center bottom sheet, selection and focus return", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "command")
    const page = opened.page
    try {
      await resetQa(page)
      const trigger = page.getByRole("button", { name: "Open command center" })
      const triggerBox = await trigger.boundingBox()
      check(
        "mobile command center trigger is a 44px touch target",
        (triggerBox?.width ?? 0) >= 44 && (triggerBox?.height ?? 0) >= 44,
        JSON.stringify(triggerBox)
      )
      await trigger.click()
      const heading = page.getByRole("heading", { name: "Command center" })
      await heading.waitFor({ state: "visible" })
      const sheet = page.locator('[data-slot="sheet-content"][data-side="bottom"]')
        .filter({ has: heading })
      const sheetBox = await settledEdge(page, sheet, "bottom")
      check(
        "mobile command center is a bottom sheet that does not exceed the viewport",
        Boolean(sheetBox && Math.abs((sheetBox.y + sheetBox.height) - 844) <= 1 && sheetBox.width === 390),
        JSON.stringify(sheetBox)
      )
      check(
        "mobile command center focuses its search input",
        (await activeElement(page)).ariaLabel === "Search command center"
      )
      await page.getByLabel("Search command center").fill("beta")
      await page.getByLabel("Search command center").press("Enter")
      await sheet.waitFor({ state: "detached" })
      const calls = await qaCalls(page)
      check(
        "mobile command center selects the session and closes",
        calls.some((call) => call.kind === "selectSession" && call.value === "s-beta"),
        JSON.stringify(calls)
      )
      const focus = await activeElement(page)
      check(
        "mobile command center returns focus to its trigger",
        focus.ariaLabel === "Open command center",
        JSON.stringify(focus)
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("mobile command center"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Composer inline model settings across desktop and mobile
// ---------------------------------------------------------------------------
if (browser) {
  await run("desktop composer inline model settings chips and left-aligned header", async ({ check }) => {
    const opened = await openPage({ width: 1440, height: 900 }, "composer")
    const page = opened.page
    try {
      const agent = page.getByRole("combobox", { name: /^Agent,/ })
      const model = page.getByRole("combobox", { name: /^Model,/ })
      const thinking = page.getByRole("combobox", { name: /^Thinking Level,/ })
      await agent.waitFor({ state: "visible" })
      check("desktop composer shows the inline Agent picker", await agent.isVisible())
      check("desktop composer shows the inline Model picker", await model.isVisible())
      check("desktop composer shows the inline Thinking Level picker", await thinking.isVisible())
      check(
        "desktop composer omits the single Active model trigger when inline pickers are active",
        (await page.getByRole("button", { name: /^Active model,/ }).count()) === 0
      )

      const titleBox = await page.locator("h1").first().boundingBox()
      const surfaceBox = await page.locator("[data-composer-surface]").boundingBox()
      check(
        "desktop header title is left-aligned with the composer content edge",
        Boolean(titleBox && surfaceBox && Math.abs(titleBox.x - surfaceBox.x) <= 2),
        `title=${titleBox?.x} composer=${surfaceBox?.x}`
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("desktop composer inline"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("narrow desktop composer keeps the model settings popover fallback", async ({ check }) => {
    const opened = await openPage({ width: 1024, height: 900 }, "composer")
    const page = opened.page
    try {
      const trigger = page.getByRole("button", { name: /^Active model,/ })
      await trigger.waitFor({ state: "visible" })
      check("narrow desktop keeps the single Active model trigger", await trigger.isVisible())
      check(
        "narrow desktop does not render inline pickers",
        (await page.getByRole("combobox", { name: /^Agent,/ }).count()) === 0 &&
          (await page.getByRole("combobox", { name: /^Model,/ }).count()) === 0 &&
          (await page.getByRole("combobox", { name: /^Thinking Level,/ }).count()) === 0
      )

      await trigger.click()
      const popover = page
        .locator('[data-slot="popover-content"]')
        .filter({ has: page.getByRole("heading", { name: "Model settings" }) })
      await popover.waitFor({ state: "visible" })
      check("narrow desktop opens model settings as an anchored popover", await popover.isVisible())
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("narrow desktop composer"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("mobile composer keeps the model settings bottom sheet", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "composer")
    const page = opened.page
    try {
      const trigger = page.getByRole("button", { name: /^Active model,/ })
      await trigger.waitFor({ state: "visible" })
      check("mobile keeps the single Active model trigger", await trigger.isVisible())
      check(
        "mobile does not render inline pickers",
        (await page.getByRole("combobox", { name: /^Agent,/ }).count()) === 0 &&
          (await page.getByRole("combobox", { name: /^Model,/ }).count()) === 0 &&
          (await page.getByRole("combobox", { name: /^Thinking Level,/ }).count()) === 0
      )

      await trigger.click()
      const sheet = page
        .locator('[data-slot="sheet-content"][data-side="bottom"]')
        .filter({ has: page.getByRole("heading", { name: "Model settings" }) })
      await sheet.waitFor({ state: "visible" })
      check("mobile opens model settings as a bottom sheet", await sheet.isVisible())
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("mobile composer"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Changes panel and inspector flow
// ---------------------------------------------------------------------------
if (browser) {
  await run("changes panel discloses only safe, existing working-tree files", async ({ check }) => {
    const opened = await openPage({ width: 1280, height: 900 }, "changes")
    const page = opened.page
    try {
      await resetQa(page)
      await page.getByText(/Branch:/).waitFor({ state: "visible" })
      await page.getByText("synthetic-main").waitFor({ state: "visible" })
      check(
        "changes panel labels the diff as the working tree, not a session turn",
        await page.getByText("VCS HEAD to working copy — not the session turn.").isVisible()
      )

      await page.getByRole("button", { name: /src\/app\.ts/ }).click()
      const openFile = page.getByRole("button", { name: "Open read-only file" })
      check("modified safe file offers a read-only file action", await openFile.isVisible())
      await openFile.click()
      const qa = await page.evaluate(
        () => (window as unknown as { __qa: { openedFiles: string[] } }).__qa.openedFiles
      )
      check(
        "opening a changed file passes its exact project-relative path",
        qa.length === 1 && qa[0] === "src/app.ts",
        JSON.stringify(qa)
      )

      await page.getByRole("button", { name: /src\/deleted\.ts/ }).click()
      check(
        "deleted files do not offer the read-only open action",
        (await page.getByRole("button", { name: "Open read-only file" }).count()) === 0
      )

      await page.getByRole("button", { name: /unsafe\.ts/ }).click()
      check(
        "unsafe paths do not offer the read-only open action",
        (await page.getByRole("button", { name: "Open read-only file" }).count()) === 0
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("changes panel"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("desktop inspector working-tree to read-only file flow", async ({ check }) => {
    const opened = await openPage({ width: 1280, height: 900 }, "inspector")
    const page = opened.page
    try {
      await resetQa(page)
      const drawer = page.locator('[data-desktop-sidebar="inspector"]')
      await drawer.waitFor({ state: "visible" })
      check(
        "desktop inspector is a persistent right sidebar",
        (await drawer.getAttribute("data-side")) === "right" &&
          (await drawer.getAttribute("data-inspector-mode")) === "full" &&
          (await drawer.locator('[data-slot="sheet-content"]').count()) === 0,
        String(await drawer.getAttribute("data-side"))
      )
      check(
        "the sidebar exposes all five inspector tabs",
        (await drawer.getByRole("tab").count()) === 5 &&
          (await drawer.getByRole("tab", { name: "Command" }).isVisible()) &&
          (await drawer.getByRole("tab", { name: "Activity" }).isVisible()),
        String(await drawer.getByRole("tab").count())
      )

      await page.locator("[data-qa-active]").click()
      check(
        "clicking outside the desktop inspector leaves it open",
        await drawer.isVisible()
      )

      await page.getByRole("tab", { name: "Changes" }).click()
      await drawer.getByText("synthetic-main").first().waitFor({ state: "visible" })
      await page.getByRole("button", { name: /src\/app\.ts/ }).click()
      await page.getByRole("button", { name: "Open read-only file" }).click()
      const fileSection = page.locator('section[aria-label="File src/app.ts"]')
      await fileSection.waitFor({ state: "visible" })
      check(
        "Open read-only file switches the inspector to Files with that path",
        await page.getByRole("tab", { name: "Files" }).getAttribute("aria-selected").then((value) => value === "true")
      )
      check(
        "the synthetic file preview is shown read-only",
        (await fileSection.textContent())?.includes("read-only") === true
      )
      check(
        "preview text comes from the synthetic read endpoint",
        (await page.getByLabel("File content src/app.ts").textContent())?.includes(
          "export const synthetic = true"
        ) === true
      )
      await page.getByRole("button", { name: "Collapse session inspector" }).click()
      await page.waitForFunction(() => {
        const element = document.querySelector('[data-desktop-sidebar="inspector"]')
        return element?.getAttribute("data-inspector-mode") === "rail"
      })
      const focus = await activeElement(page)
      check(
        "collapsing the desktop inspector focuses its rail expand control",
        focus.ariaLabel === "Expand session inspector",
        JSON.stringify(focus)
      )
      await page.getByRole("button", { name: "Expand session inspector" }).click()
      await page.waitForFunction(() => {
        const element = document.querySelector('[data-desktop-sidebar="inspector"]')
        return element?.getAttribute("data-inspector-mode") === "full"
      })
      check(
        "expanding the desktop inspector restores the panel",
        await drawer.getByRole("tab", { name: "Files" }).isVisible()
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("desktop inspector"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("inspector workspace covers all viewports, themes, RTL, and reduced motion", async ({ check }) => {
    const sizes: Array<[number, number]> = [
      [390, 844],
      [768, 900],
      [1024, 900],
      [1280, 900],
      [1440, 900],
    ]
    for (const [width, height] of sizes) {
      for (const theme of ["light", "dark"] as const) {
        const opened = await openPage({ width, height }, "inspector", { theme })
        const page = opened.page
        try {
          if (width < 768) {
            await page.getByRole("button", { name: "Session inspector" }).click()
          }
          const drawer = page.locator('[data-desktop-sidebar="inspector"], [data-fixed-drawer="inspector"]')
          await drawer.first().waitFor({ state: "visible" })
          const tabs = drawer.getByRole("tab")
          check(
            `${width}x${height} ${theme} shows five inspector tabs`,
            (await tabs.count()) === 5,
            String(await tabs.count())
          )
          const command = drawer.getByRole("tab", { name: "Command" })
          const box = await command.boundingBox()
          check(
            `${width}x${height} ${theme} tab targets are 44px`,
            Boolean(box && box.height >= 44),
            JSON.stringify(box)
          )
          check(
            `${width}x${height} ${theme} has no page errors`,
            opened.pageErrors.length === 0,
            opened.pageErrors.join(" | ")
          )
          mergeDiagnostics(
            results.find((result) => result.name.startsWith("inspector workspace covers"))!,
            opened
          )
        } finally {
          await opened.context.close()
        }
      }
    }

    const rtl = await openPage({ width: 1280, height: 900 }, "inspector", undefined, { dir: "rtl" })
    try {
      await rtl.page.evaluate(() => document.documentElement.setAttribute("dir", "rtl"))
      await rtl.page.waitForTimeout(50)
      const direction = await rtl.page.evaluate(() => getComputedStyle(document.documentElement).direction)
      const drawer = rtl.page.locator('[data-desktop-sidebar="inspector"]')
      check("RTL sets the document text direction", direction === "rtl", direction)
      check("RTL keeps all inspector tabs reachable", (await drawer.getByRole("tab").count()) === 5)
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("inspector workspace covers"))!,
        rtl
      )
    } finally {
      await rtl.context.close()
    }

    const reduced = await openPage(
      { width: 390, height: 844 },
      "inspector",
      undefined,
      { reducedMotion: "reduce", hasTouch: true }
    )
    try {
      await reduced.page.getByRole("button", { name: "Session inspector" }).click()
      const drawer = reduced.page.locator('[data-fixed-drawer="inspector"]')
      await drawer.waitFor({ state: "visible" })
      check(
        "reduced motion opens the inspector sheet normally",
        (await drawer.getByRole("tab").count()) === 5 && reduced.pageErrors.length === 0,
        JSON.stringify(reduced.pageErrors)
      )
      const drawerBox = await settledEdge(reduced.page, drawer, "bottom")
      check(
        "mobile inspector uses about 88dvh",
        Boolean(drawerBox && drawerBox.height > 0.85 * 844 && drawerBox.height < 0.9 * 844),
        JSON.stringify(drawerBox)
      )
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("inspector workspace covers"))!,
        reduced
      )
    } finally {
      await reduced.context.close()
    }
  })

  await run("inspector tab strip advertises and scrolls hidden tabs", async ({ check }) => {
    for (const viewport of [
      { width: 1280, height: 900, mobile: false },
      { width: 390, height: 844, mobile: true },
    ]) {
      const opened = await openPage(viewport, "inspector")
      const page = opened.page
      try {
        const scope = viewport.mobile
          ? page.locator('[data-fixed-drawer="inspector"]')
          : page.locator('[data-desktop-sidebar="inspector"]')
        if (viewport.mobile) {
          await page.getByRole("button", { name: "Session inspector" }).click()
        }
        await scope.waitFor({ state: "visible" })

        const more = scope.getByRole("button", { name: "More inspector tabs" })
        await more.waitFor({ state: "visible" })
        check(
          `${viewport.width}px shows a visible cue for hidden tabs`,
          await more.isVisible()
        )

        await more.click()
        await page.waitForTimeout(300)
        const sessionTab = scope.getByRole("tab", { name: "Session" })
        check(
          `${viewport.width}px scrolls the last tab into view`,
          await sessionTab.isVisible()
        )
        check(
          `${viewport.width}px exposes the reverse scroll control`,
          await scope.getByRole("button", { name: "Previous inspector tabs" }).isVisible()
        )

        await sessionTab.click()
        await scope.getByText("Context & tokens").waitFor({ state: "visible" })
        check(
          `${viewport.width}px Session tab is reachable and renders`,
          await scope.getByText("Context & tokens").isVisible()
        )
        check(
          `${viewport.width}px tab scrolling reports no page errors`,
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) => result.name.startsWith("inspector tab strip advertises"))!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  })

  await run("all five inspector tabs render on desktop and mobile", async ({ check }) => {
    for (const viewport of [
      { width: 1280, height: 900, mobile: false },
      { width: 390, height: 844, mobile: true },
    ]) {
      const opened = await openPage(viewport, "inspector")
      const page = opened.page
      try {
        const scope = viewport.mobile
          ? page.locator('[data-fixed-drawer="inspector"]')
          : page.locator('[data-desktop-sidebar="inspector"]')
        if (viewport.mobile) {
          await page.getByRole("button", { name: "Session inspector" }).click()
        }
        await scope.waitFor({ state: "visible" })

        await scope.getByRole("tab", { name: "Command" }).click()
        check(
          `${viewport.width}px Command exposes a search field`,
          await scope.getByRole("textbox", { name: /Search actions, sessions, messages, and files/ }).isVisible()
        )

        await scope.getByRole("tab", { name: "Files" }).click()
        await scope.getByText("Project files", { exact: true }).waitFor({ state: "visible" })
        check(`${viewport.width}px Files lists project files`, true)

        await scope.getByRole("tab", { name: "Changes" }).click()
        await scope.getByText("synthetic-main").first().waitFor({ state: "visible" })
        check(
          `${viewport.width}px Changes offers both scopes`,
          (await scope.getByRole("button", { name: "Working tree", pressed: true }).count()) === 1 &&
            (await scope.getByRole("button", { name: "This turn" }).count()) === 1
        )

        await scope.getByRole("tab", { name: "Activity" }).click()
        await scope.getByText("Queue", { exact: true }).waitFor({ state: "visible" })
        check(
          `${viewport.width}px Activity shows run, queue, and attention`,
          (await scope.getByText("Run", { exact: true }).count()) >= 1 &&
            (await scope.getByText("Needs you", { exact: true }).count()) >= 1
        )

        await scope.getByRole("tab", { name: "Session" }).click()
        await scope.getByText("Context & tokens").waitFor({ state: "visible" })
        check(
          `${viewport.width}px Session shows archive and local pin`,
          (await scope.getByRole("button", { name: /Archive session/ }).count()) === 1 &&
            (await scope.getByRole("button", { name: /Pin in this browser|Unpin in this browser/ }).count()) === 1
        )
        check(`${viewport.width}px tabs report no page errors`, opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
        mergeDiagnostics(
          results.find((result) => result.name.startsWith("all five inspector tabs"))!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  })

  await run("mobile inspector is a bounded bottom sheet", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "inspector")
    const page = opened.page
    try {
      await resetQa(page)
      await page.getByRole("button", { name: "Session inspector" }).click()
      const drawer = page.locator('[data-fixed-drawer="inspector"]')
      await drawer.waitFor({ state: "visible" })
      const drawerBox = await settledEdge(page, drawer, "bottom")
      check(
        "mobile inspector opens as a fixed-height bottom sheet",
        (await drawer.getAttribute("data-side")) === "bottom" &&
          Boolean(drawerBox && Math.abs((drawerBox.y + drawerBox.height) - 844) <= 1 && drawerBox.width === 390),
        JSON.stringify({ side: await drawer.getAttribute("data-side"), box: drawerBox })
      )

      await page.getByRole("tab", { name: "Changes" }).click()
      await drawer.getByText("synthetic-main").waitFor({ state: "visible" })
      await drawer.getByRole("button", { name: /src\/app\.ts/ }).click()
      await drawer.getByRole("button", { name: "Open read-only file" }).click()
      const fileSection = drawer.locator('section[aria-label="File src/app.ts"]')
      await fileSection.waitFor({ state: "visible" })
      check(
        "mobile working-tree to read-only file flow completes inside the drawer",
        (await fileSection.textContent())?.includes("read-only") === true &&
          (await drawer.getByLabel("File content src/app.ts").textContent())?.includes(
            "export const synthetic = true"
          ) === true
      )

      await drawer.getByRole("button", { name: "Close session inspector" }).click()
      await drawer.waitFor({ state: "detached" })
      const focus = await activeElement(page)
      check(
        "closing the mobile inspector returns focus to its trigger",
        focus.ariaLabel === "Session inspector",
        JSON.stringify(focus)
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("mobile inspector"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Conversation disclosure anchoring
// ---------------------------------------------------------------------------
async function selectVisibleTrigger(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
    if (!viewport) throw new Error("Conversation viewport missing")
    const triggers = [...document.querySelectorAll<HTMLElement>('[data-slot="trace-collapsible-trigger"]')]
    const viewRect = viewport.getBoundingClientRect()
    const trigger = triggers.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.height > 0 && rect.bottom > viewRect.top + 8 && rect.top < viewRect.bottom - 8
    })
    if (!trigger) throw new Error("No visible disclosure trigger")
    trigger.dataset.qaAnchor = "target"
    const rect = trigger.getBoundingClientRect()
    return {
      offset: rect.top - viewRect.top,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      expanded: trigger.getAttribute("aria-expanded"),
      messageID: trigger.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null,
    }
  })
}

async function anchorState(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
    const trigger = document.querySelector<HTMLElement>('[data-qa-anchor="target"]')
    if (!viewport || !trigger) return null
    const viewRect = viewport.getBoundingClientRect()
    return {
      offset: trigger.getBoundingClientRect().top - viewRect.top,
      scrollTop: viewport.scrollTop,
      expanded: trigger.getAttribute("aria-expanded"),
      panelHeight:
        trigger.parentElement?.querySelector<HTMLElement>(
          '[data-slot="trace-collapsible-content"]'
        )?.getBoundingClientRect().height ?? 0,
    }
  })
}

if (browser) {
  await run("conversation disclosure keeps the activated trigger anchored while it expands", async ({ check }) => {
    const opened = await openPage({ width: 900, height: 700 }, "conversation")
    const page = opened.page
    try {
      const viewport = page.getByRole("region", { name: "Conversation" })
      await viewport.waitFor({ state: "visible" })
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        if (element) element.scrollTop = element.scrollHeight * 0.45
      })
      await page.waitForTimeout(350)

      const before = await selectVisibleTrigger(page)
      check(
        "a virtualized tool disclosure is visible in the middle of the conversation",
        typeof before.offset === "number" && before.expanded === "false",
        JSON.stringify(before)
      )

      await page.locator('[data-qa-anchor="target"]').click()
      const samples: { at: number; state: NonNullable<Awaited<ReturnType<typeof anchorState>>> }[] = []
      for (const at of [0, 80, 200, 450]) {
        if (at > 0) await page.waitForTimeout(at - (samples.at(-1)?.at ?? 0))
        const state = await anchorState(page)
        if (!state) throw new Error(`Anchored trigger disappeared at ${at}ms`)
        samples.push({ at, state })
      }
      check(
        "the disclosure expands",
        samples.every((sample) => sample.state.expanded === "true") &&
          samples.at(-1)!.state.panelHeight > 0,
        JSON.stringify(samples.map((sample) => ({ at: sample.at, expanded: sample.state.expanded, panelHeight: sample.state.panelHeight })))
      )
      const maxDrift = Math.max(
        ...samples.map((sample) => Math.abs(sample.state.offset - before.offset))
      )
      check(
        "the activated trigger does not drift during the 200ms transition and measurement",
        maxDrift <= 1.5,
        `maxDrift=${maxDrift.toFixed(2)}px samples=${JSON.stringify(samples.map((sample) => ({ at: sample.at, offset: sample.state.offset })))}`
      )
      check(
        "the expansion does not force a jump to the bottom",
        Math.abs(
          samples.at(-1)!.state.scrollTop - before.scrollTop
        ) <= 1.5,
        `before=${before.scrollTop} after=${samples.at(-1)!.state.scrollTop}`
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("conversation disclosure keeps"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("mobile conversation disclosure expands from a tap without drifting", async ({ check }) => {
    const opened = await openPage(
      { width: 390, height: 844 },
      "conversation",
      undefined,
      { hasTouch: true }
    )
    const page = opened.page
    try {
      const viewport = page.getByRole("region", { name: "Conversation" })
      await viewport.waitFor({ state: "visible" })
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        if (element) element.scrollTop = element.scrollHeight * 0.5
      })
      await page.waitForTimeout(350)
      const before = await selectVisibleTrigger(page)
      const trigger = page.locator('[data-qa-anchor="target"]')
      const triggerBox = await trigger.boundingBox()
      check(
        "mobile disclosure trigger is a 44px touch target",
        (triggerBox?.height ?? 0) >= 43.5,
        JSON.stringify(triggerBox)
      )
      check(
        "a collapsed mobile disclosure is visible before tapping",
        before.expanded === "false",
        JSON.stringify(before)
      )

      if (!triggerBox) throw new Error("Mobile disclosure trigger has no box")
      await page.touchscreen.tap(
        triggerBox.x + triggerBox.width / 2,
        triggerBox.y + triggerBox.height / 2
      )
      const samples: { at: number; state: NonNullable<Awaited<ReturnType<typeof anchorState>>> }[] = []
      for (const at of [0, 100, 250, 500]) {
        if (at > 0) await page.waitForTimeout(at - (samples.at(-1)?.at ?? 0))
        const state = await anchorState(page)
        if (!state) throw new Error(`Anchored mobile trigger disappeared at ${at}ms`)
        samples.push({ at, state })
      }
      check(
        "tap expands the disclosure",
        samples.every((sample) => sample.state.expanded === "true") &&
          samples.at(-1)!.state.panelHeight > 0
      )
      const maxDrift = Math.max(
        ...samples.map((sample) => Math.abs(sample.state.offset - before.offset))
      )
      check(
        "mobile trigger stays anchored while the panel animates",
        maxDrift <= 1.5,
        `maxDrift=${maxDrift.toFixed(2)}px`
      )
      check(
        "mobile disclosure does not force a jump to the bottom",
        Math.abs(samples.at(-1)!.state.scrollTop - before.scrollTop) <= 1.5,
        `before=${before.scrollTop} after=${samples.at(-1)!.state.scrollTop}`
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("mobile conversation disclosure"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("reader input cancels disclosure anchoring instead of fighting the scroll", async ({ check }) => {
    const opened = await openPage({ width: 900, height: 700 }, "conversation")
    const page = opened.page
    try {
      const viewport = page.getByRole("region", { name: "Conversation" })
      await viewport.waitFor({ state: "visible" })
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        if (element) element.scrollTop = element.scrollHeight * 0.4
      })
      await page.waitForTimeout(350)
      const before = await selectVisibleTrigger(page)
      await page.locator('[data-qa-anchor="target"]').click()
      await page.waitForTimeout(30)

      await viewport.hover()
      await page.mouse.wheel(0, 180)
      await page.waitForTimeout(120)
      const afterWheel = await anchorState(page)
      check("wheel input changes the reading position", Boolean(afterWheel), JSON.stringify(afterWheel))
      check(
        "wheel input moved away from the anchored offset",
        Math.abs((afterWheel?.offset ?? before.offset) - before.offset) > 1,
        JSON.stringify({ before: before.offset, after: afterWheel?.offset })
      )
      await page.waitForTimeout(450)
      const settled = await anchorState(page)
      check(
        "the canceled anchor does not restore its old position",
        Boolean(settled && Math.abs(settled.offset - afterWheel!.offset) <= 1.5),
        JSON.stringify({ afterWheel: afterWheel?.offset, settled: settled?.offset })
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
      mergeDiagnostics(
        results.find((result) => result.name.startsWith("reader input cancels"))!,
        opened
      )
    } finally {
      await opened.context.close()
    }
  })

  await run("streaming growth preserves an open disclosure and the reader position", async ({ check }) => {
    const opened = await openPage({ width: 900, height: 700 }, "conversation")
    const page = opened.page
    try {
      await page.getByRole("region", { name: "Conversation" }).waitFor({ state: "visible" })
      await page.waitForTimeout(350)
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45 })
      await page.waitForTimeout(350)
      const before = await selectVisibleTrigger(page)
      await page.locator('[data-qa-anchor="target"]').click()
      for (let index = 1; index <= 5; index++) {
        await page.evaluate((text) => (window as unknown as Window & { __qa: { stream: (text: string) => void } }).__qa.stream(text), `Synthetic streamed reply ${"growing text ".repeat(index * 80)}`)
        await page.waitForTimeout(80)
      }
      await page.waitForTimeout(500)
      const after = await anchorState(page)
      const streamLength = await page.evaluate(() => (window as unknown as Window & { __qa: { streamText: () => string } }).__qa.streamText().length)
      check("live-run store received growing streamed text", streamLength > 4_000, `characters=${streamLength}`)
      check("disclosure remains expanded and anchored while the live run grows", Boolean(after && after.expanded === "true" && Math.abs(after.offset - before.offset) <= 2), JSON.stringify({ before, after }))
      check("stream growth does not force a bottom jump", Boolean(after && Math.abs(after.scrollTop - before.scrollTop) <= 2), JSON.stringify({ before: before.scrollTop, after: after?.scrollTop }))
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally { await opened.context.close() }
  })

  await run("prepending older history preserves the open disclosure and reading position", async ({ check }) => {
    const opened = await openPage({ width: 900, height: 700 }, "conversation-history")
    const page = opened.page
    try {
      await page.getByRole("region", { name: "Conversation" }).waitFor({ state: "visible" })
      await page.waitForTimeout(350)
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45 })
      await page.waitForTimeout(350)
      const before = await selectVisibleTrigger(page)
      assert(before.messageID, "Visible disclosure has no message ID")
      await page.locator('[data-qa-anchor="target"]').click()
      await page.waitForTimeout(450)
      const expanded = await anchorState(page)
      assert(expanded?.expanded === "true", "Disclosure did not open")
      await page.getByRole("button", { name: "Load older messages" }).evaluate((button) => (button as HTMLElement).click())
      await page.waitForTimeout(900)
      const after = await page.evaluate((id) => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const trigger = document.querySelector<HTMLElement>(`[data-message-id="${id}"] [data-slot="trace-collapsible-trigger"]`)
        return viewport && trigger ? { offset: trigger.getBoundingClientRect().top - viewport.getBoundingClientRect().top, expanded: trigger.getAttribute("aria-expanded"), scrollTop: viewport.scrollTop } : null
      }, before.messageID)
      check("older history was actually prepended", (await page.getByRole("button", { name: "Load older messages" }).count()) === 0)
      check("same disclosure stays open and near its previous reading position", Boolean(after && after.expanded === "true" && Math.abs(after.offset - expanded.offset) <= 3), JSON.stringify({ before: expanded, after }))
      check("history prepend adjusts scroll position instead of jumping to bottom", Boolean(after && after.scrollTop > expanded.scrollTop), JSON.stringify({ before: expanded.scrollTop, after: after?.scrollTop }))
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally { await opened.context.close() }
  })

  await run("mobile viewport resize preserves an open disclosure", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "conversation", undefined, { hasTouch: true })
    const page = opened.page
    try {
      await page.getByRole("region", { name: "Conversation" }).waitFor({ state: "visible" })
      await page.waitForTimeout(350)
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.4 })
      await page.waitForTimeout(350)
      const before = await selectVisibleTrigger(page)
      await page.locator('[data-qa-anchor="target"]').click()
      await page.waitForTimeout(100)
      await page.setViewportSize({ width: 390, height: 550 })
      await page.waitForTimeout(500)
      const resized = await anchorState(page)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(500)
      const restored = await anchorState(page)
      check("disclosure stays expanded through keyboard-like viewport shrink and restore", resized?.expanded === "true" && restored?.expanded === "true", JSON.stringify({ resized, restored }))
      check("viewport resize keeps the reading anchor stable", Boolean(resized && restored && Math.abs(resized.offset - before.offset) <= 2 && Math.abs(restored.offset - before.offset) <= 2), JSON.stringify({ before, resized, restored }))
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally { await opened.context.close() }
  })

  await run("reader input cancels history prepend restoration", async ({ check }) => {
    const opened = await openPage({ width: 900, height: 700 }, "conversation-history")
    const page = opened.page
    try {
      const viewport = page.getByRole("region", { name: "Conversation" })
      await viewport.waitFor({ state: "visible" })
      await page.waitForTimeout(350)
      await page.evaluate(() => { const el = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (el) el.scrollTop = el.scrollHeight * 0.45 })
      await page.waitForTimeout(350)
      await selectVisibleTrigger(page)
      await page.locator('[data-qa-anchor="target"]').click()
      await page.waitForTimeout(450)
      const beforePrepend = await viewport.evaluate((el) => el.scrollTop)
      await page.getByRole("button", { name: "Load older messages" }).evaluate((button) => (button as HTMLElement).click())
      await page.waitForTimeout(300)
      const beforeWheel = await viewport.evaluate((el) => el.scrollTop)
      await viewport.hover()
      await page.mouse.wheel(0, 180)
      await page.waitForTimeout(150)
      const afterWheel = await viewport.evaluate((el) => el.scrollTop)
      await page.waitForTimeout(600)
      const settled = await viewport.evaluate((el) => el.scrollTop)
      check("prepend restoration has started before wheel input", beforeWheel > beforePrepend + 300, JSON.stringify({ beforePrepend, beforeWheel }))
      check("wheel changes position during prepend restoration", afterWheel - beforeWheel > 100 && afterWheel - beforeWheel < 260, JSON.stringify({ beforeWheel, afterWheel }))
      check("restoration does not undo the reader's wheel input", Math.abs(settled - afterWheel) <= 2, JSON.stringify({ afterWheel, settled }))
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally { await opened.context.close() }
  })

  await run("long tool errors open safely in a mobile sheet", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "conversation-long-tool", undefined, { hasTouch: true })
    const page = opened.page
    try {
      await page.getByRole("region", { name: "Conversation" }).waitFor({ state: "visible" })
      await page.waitForTimeout(350)
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45 })
      await page.waitForTimeout(350)
      const before = await selectVisibleTrigger(page)
      const trace = page.locator('[data-qa-anchor="target"]')
      await trace.click()
      assert(before.messageID, "Visible disclosure has no message ID")
      const traceContent = trace.locator("..").locator('[data-slot="trace-collapsible-content"]')
      await traceContent.waitFor({ state: "visible" })
      await traceContent.locator('[data-slot="collapsible-trigger"]').first().click()
      const detailsButton = page.locator(`[data-message-id="${before.messageID}"]`).getByRole("button", { name: /View full error for/, includeHidden: true })
      await detailsButton.waitFor({ state: "visible" })
      const box = await detailsButton.boundingBox()
      check("mobile long-error action is a 44px target", Boolean(box && box.height >= 43.5), JSON.stringify(box))
      await detailsButton.click()
      const sheet = page.getByRole("dialog", { name: "Tool error details" })
      await sheet.waitFor({ state: "visible" })
      await page.waitForTimeout(250)
      const sheetBox = await sheet.boundingBox()
      check("long error opens in a bounded bottom sheet", Boolean(sheetBox && sheetBox.height <= 844 && Math.abs(sheetBox.y + sheetBox.height - 844) < 2), JSON.stringify(sheetBox))
      const detail = sheet.getByRole("region", { name: "Full tool error" })
      const text = await detail.textContent()
      check("sheet shows the complete bounded error as text", Boolean(text?.includes("END-OF-ERROR") && text.includes("<script>bad()</script>")))
      check("tool text is not interpreted as active HTML", await detail.locator("script").count() === 0)
      await page.evaluate(() => (window as unknown as Window & { __qa: { stream: (text: string) => void } }).__qa.stream("synthetic stream ".repeat(400)))
      await page.waitForTimeout(150)
      check("sheet stays open during live-run updates", await sheet.isVisible())
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (viewport) viewport.scrollTop = viewport.scrollHeight })
      await page.waitForTimeout(350)
      const offscreen = await page.evaluate((id) => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]')
        const source = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
        return Boolean(viewport && source && source.getBoundingClientRect().bottom < viewport.getBoundingClientRect().top)
      }, before.messageID)
      check("source row is outside the viewport while the sheet remains open", offscreen && await sheet.isVisible() && await detailsButton.count() === 1)
      await sheet.getByRole("button", { name: "Close" }).click()
      await sheet.waitFor({ state: "detached" })
      check("closing the sheet restores focus to its trigger", await detailsButton.evaluate((button) => document.activeElement === button))
      await page.keyboard.press("Enter")
      await sheet.waitFor({ state: "visible" })
      const keyboardDetail = sheet.getByRole("region", { name: "Full tool error" })
      await keyboardDetail.focus()
      check("full error region is keyboard-focusable for scrolling", await keyboardDetail.evaluate((element) => document.activeElement === element))
      await page.keyboard.press("Escape")
      await sheet.waitFor({ state: "detached" })
      check("Escape closes the sheet and restores trigger focus", await detailsButton.evaluate((button) => document.activeElement === button))
      await page.keyboard.press("Enter")
      await sheet.waitFor({ state: "visible" })
      await page.setViewportSize({ width: 900, height: 700 })
      await page.waitForTimeout(300)
      check("rotation to desktop keeps an open sheet and its text available", await sheet.isVisible() && Boolean((await sheet.textContent())?.includes("END-OF-ERROR")))
      await page.keyboard.press("Escape")
      await sheet.waitFor({ state: "detached" })
      const desktopTrace = page.locator(`[data-message-id="${before.messageID}"] [data-slot="trace-collapsible-trigger"]`)
      check("closing after rotation restores focus to the desktop trace", await desktopTrace.evaluate((element) => document.activeElement === element))
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally { await opened.context.close() }
  })

  await run("long tool errors retain desktop inline disclosure", async ({ check }) => {
    const opened = await openPage({ width: 900, height: 700 }, "conversation-long-tool")
    const page = opened.page
    try {
      await page.getByRole("region", { name: "Conversation" }).waitFor({ state: "visible" })
      await page.waitForTimeout(350)
      await page.evaluate(() => { const viewport = document.querySelector<HTMLElement>('[aria-label="Conversation"]'); if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45 })
      await page.waitForTimeout(350)
      await selectVisibleTrigger(page)
      const trace = page.locator('[data-qa-anchor="target"]')
      await trace.click()
      const content = trace.locator("..").locator('[data-slot="trace-collapsible-content"]')
      await content.waitFor({ state: "visible" })
      await content.locator('[data-slot="collapsible-trigger"]').first().click()
      await content.locator('[data-slot="collapsible-content"]').waitFor({ state: "visible" })
      check("desktop keeps the full error inline", (await content.textContent())?.includes("END-OF-ERROR"))
      check("desktop does not introduce the mobile sheet action", await content.getByRole("button", { name: /View full error/ }).count() === 0)
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally { await opened.context.close() }
  })

  await run("notes workspace keeps one readable pane in a narrow container", async ({ check }) => {
    const opened = await openPage({ width: 1024, height: 800 }, "notes")
    const page = opened.page
    try {
      const region = page.getByRole("region", { name: "Notes", exact: true })
      await page.getByRole("button", { name: "Open Release plan" }).waitFor({ state: "visible" })
      check("narrow container starts on the list", (await region.getByRole("article").count()) === 0)

      await page.getByRole("button", { name: "Open Release plan" }).click()
      const article = region.getByRole("article", { name: "Note Release plan" })
      await article.waitFor({ state: "visible" })
      const articleBox = await article.boundingBox()
      check(
        "detail pane fills the narrow container instead of collapsing",
        (articleBox?.width ?? 0) >= 300,
        `width=${articleBox?.width}`
      )
      check(
        "list pane is hidden while the detail is open",
        (await region.getByRole("button", { name: "Open Bugs" }).count()) === 0
      )
      await page.getByRole("button", { name: "Back to Notes" }).click()
      await page.getByRole("button", { name: "Open Bugs" }).waitFor({ state: "visible" })

      const chips = await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>(
          '[role="group"][aria-label="Filter by status"]'
        )
        if (!group) return null
        const rect = group.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          buttons: [...group.querySelectorAll("button")].map((button) => {
            const box = button.getBoundingClientRect()
            return {
              label: button.textContent,
              left: box.left,
              right: box.right,
              height: box.height,
            }
          }),
        }
      })
      check("all four status filters render", chips?.buttons.length === 4, JSON.stringify(chips))
      check(
        "no status filter is clipped by the column",
        Boolean(
          chips &&
            chips.buttons.every(
              (button) => button.right <= chips.right + 1 && button.left >= chips.left - 1
            )
        ),
        JSON.stringify(chips)
      )
      check(
        "status filters keep 44px targets",
        Boolean(chips && chips.buttons.every((button) => button.height >= 44))
      )

      const preview = await page.locator("#note-preview-note-plan").textContent()
      check(
        "row preview is bounded plain text without Markdown markers",
        Boolean(
          preview &&
            preview.length <= 160 &&
            !preview.includes("#") &&
            !preview.includes("**") &&
            !preview.includes("\n")
        ),
        preview ?? "missing"
      )
      check(
        "row preview names the summary, not the whole body",
        Boolean(preview?.startsWith("Ship the notes workspace")),
        preview ?? "missing"
      )

      await page.getByRole("button", { name: /^Notes\s*\d/ }).click()
      const unpin = page.getByRole("button", { name: "Unpin “Release plan”" })
      await unpin.click()
      const dialog = page.getByRole("alertdialog")
      await dialog.waitFor({ state: "visible" })
      check(
        "unpin asks for confirmation and names the note",
        Boolean((await dialog.textContent())?.includes("Release plan"))
      )
      await dialog.getByRole("button", { name: "Cancel" }).click()
      await dialog.waitFor({ state: "detached" })
      check(
        "cancelling returns focus to the pin control",
        await unpin.evaluate((element) => document.activeElement === element)
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally {
      await opened.context.close()
    }
  })

  await run("notes workspace keeps list and detail readable in a wide container", async ({ check }) => {
    const opened = await openPage({ width: 1440, height: 900 }, "notes-wide")
    const page = opened.page
    try {
      const region = page.getByRole("region", { name: "Notes", exact: true })
      await page.getByRole("button", { name: "Open Release plan" }).waitFor({ state: "visible" })
      await page.getByRole("button", { name: "Open Release plan" }).click()
      const article = region.getByRole("article", { name: "Note Release plan" })
      await article.waitFor({ state: "visible" })
      const articleBox = await article.boundingBox()
      check(
        "detail pane stays readable beside the list",
        (articleBox?.width ?? 0) >= 300,
        `width=${articleBox?.width}`
      )
      check(
        "list remains visible beside the detail",
        await region.getByRole("button", { name: "Open Bugs" }).isVisible()
      )
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally {
      await opened.context.close()
    }
  })

  await run("notes workspace fits a mobile viewport without horizontal overflow", async ({ check }) => {
    const opened = await openPage({ width: 390, height: 844 }, "notes")
    const page = opened.page
    try {
      const region = page.getByRole("region", { name: "Notes", exact: true })
      await page.getByRole("button", { name: "Open Release plan" }).waitFor({ state: "visible" })
      const overflow = await page.evaluate(() => {
        const section = document.querySelector<HTMLElement>('section[aria-label="Notes"]')
        return {
          document: document.documentElement.scrollWidth - window.innerWidth,
          section: section ? section.scrollWidth - section.clientWidth : 1,
        }
      })
      check("notes list introduces no horizontal overflow", overflow.document <= 1 && overflow.section <= 1, JSON.stringify(overflow))
      const listBox = await region.getByRole("button", { name: "Open Release plan" }).boundingBox()
      check(
        "list rows stay inside the viewport",
        Boolean(listBox && listBox.x >= 0 && listBox.x + listBox.width <= 390),
        JSON.stringify(listBox)
      )

      await page.getByRole("button", { name: "Open Release plan" }).click()
      const article = region.getByRole("article", { name: "Note Release plan" })
      await article.waitFor({ state: "visible" })
      const articleBox = await article.boundingBox()
      check(
        "mobile detail fills the viewport width",
        Boolean(articleBox && articleBox.width >= 300 && articleBox.x >= 0 && articleBox.x + articleBox.width <= 390),
        JSON.stringify(articleBox)
      )
      await page.getByRole("button", { name: "Back to Notes" }).click()
      await page.getByRole("button", { name: "Open Bugs" }).waitFor({ state: "visible" })
      check("Back to Notes returns to the list", true)
      check("no page errors", opened.pageErrors.length === 0, opened.pageErrors.join(" | "))
    } finally {
      await opened.context.close()
    }
  })
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (browser) await browser.close()
await server.stop(true)

const passed = results.filter((result) => result.status === "PASS").length
const failed = results.filter((result) => result.status === "FAIL").length
const blocked = results.filter((result) => result.status === "BLOCKED").length
const report = {
  generatedAt: new Date().toISOString(),
  base,
  executablePath,
  summary: { passed, failed, blocked, total: results.length },
  requests,
  notFound,
  results,
}
await writeFile(resultPath, JSON.stringify(report, null, 2))

for (const result of results) {
  console.log(`\n${result.status} ${result.name}`)
  for (const step of result.steps) {
    console.log(`  ${step.ok ? "PASS" : "FAIL"} ${step.name}${step.detail ? ` — ${step.detail}` : ""}`)
  }
  if (result.pageErrors.length) console.log(`  pageErrors: ${result.pageErrors.join(" | ")}`)
  if (result.consoleErrors.length) console.log(`  consoleErrors: ${result.consoleErrors.join(" | ")}`)
}
console.log(
  `\n${passed} passed, ${failed} failed, ${blocked} blocked. Results: ${resultPath}`
)
if (failed > 0 || blocked > 0) process.exitCode = 1
