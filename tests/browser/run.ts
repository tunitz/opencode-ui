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
import { basename, join, resolve } from "node:path"
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from "playwright-core"

import { buildFixture } from "./build"
import { findChromiumExecutable } from "./chromium"
import { parseSessionShortcuts, updateSessionShortcut } from "@/lib/session-shortcuts"

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
const fsListRequests: string[] = []
const notFound: string[] = []
let fixtureShortcuts = parseSessionShortcuts(null)
const shortcutRequests: Array<{ id: string; change: Record<string, unknown> }> = []
const results: Result[] = []

type FixtureSpace = {
  id: string
  name: string
  projectDir: string | null
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
}

type FixtureNote = {
  id: string
  spaceID: string | null
  title: string
  body: string
  status:
    | "idea"
    | "todo"
    | "in-progress"
    | "blocked"
    | "finished"
    | "cancelled"
    | "archived"
  pinned: boolean
  attachments: {
    id: string
    name: string
    mime: string
    size: number
    createdAt: number
  }[]
  revision: number
  createdAt: number
  updatedAt: number
}

const fixtureSpaces: FixtureSpace[] = [
  {
    id: "space-ideas",
    name: "Ideas",
    projectDir: null,
    pinned: true,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "space-work",
    name: "Work",
    projectDir: "/synthetic/notes",
    pinned: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

const fixtureNotes: FixtureNote[] = [
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
    status: "in-progress",
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
    status: "todo",
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
    status: "finished",
    pinned: false,
    attachments: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "note-idea",
    spaceID: "space-ideas",
    title: "Idea sketch",
    body: "Field notes for the next iteration.",
    status: "idea",
    pinned: false,
    attachments: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

type NotesRequest = { method: string; input: Record<string, unknown> }
const notesRequests: NotesRequest[] = []

function spacesFor(directory: string | null): FixtureSpace[] {
  if (!directory) return [...fixtureSpaces]
  return fixtureSpaces.filter(
    (space) => space.projectDir === null || space.projectDir === directory
  )
}

function notesFor(directory: string | null): FixtureNote[] {
  const visible = new Set(spacesFor(directory).map((space) => space.id))
  return fixtureNotes.filter(
    (note) => note.spaceID === null || visible.has(note.spaceID)
  )
}

function notesMethodResponse(method: string, input: Record<string, unknown>) {
  const directory = typeof input.directory === "string" ? input.directory : null
  const spaces = spacesFor(directory)
  const visibleNotes = notesFor(directory)
  if (method === "list") {
    const pinned = input.pinned === true
    const status = typeof input.status === "string" ? input.status : null
    const statuses = Array.isArray(input.statuses)
      ? new Set(
          input.statuses.filter(
            (value): value is string => typeof value === "string"
          )
        )
      : null
    const spaceID = typeof input.spaceID === "string" ? input.spaceID : null
    const unassigned = input.spaceID === null
    const filtered = visibleNotes.filter(
      (note) =>
        (!pinned || note.pinned) &&
        (!status || note.status === status) &&
        (!statuses || statuses.has(note.status)) &&
        (!spaceID || note.spaceID === spaceID) &&
        (!unassigned || note.spaceID === null)
    )
    const offset = typeof input.offset === "number" ? input.offset : 0
    const limit = typeof input.limit === "number" ? input.limit : 500
    const page = filtered.slice(offset, offset + limit)
    return json({
      notes:
        input.includeBodies === false
          ? page.map((note) => ({ ...note, body: "" }))
          : page,
      total: filtered.length,
    })
  }
  if (method === "spaces") {
    // Global spaces are included unless a caller opts out.
    const scoped =
      input.includeGlobal === false
        ? spaces.filter((space) => space.projectDir !== null)
        : spaces
    return json({ spaces: scoped, total: scoped.length })
  }
  if (method === "get") {
    const note = fixtureNotes.find((item) => item.id === input.noteID)
    return note
      ? json({ note })
      : json(
          { error: { code: "note_not_found", message: "Note not found" } },
          404
        )
  }
  if (method === "create") {
    const now = Date.now()
    const note: FixtureNote = {
      id: `note-${fixtureNotes.length + 1}`,
      spaceID: typeof input.spaceID === "string" ? input.spaceID : null,
      title: typeof input.title === "string" ? input.title : "Untitled",
      body: typeof input.body === "string" ? input.body : "",
      status: (typeof input.status === "string"
        ? input.status
        : "todo") as FixtureNote["status"],
      pinned: input.pinned === true,
      attachments: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    fixtureNotes.push(note)
    return json({ note })
  }
  if (method === "update") {
    const existing = fixtureNotes.find((note) => note.id === input.noteID)
    if (!existing)
      return json(
        { error: { code: "note_not_found", message: "Note not found" } },
        404
      )
    const next: FixtureNote = {
      ...existing,
      ...(typeof input.title === "string" ? { title: input.title } : {}),
      ...(typeof input.body === "string" ? { body: input.body } : {}),
      ...(typeof input.status === "string"
        ? { status: input.status as FixtureNote["status"] }
        : {}),
      ...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
      ...(input.spaceID === null || typeof input.spaceID === "string"
        ? { spaceID: input.spaceID as string | null }
        : {}),
      revision: existing.revision + 1,
      updatedAt: Date.now(),
    }
    fixtureNotes.splice(fixtureNotes.indexOf(existing), 1, next)
    return json({ note: next })
  }
  if (method === "delete") {
    const index = fixtureNotes.findIndex((note) => note.id === input.noteID)
    if (index >= 0) fixtureNotes.splice(index, 1)
    return json({ deleted: index >= 0 })
  }
  if (method === "createSpace") {
    const now = Date.now()
    const space: FixtureSpace = {
      id: `space-${fixtureSpaces.length + 1}`,
      name: typeof input.name === "string" ? input.name : "Space",
      projectDir:
        typeof input.projectDir === "string" ? input.projectDir : null,
      pinned: input.pinned === true,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    fixtureSpaces.push(space)
    return json(space)
  }
  if (method === "updateSpace") {
    const existing = fixtureSpaces.find((space) => space.id === input.spaceID)
    if (!existing)
      return json(
        { error: { code: "space_not_found", message: "Space not found" } },
        404
      )
    const next: FixtureSpace = {
      ...existing,
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(input.projectDir === null || typeof input.projectDir === "string"
        ? { projectDir: input.projectDir as string | null }
        : {}),
      ...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
      revision: existing.revision + 1,
      updatedAt: Date.now(),
    }
    fixtureSpaces.splice(fixtureSpaces.indexOf(existing), 1, next)
    return json(next)
  }
  if (method === "deleteSpace") {
    const existing = fixtureSpaces.find((space) => space.id === input.spaceID)
    if (!existing)
      return json(
        { error: { code: "space_not_found", message: "Space not found" } },
        404
      )
    const count = fixtureNotes.filter(
      (note) => note.spaceID === existing.id
    ).length
    if (count > 0)
      return json(
        {
          error: {
            code: "space_not_empty",
            message: `Space has ${count} notes`,
          },
        },
        409
      )
    fixtureSpaces.splice(fixtureSpaces.indexOf(existing), 1)
    return json({ deleted: true, deletedNotes: 0 })
  }
  return json(
    {
      error: { code: "invalid", message: `Unsupported notes method ${method}` },
    },
    400
  )
}

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

// Long agent identifiers, descriptions, and model slugs mirror a real global
// catalog closely enough to stress the Settings workspace's layout without
// reading anything from the machine running the test.
const syntheticAgentName =
  "Orchestrator with an extremely long multi-word identifier for mobile layouts that keeps going"
const syntheticAgentID =
  "orchestrator-with-an-extremely-long-multi-word-identifier-for-mobile-layouts-and-then-some-more"
const syntheticAgentDescription =
  "Coordinates repository-wide refactors, reviews every generated patch, verifies command output, " +
  "and keeps synthetic browser fixtures aligned with the production Settings workspace layout across " +
  "320px, 390px, and desktop widths without truncating important model selection context. ".repeat(
    3
  )

function syntheticAgentSource(values: Record<string, unknown> = {}) {
  return {
    kind: "markdown",
    relativePath: `agents/${syntheticAgentID}.md`,
    label: `Global agents/${syntheticAgentID}.md`,
    exists: true,
    hash: "hash-source",
    values,
  }
}

function syntheticAgentEffective(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      providerID: "commandcode",
      id: "deepseek-v4.1-flash-extended-context-preview-2026-11-01",
    },
    description: syntheticAgentDescription,
    mode: "primary",
    hidden: false,
    steps: null,
    disabled: null,
    ...overrides,
  }
}

const syntheticAgentCatalog = {
  scope: "global",
  project: null,
  sourceLabel: "~/.config/opencode",
  agents: [
    {
      id: syntheticAgentID,
      name: syntheticAgentName,
      effective: syntheticAgentEffective(),
      source: syntheticAgentSource({
        model: {
          providerID: "commandcode",
          id: "deepseek-v4.1-flash-extended-context-preview-2026-11-01",
        },
        description: syntheticAgentDescription,
      }),
      target: {
        ...syntheticAgentSource(),
        label: `Editable agents/${syntheticAgentID}.md`,
      },
      readonly: false,
      permissionsReadOnly: false,
      warnings: [],
    },
    {
      id: "build",
      name: "Build",
      effective: syntheticAgentEffective({
        description: "Implements changes and runs verification.",
        mode: "primary",
      }),
      source: syntheticAgentSource({
        description: "Implements changes and runs verification.",
      }),
      target: syntheticAgentSource(),
      readonly: false,
      permissionsReadOnly: false,
      warnings: [],
    },
    {
      id: "subagent-with-a-long-identifier-for-command-review-and-diff-analysis",
      name: "Command review and diff analysis subagent with a long name",
      effective: syntheticAgentEffective({
        description:
          "Reviews shell commands and diffs, then reports risk with file-level evidence. ".repeat(
            4
          ),
        mode: "subagent",
        model: {
          providerID: "anthropic",
          id: "claude-sonnet-4-5-20250929-thinking-extended-context",
        },
      }),
      source: null,
      target: null,
      readonly: true,
      permissionsReadOnly: false,
      warnings: [],
    },
  ],
  warnings: [],
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
    if (pathname === "/api/ui/notes/events") {
      // A short-lived SSE reply: EventSource retries in a minute, so the
      // fixture stays quiet while checks run.
      return new Response("retry: 60000\n\n", {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/event-stream",
        },
      })
    }
    if (pathname.startsWith("/api/ui/notes/")) {
      const method = pathname.slice("/api/ui/notes/".length)
      if (request.method !== "POST")
        return json({ error: { code: "invalid", message: "Use POST." } }, 405)
      const body: unknown = await request.json().catch(() => ({}))
      const input =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {}
      notesRequests.push({ method, input })
      return notesMethodResponse(method, input)
    }
    if (pathname === "/api/ui/session-shortcuts") {
      if (request.method === "GET") return json({ shortcuts: fixtureShortcuts })
      if (request.method !== "POST") return json({ error: { code: "method_not_allowed" } }, 405)
      const body = (await request.json().catch(() => ({}))) as {
        id?: string
        change?: Record<string, unknown>
      }
      if (typeof body.id !== "string" || !body.change) return json({ error: { code: "invalid" } }, 400)
      shortcutRequests.push({ id: body.id, change: body.change })
      try {
        fixtureShortcuts = updateSessionShortcut(
          fixtureShortcuts,
          body.id,
          body.change as { pinned?: boolean; label?: string }
        )
      } catch {
        return json({ error: { code: "invalid" } }, 400)
      }
      return json({ shortcuts: fixtureShortcuts })
    }
    if (pathname === "/api/ui/plugins") {
      return json({
        engineAvailable: true,
        plugins: [
          {
            id: "notes",
            registered: true,
            connected: true,
            restartRequired: false,
          },
        ],
      })
    }
    if (pathname === "/api/ui/agents") {
      return request.method === "GET"
        ? json(syntheticAgentCatalog)
        : json(
            {
              error: {
                code: "read_only",
                message: "Synthetic agent catalog is read-only.",
              },
            },
            405
          )
    }
    if (pathname === "/api/ui/auth/status") {
      return json({ configured: true, required: true, authenticated: true })
    }
    if (pathname === "/api/ui/environment") {
      return json({ homeDirectory: "/home/synthetic" })
    }
    if (pathname === "/api/location") {
      const requested =
        url.searchParams.get("location[directory]") ??
        url.searchParams.get("location") ??
        ""
      const project = requested.startsWith("/synthetic/worktrees/alpha")
        ? "p-alpha"
        : requested.startsWith("/synthetic/alpha")
          ? "p-alpha"
          : requested.startsWith("/synthetic/notes")
            ? "p-notes"
            : requested.startsWith("/synthetic/location")
              ? "p-location"
              : null
      if (!project)
        return json(
          {
            error: {
              code: "location_not_found",
              message: "Unknown synthetic location.",
            },
          },
          404
        )
      return json({ project: { id: project }, directory: requested })
    }

    if (pathname === "/api/worktree") {
      requests.push({
        method: request.method,
        path: pathname,
        projectID: url.searchParams.get("projectID"),
      })
      if (request.method !== "GET")
        return json({ message: "Synthetic read-only route." }, 405)
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
      const location = url.searchParams.get("location[directory]") ?? ""
      fsListRequests.push(location)
      // One synthetic level per directory, so the space editor's drill-down has
      // real children to walk into and files plus dot-directories to ignore.
      const levels: Record<string, { path: string; type: string }[]> = {
        "/": [
          { path: "home", type: "directory" },
          { path: "synthetic", type: "directory" },
          { path: ".cache", type: "directory" },
          { path: "notes.txt", type: "file" },
        ],
        "/synthetic": [
          { path: "alpha", type: "directory" },
          { path: "notes", type: "directory" },
          { path: "secret", type: "directory" },
          { path: ".git", type: "directory" },
          { path: "README.md", type: "file" },
        ],
        "/synthetic/alpha": [
          { path: "src", type: "directory" },
          { path: "README.md", type: "file" },
        ],
      }
      return json({
        data: levels[location] ?? [
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
    if (pathname === "/api/project") {
      return json([
        { id: "p-alpha", canonical: "/synthetic/alpha" },
        { id: "p-notes", canonical: "/synthetic/notes" },
        { id: "p-location", canonical: "/synthetic/location" },
      ])
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

    const relative =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
    const filePath = resolve(outDir, relative)
    if (
      !filePath.startsWith(`${outDir}/`) &&
      filePath !== join(outDir, "index.html")
    ) {
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

const executablePath = findChromiumExecutable()
let browser: Browser | null = null
let blocker: string | null = null

if (!executablePath) {
  blocker =
    "No installed Chromium executable was found under ~/.cache/ms-playwright (set OPENCODE_UI_CHROMIUM to override); no browser tests ran."
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
  options: {
    hasTouch?: boolean
    reducedMotion?: "reduce" | "no-preference"
    dir?: "ltr" | "rtl"
  } = {}
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
        if (dir) {
          const applyDirection = () =>
            document.documentElement?.setAttribute("dir", dir)
          applyDirection()
          // Init scripts can run before the first document element exists
          // (for example on the initial empty document); retry once the
          // document has parsed so the direction still applies.
          if (!document.documentElement) {
            document.addEventListener("readystatechange", applyDirection, {
              once: true,
            })
          }
        }
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
  await page
    .locator("[data-fixture]")
    .waitFor({ state: "visible", timeout: 10_000 })
  return { context, page, pageErrors, consoleErrors }
}

async function resetQa(page: Page) {
  await page.evaluate(() => {
    const qa = (
      window as unknown as {
        __qa: {
          calls: unknown[]
          openedFiles: unknown[]
          navigations: unknown[]
        }
      }
    ).__qa
    qa.calls.length = 0
    qa.openedFiles.length = 0
    qa.navigations.length = 0
  })
}

async function qaCalls(
  page: Page
): Promise<{ kind: string; value?: string }[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __qa: { calls: { kind: string; value?: string }[] }
        }
      ).__qa.calls
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
  return poll(async () => {
    const value = await locator.boundingBox()
    if (!value) return null
    if (edge === "left") return Math.abs(value.x) <= 1 ? value : null
    return Math.abs(value.y + value.height - viewport.height) <= 1
      ? value
      : null
  }, `sheet did not settle at the ${edge} edge`)
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
  await run(
    "desktop session navigation, tree expansion, date grouping and local labels",
    async ({ check }) => {
      const opened = await openPage({ width: 1280, height: 900 }, "nav")
      const page = opened.page
      try {
        await resetQa(page)
        await page.locator("aside").waitFor({ state: "visible" })
        await page
          .getByText("Alpha", { exact: true })
          .waitFor({ state: "visible" })

        const sidebarVisible = await page.locator("aside").isVisible()
        check("desktop sidebar is visible", sidebarVisible)

        const alphaRow = page.locator('button[data-session-id="s-alpha"]')
        const alphaBox = await alphaRow.boundingBox()
        check(
          "session row is at least 44px tall",
          (alphaBox?.height ?? 0) >= 44,
          `height=${alphaBox?.height}`
        )

        const expand = page.getByRole("button", {
          name: "Show subagents for Alpha",
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
          await page.locator('button[data-session-id="s-beta"]').isVisible()
        )
        const collapse = page.getByRole("button", {
          name: "Hide subagents for Alpha",
        })
        check(
          "subagent expand control reports expanded",
          (await collapse.getAttribute("aria-expanded")) === "true"
        )

        await page.locator('button[data-session-id="s-beta"]').click()
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
          (await page
            .locator("aside")
            .getByRole("button", { name: "Return to parent session" })
            .count()) === 0
        )
        await page.locator('button[data-session-id="s-alpha"]').click()
        await page.getByText("Active: s-alpha").waitFor({ state: "visible" })
        check(
          "pinned group is hidden when no session is pinned",
          (await page
            .getByRole("button", { name: /^Pinned sessions/ })
            .count()) === 0
        )

        await page
          .getByRole("button", { name: "Session actions: Alpha" })
          .click()
        await page.getByRole("menuitem", { name: "Pin session" }).click()
        await page
          .getByRole("menuitem", { name: "Pin session" })
          .waitFor({ state: "detached" })
        check(
          "pinning sends the change to the shared server record",
          shortcutRequests.some((entry) => entry.id === "s-alpha" && entry.change.pinned === true),
          JSON.stringify(shortcutRequests)
        )

        await page
          .getByRole("region", { name: "Pinned sessions" })
          .getByRole("button", { name: "Session actions: Alpha" })
          .click()
        await page.getByRole("menuitem", { name: "Edit local label" }).click()
        await page.getByRole("heading", { name: "Edit local label" }).waitFor()
        await page.getByLabel("Local session label").fill("Synthetic label")
        await page.getByRole("button", { name: "Save label" }).click()
        await page
          .getByText("Synthetic label", { exact: true })
          .first()
          .waitFor({ state: "visible" })
        check(
          "label is stored in the shared server record",
          shortcutRequests.some(
            (entry) => entry.id === "s-alpha" && entry.change.label === "Synthetic label"
          ),
          JSON.stringify(shortcutRequests)
        )

        const pinnedGroup = page.getByRole("button", {
          name: /^Pinned sessions/,
        })
        check(
          "pinned group appears once a session is pinned",
          await pinnedGroup.isVisible()
        )
        check(
          "pinned sessions default expanded and still show in their date group",
          (await page.locator('button[data-session-id="s-alpha"]').count()) === 2,
          `rows=${await page.locator('button[data-session-id="s-alpha"]').count()}`
        )
        await pinnedGroup.click()
        check(
          "collapsing the pinned group hides only its rows",
          (await page.locator('button[data-session-id="s-alpha"]').count()) === 1,
          `rows=${await page.locator('button[data-session-id="s-alpha"]').count()}`
        )
        await pinnedGroup.click()

        const previous = page.getByRole("button", { name: "Previous" })
        await previous.waitFor({ state: "visible" })
        await previous.click()
        check(
          "date grouping keeps older sessions reachable",
          await page.locator('button[data-session-id="s-gamma"]').isVisible()
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
            (await page.locator('button[data-session-id="s-alpha"]').count()) === 0
        )
        await page.getByRole("button", { name: "Expand sidebar" }).click()
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-sidebar="sessions"]')
          return element ? element.getBoundingClientRect().width > 260 : false
        })
        check(
          "expanding the desktop sidebar restores the session list",
          await page.locator('button[data-session-id="s-alpha"]').first().isVisible()
        )

        await page.getByRole("button", { name: /^Pinned sessions/ }).click()
        await page
          .getByRole("button", { name: "Session actions: Alpha" })
          .first()
          .click()
        await page.getByRole("menuitem", { name: "Unpin session" }).click()
        check(
          "pinned group disappears when the last pinned session is unpinned",
          (await page
            .getByRole("button", { name: /^Pinned sessions/ })
            .count()) === 0
        )

        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        check(
          "no console errors",
          opened.consoleErrors.length === 0,
          opened.consoleErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("desktop session navigation")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Desktop and mobile project worktrees entry + focus
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "desktop project worktrees entry uses the explicit active project id and restores focus",
    async ({ check }) => {
      const opened = await openPage({ width: 1280, height: 900 }, "nav")
      const page = opened.page
      try {
        requests.length = 0
        fsListRequests.length = 0
        const entry = page.getByRole("button", { name: "Project worktrees" })
        await entry.waitFor({ state: "visible" })
        const entryBox = await entry.boundingBox()
        check(
          "desktop worktrees entry is at least 44px tall",
          (entryBox?.height ?? 0) >= 44,
          `height=${entryBox?.height}`
        )
        await entry.click()

        const heading = page.getByRole("heading", {
          name: "Worktrees",
          level: 2,
        })
        await heading.waitFor({ state: "visible" })
        const dialog = page
          .locator('[data-slot="dialog-content"]')
          .filter({ has: heading })
        check(
          "desktop worktrees surface is a centered dialog",
          await dialog.isVisible()
        )

        const request = await poll(
          async () =>
            requests.find(
              (entryRequest) => entryRequest.path === "/api/worktree"
            ),
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

        // The worktrees subsection is contextual and visible without opening the
        // directory options.
        const worktreeRow = dialog.locator(
          '[data-worktree-worktree="/synthetic/worktrees/alpha"]'
        )
        await worktreeRow.waitFor({ state: "visible" })
        const worktreeRowBox = await worktreeRow.boundingBox()
        check(
          "contextual worktree rows remain 44px touch targets",
          (worktreeRowBox?.height ?? 0) >= 44,
          `height=${worktreeRowBox?.height}`
        )
        check(
          "the old two-level project list is gone",
          (await page
            .locator("[data-worktree-project], [data-worktree-back]")
            .count()) === 0
        )

        // The shared directory browser is the only navigation.
        await page.getByLabel("Project or worktree directory").click()
        await page
          .locator('[data-directory="/synthetic/alpha/src"]')
          .waitFor({ state: "visible" })
        check(
          "the prefilled project directory lists its children through /api/fs/list",
          fsListRequests.includes("/synthetic/alpha"),
          JSON.stringify(fsListRequests)
        )

        await page
          .getByRole("button", { name: "Close", exact: true })
          .first()
          .click()
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
        await page
          .getByRole("heading", { name: "Worktrees", level: 2 })
          .waitFor({ state: "visible" })
        const scopedRequest = await poll(
          async () =>
            requests.find(
              (entryRequest) => entryRequest.path === "/api/worktree"
            ),
          "scoped worktree request was not observed"
        )
        check(
          "project scope passes the selected project id instead of the active session project",
          scopedRequest.projectID === "p-location",
          `projectID=${scopedRequest.projectID}`
        )
        const scopedDialog = page
          .locator('[data-slot="dialog-content"]')
          .filter({
            has: page.getByRole("heading", { name: "Worktrees", level: 2 }),
          })
        check(
          "project scope prefills its canonical directory",
          (await page
            .getByLabel("Project or worktree directory")
            .inputValue()) === "/synthetic/location"
        )
        await page.getByRole("button", { name: "New session here" }).click()
        await scopedDialog.waitFor({ state: "detached" })
        const sessionCalls = await qaCalls(page)
        check(
          "New session here creates a session in the chosen directory",
          sessionCalls.some((call) => call.kind === "createSession"),
          JSON.stringify(sessionCalls)
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("desktop project worktrees")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "mobile sessions sheet navigation, sheet closure and project worktrees focus",
    async ({ check }) => {
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
        check(
          "desktop sidebar is hidden at 390px",
          !(await page.locator("aside").isVisible())
        )

        await sheetTrigger.click()
        const sessionsSheet = page.locator(
          '[data-slot="sheet-content"][data-side="left"]'
        )
        await sessionsSheet.waitFor({ state: "visible" })
        const sheetBox = await poll(async () => {
          const value = await sessionsSheet.boundingBox()
          return value && Math.abs(value.x) <= 1 ? value : null
        }, "mobile sessions sheet did not settle at the left edge")
        check(
          "mobile sessions sheet enters from the left and stays within the viewport",
          Boolean(
            sheetBox &&
            Math.abs(sheetBox.x) <= 1 &&
            sheetBox.width <= 390 &&
            sheetBox.height >= 800
          ),
          JSON.stringify(sheetBox)
        )
        const mobileAlpha = sessionsSheet.locator('button[data-session-id="s-alpha"]')
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
          ;(
            window as unknown as { __qaWorktreeOrder: typeof state }
          ).__qaWorktreeOrder = state
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
            attributeFilter: [
              "data-starting-style",
              "data-ending-style",
              "style",
              "class",
            ],
          })
          ;(
            window as unknown as { __qaWorktreeObserver: MutationObserver }
          ).__qaWorktreeObserver = observer
          check()
        })
        const worktreesEntry = sessionsSheet.getByRole("button", {
          name: "Project worktrees",
        })
        await worktreesEntry.click()
        await sessionsSheet.waitFor({ state: "hidden" })

        const heading = page.getByRole("heading", {
          name: "Worktrees",
          level: 2,
        })
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
          async () =>
            requests.find(
              (entryRequest) => entryRequest.path === "/api/worktree"
            ),
          "mobile worktree request was not observed"
        )
        check(
          "mobile worktree entry passes the explicit active project id",
          worktreeRequest.projectID === "p-alpha",
          `projectID=${worktreeRequest.projectID}`
        )
        const worktreeSheet = page
          .locator('[data-slot="sheet-content"][data-side="bottom"]')
          .filter({ has: heading })
        const worktreeBox = await settledEdge(page, worktreeSheet, "bottom")
        check(
          "mobile worktrees surface opens only after the sessions sheet closed and as a bottom sheet",
          (await sessionsSheet.isVisible()) === false &&
            Boolean(
              worktreeBox &&
              Math.abs(worktreeBox.y + worktreeBox.height - 844) <= 1 &&
              worktreeBox.width === 390
            ),
          JSON.stringify(worktreeBox)
        )

        await worktreeSheet
          .getByRole("button", { name: "Close", exact: true })
          .first()
          .click()
        await worktreeSheet.waitFor({ state: "detached" })
        const focusAfterWorktrees = await activeElement(page)
        check(
          "closing mobile worktrees leaves focus on a visible control (not the closed sheet)",
          focusAfterWorktrees.tag !== "BODY" &&
            Boolean(focusAfterWorktrees.ariaLabel || focusAfterWorktrees.text),
          JSON.stringify(focusAfterWorktrees)
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("mobile sessions sheet")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Mobile rename/label dialogs anchor and restore focus
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "mobile rename dialog is a bottom sheet and restores focus to session actions",
    async ({ check }) => {
      const opened = await openPage({ width: 390, height: 844 }, "nav")
      const page = opened.page
      try {
        await page.getByRole("button", { name: "Open sessions" }).click()
        const sheet = page.locator(
          '[data-slot="sheet-content"][data-side="left"]'
        )
        await sheet.waitFor({ state: "visible" })
        await sheet
          .getByRole("button", { name: "Session actions: Alpha" })
          .click()
        await page.getByRole("menuitem", { name: /Rename session/ }).click()
        const heading = page.getByRole("heading", { name: "Rename session" })
        await heading.waitFor({ state: "visible" })
        const renameSheet = page
          .locator('[data-slot="sheet-content"][data-side="bottom"]')
          .filter({ has: heading })
        const renameBox = await settledEdge(page, renameSheet, "bottom")
        check(
          "mobile rename uses a bottom sheet anchored to the viewport bottom",
          Boolean(
            renameBox && Math.abs(renameBox.y + renameBox.height - 844) <= 1
          ),
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
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("mobile rename dialog")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Command center
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "desktop command center shortcut, search selection and focus return",
    async ({ check }) => {
      const opened = await openPage({ width: 1280, height: 900 }, "command")
      const page = opened.page
      try {
        await resetQa(page)
        const trigger = page.getByRole("button", {
          name: "Open command center",
        })
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
          Boolean(
            (await dialog.boundingBox())?.y &&
            (await dialog.boundingBox())!.y < 400
          )
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
          calls.some(
            (call) => call.kind === "selectSession" && call.value === "s-beta"
          ),
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
        check(
          "Ctrl+K opens the command center outside inputs",
          await dialog.isVisible()
        )
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
        check(
          "composer shortcut leaves text editing focus alone",
          (await activeElement(page)).ariaLabel === "Synthetic note field"
        )
        const terminal = page.getByLabel("Synthetic terminal")
        await terminal.focus()
        await page.keyboard.press("Alt+Shift+c")
        check(
          "composer shortcut leaves terminal focus alone",
          (await activeElement(page)).ariaLabel === "Synthetic terminal"
        )
        await trigger.focus()
        await page.keyboard.press("Alt+Shift+c")
        check(
          "Alt+Shift+C focuses the composer outside editable surfaces",
          (await activeElement(page)).ariaLabel === "Message"
        )

        await trigger.click()
        await search.fill("model settings")
        await search.press("Enter")
        const modelSheet = page.getByRole("dialog").filter({
          has: page.getByRole("heading", { name: "Model settings" }),
        })
        await modelSheet.waitFor({ state: "visible" })
        check(
          "command center opens the active session model settings",
          await modelSheet.isVisible()
        )
        check(
          "desktop model settings open as an anchored popover, not a side sheet",
          (await page
            .locator('[data-slot="popover-content"]')
            .filter({
              has: page.getByRole("heading", { name: "Model settings" }),
            })
            .count()) === 1 &&
            (await page
              .locator('[data-slot="sheet-content"]')
              .filter({
                has: page.getByRole("heading", { name: "Model settings" }),
              })
              .count()) === 0
        )
        await page.keyboard.press("Alt+Shift+c")
        check(
          "composer shortcut does not steal focus from a modal",
          (await activeElement(page)).ariaLabel !== "Message"
        )
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
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("desktop command center")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "mobile command center bottom sheet, selection and focus return",
    async ({ check }) => {
      const opened = await openPage({ width: 390, height: 844 }, "command")
      const page = opened.page
      try {
        await resetQa(page)
        const trigger = page.getByRole("button", {
          name: "Open command center",
        })
        const triggerBox = await trigger.boundingBox()
        check(
          "mobile command center trigger is a 44px touch target",
          (triggerBox?.width ?? 0) >= 44 && (triggerBox?.height ?? 0) >= 44,
          JSON.stringify(triggerBox)
        )
        await trigger.click()
        const heading = page.getByRole("heading", { name: "Command center" })
        await heading.waitFor({ state: "visible" })
        const sheet = page
          .locator('[data-slot="sheet-content"][data-side="bottom"]')
          .filter({ has: heading })
        const sheetBox = await settledEdge(page, sheet, "bottom")
        check(
          "mobile command center is a bottom sheet that does not exceed the viewport",
          Boolean(
            sheetBox &&
            Math.abs(sheetBox.y + sheetBox.height - 844) <= 1 &&
            sheetBox.width === 390
          ),
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
          calls.some(
            (call) => call.kind === "selectSession" && call.value === "s-beta"
          ),
          JSON.stringify(calls)
        )
        const focus = await activeElement(page)
        check(
          "mobile command center returns focus to its trigger",
          focus.ariaLabel === "Open command center",
          JSON.stringify(focus)
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("mobile command center")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Composer inline model settings across desktop and mobile
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "desktop composer inline model settings chips and left-aligned header",
    async ({ check }) => {
      const opened = await openPage({ width: 1440, height: 900 }, "composer")
      const page = opened.page
      try {
        const agent = page.getByRole("combobox", { name: /^Agent,/ })
        const model = page.getByRole("combobox", { name: /^Model,/ })
        const thinking = page.getByRole("combobox", {
          name: /^Thinking Level,/,
        })
        await agent.waitFor({ state: "visible" })
        check(
          "desktop composer shows the inline Agent picker",
          await agent.isVisible()
        )
        check(
          "desktop composer shows the inline Model picker",
          await model.isVisible()
        )
        check(
          "desktop composer shows the inline Thinking Level picker",
          await thinking.isVisible()
        )
        check(
          "desktop composer omits the single Active model trigger when inline pickers are active",
          (await page
            .getByRole("button", { name: /^Active model,/ })
            .count()) === 0
        )

        const titleBox = await page.locator("h1").first().boundingBox()
        const surfaceBox = await page
          .locator("[data-composer-surface]")
          .boundingBox()
        check(
          "desktop header title is left-aligned with the composer content edge",
          Boolean(
            titleBox && surfaceBox && Math.abs(titleBox.x - surfaceBox.x) <= 2
          ),
          `title=${titleBox?.x} composer=${surfaceBox?.x}`
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("desktop composer inline")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "narrow desktop composer keeps the model settings popover fallback",
    async ({ check }) => {
      const opened = await openPage({ width: 1024, height: 900 }, "composer")
      const page = opened.page
      try {
        const trigger = page.getByRole("button", { name: /^Active model,/ })
        await trigger.waitFor({ state: "visible" })
        check(
          "narrow desktop keeps the single Active model trigger",
          await trigger.isVisible()
        )
        check(
          "narrow desktop does not render inline pickers",
          (await page.getByRole("combobox", { name: /^Agent,/ }).count()) ===
            0 &&
            (await page.getByRole("combobox", { name: /^Model,/ }).count()) ===
              0 &&
            (await page
              .getByRole("combobox", { name: /^Thinking Level,/ })
              .count()) === 0
        )

        await trigger.click()
        const popover = page.locator('[data-slot="popover-content"]').filter({
          has: page.getByRole("heading", { name: "Model settings" }),
        })
        await popover.waitFor({ state: "visible" })
        check(
          "narrow desktop opens model settings as an anchored popover",
          await popover.isVisible()
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("narrow desktop composer")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "mobile composer keeps the model settings bottom sheet",
    async ({ check }) => {
      const opened = await openPage({ width: 390, height: 844 }, "composer")
      const page = opened.page
      try {
        const trigger = page.getByRole("button", { name: /^Active model,/ })
        await trigger.waitFor({ state: "visible" })
        check(
          "mobile keeps the single Active model trigger",
          await trigger.isVisible()
        )
        check(
          "mobile does not render inline pickers",
          (await page.getByRole("combobox", { name: /^Agent,/ }).count()) ===
            0 &&
            (await page.getByRole("combobox", { name: /^Model,/ }).count()) ===
              0 &&
            (await page
              .getByRole("combobox", { name: /^Thinking Level,/ })
              .count()) === 0
        )

        await trigger.click()
        const sheet = page
          .locator('[data-slot="sheet-content"][data-side="bottom"]')
          .filter({
            has: page.getByRole("heading", { name: "Model settings" }),
          })
        await sheet.waitFor({ state: "visible" })
        check(
          "mobile opens model settings as a bottom sheet",
          await sheet.isVisible()
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) => result.name.startsWith("mobile composer"))!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Changes panel and inspector flow
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "changes panel discloses only safe, existing working-tree files",
    async ({ check }) => {
      const opened = await openPage({ width: 1280, height: 900 }, "changes")
      const page = opened.page
      try {
        await resetQa(page)
        await page.getByText(/Branch:/).waitFor({ state: "visible" })
        await page.getByText("synthetic-main").waitFor({ state: "visible" })
        check(
          "changes panel labels the diff as the working tree, not a session turn",
          await page
            .getByText("VCS HEAD to working copy — not the session turn.")
            .isVisible()
        )

        await page.getByRole("button", { name: /src\/app\.ts/ }).click()
        const openFile = page.getByRole("button", {
          name: "Open read-only file",
        })
        check(
          "modified safe file offers a read-only file action",
          await openFile.isVisible()
        )
        await openFile.click()
        const qa = await page.evaluate(
          () =>
            (window as unknown as { __qa: { openedFiles: string[] } }).__qa
              .openedFiles
        )
        check(
          "opening a changed file passes its exact project-relative path",
          qa.length === 1 && qa[0] === "src/app.ts",
          JSON.stringify(qa)
        )

        await page.getByRole("button", { name: /src\/deleted\.ts/ }).click()
        check(
          "deleted files do not offer the read-only open action",
          (await page
            .getByRole("button", { name: "Open read-only file" })
            .count()) === 0
        )

        await page.getByRole("button", { name: /unsafe\.ts/ }).click()
        check(
          "unsafe paths do not offer the read-only open action",
          (await page
            .getByRole("button", { name: "Open read-only file" })
            .count()) === 0
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) => result.name.startsWith("changes panel"))!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "desktop inspector working-tree to read-only file flow",
    async ({ check }) => {
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
        await drawer
          .getByText("synthetic-main")
          .first()
          .waitFor({ state: "visible" })
        await page.getByRole("button", { name: /src\/app\.ts/ }).click()
        await page.getByRole("button", { name: "Open read-only file" }).click()
        const fileSection = page.locator(
          'section[aria-label="File src/app.ts"]'
        )
        await fileSection.waitFor({ state: "visible" })
        check(
          "Open read-only file switches the inspector to Files with that path",
          await page
            .getByRole("tab", { name: "Files" })
            .getAttribute("aria-selected")
            .then((value) => value === "true")
        )
        check(
          "the synthetic file preview is shown read-only",
          (await fileSection.textContent())?.includes("read-only") === true
        )
        check(
          "preview text comes from the synthetic read endpoint",
          (
            await page.getByLabel("File content src/app.ts").textContent()
          )?.includes("export const synthetic = true") === true
        )
        await page
          .getByRole("button", { name: "Collapse session inspector" })
          .click()
        await page.waitForFunction(() => {
          const element = document.querySelector(
            '[data-desktop-sidebar="inspector"]'
          )
          return element?.getAttribute("data-inspector-mode") === "rail"
        })
        const focus = await activeElement(page)
        check(
          "collapsing the desktop inspector focuses its rail expand control",
          focus.ariaLabel === "Expand session inspector",
          JSON.stringify(focus)
        )
        await page
          .getByRole("button", { name: "Expand session inspector" })
          .click()
        await page.waitForFunction(() => {
          const element = document.querySelector(
            '[data-desktop-sidebar="inspector"]'
          )
          return element?.getAttribute("data-inspector-mode") === "full"
        })
        check(
          "expanding the desktop inspector restores the panel",
          await drawer.getByRole("tab", { name: "Files" }).isVisible()
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("desktop inspector")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "inspector workspace covers all viewports, themes, RTL, and reduced motion",
    async ({ check }) => {
      const sizes: Array<[number, number]> = [
        [390, 844],
        [768, 900],
        [1024, 900],
        [1280, 900],
        [1440, 900],
      ]
      for (const [width, height] of sizes) {
        for (const theme of ["light", "dark"] as const) {
          const opened = await openPage({ width, height }, "inspector", {
            theme,
          })
          const page = opened.page
          try {
            if (width < 768) {
              await page
                .getByRole("button", { name: "Session inspector" })
                .click()
            }
            const drawer = page.locator(
              '[data-desktop-sidebar="inspector"], [data-fixed-drawer="inspector"]'
            )
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
              // Sub-pixel layout can report 43.99 for a 44px CSS target.
              Boolean(box && box.height >= 43.9),
              JSON.stringify(box)
            )
            check(
              `${width}x${height} ${theme} has no page errors`,
              opened.pageErrors.length === 0,
              opened.pageErrors.join(" | ")
            )
            mergeDiagnostics(
              results.find((result) =>
                result.name.startsWith("inspector workspace covers")
              )!,
              opened
            )
          } finally {
            await opened.context.close()
          }
        }
      }

      const rtl = await openPage(
        { width: 1280, height: 900 },
        "inspector",
        undefined,
        { dir: "rtl" }
      )
      try {
        await rtl.page.evaluate(() =>
          document.documentElement.setAttribute("dir", "rtl")
        )
        await rtl.page.waitForTimeout(50)
        const direction = await rtl.page.evaluate(
          () => getComputedStyle(document.documentElement).direction
        )
        const drawer = rtl.page.locator('[data-desktop-sidebar="inspector"]')
        check(
          "RTL sets the document text direction",
          direction === "rtl",
          direction
        )
        check(
          "RTL keeps all inspector tabs reachable",
          (await drawer.getByRole("tab").count()) === 5
        )
        check(
          "RTL reports no page errors",
          rtl.pageErrors.length === 0,
          rtl.pageErrors.join(" | ")
        )
        check(
          "RTL reports no console errors",
          rtl.consoleErrors.length === 0,
          rtl.consoleErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("inspector workspace covers")
          )!,
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
        await reduced.page
          .getByRole("button", { name: "Session inspector" })
          .click()
        const drawer = reduced.page.locator('[data-fixed-drawer="inspector"]')
        await drawer.waitFor({ state: "visible" })
        check(
          "reduced motion opens the inspector sheet normally",
          (await drawer.getByRole("tab").count()) === 5 &&
            reduced.pageErrors.length === 0,
          JSON.stringify(reduced.pageErrors)
        )
        const drawerBox = await settledEdge(reduced.page, drawer, "bottom")
        check(
          "mobile inspector uses about 88dvh",
          Boolean(
            drawerBox &&
            drawerBox.height > 0.85 * 844 &&
            drawerBox.height < 0.9 * 844
          ),
          JSON.stringify(drawerBox)
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("inspector workspace covers")
          )!,
          reduced
        )
      } finally {
        await reduced.context.close()
      }
    }
  )

  await run(
    "inspector tab strip advertises and scrolls hidden tabs",
    async ({ check }) => {
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
            await page
              .getByRole("button", { name: "Session inspector" })
              .click()
          }
          await scope.waitFor({ state: "visible" })

          const more = scope.getByRole("button", {
            name: "More inspector tabs",
          })
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
            await scope
              .getByRole("button", { name: "Previous inspector tabs" })
              .isVisible()
          )

          await sessionTab.click()
          await scope
            .getByText("Context & tokens")
            .waitFor({ state: "visible" })
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
            results.find((result) =>
              result.name.startsWith("inspector tab strip advertises")
            )!,
            opened
          )
        } finally {
          await opened.context.close()
        }
      }
    }
  )

  await run(
    "desktop inspector width can be dragged and persists",
    async ({ check }) => {
      const opened = await openPage({ width: 1280, height: 900 }, "inspector")
      const page = opened.page
      try {
        const panel = page.locator('[data-inspector-mode="full"]')
        const handle = page.locator("[data-inspector-resize]")
        await handle.waitFor({ state: "visible" })
        const before = await panel.evaluate(
          (element) => element.getBoundingClientRect().width
        )
        const box = await handle.boundingBox()
        if (!box) throw new Error("resize handle had no bounding box")
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x - 70, y, { steps: 5 })
        await page.mouse.up()
        const after = await panel.evaluate(
          (element) => element.getBoundingClientRect().width
        )
        check(
          "dragging the separator toward the conversation widens the inspector",
          after > before + 40,
          `before=${before} after=${after}`
        )
        const stored = await page.evaluate(() =>
          localStorage.getItem("opencode-ui:desktop-inspector-width:v1")
        )
        check(
          "the resized width is persisted",
          stored !== null && Math.abs(Number(stored) - after) < 2,
          `stored=${stored} after=${after}`
        )
        await handle.focus()
        await page.keyboard.press("ArrowRight")
        const afterKey = await panel.evaluate(
          (element) => element.getBoundingClientRect().width
        )
        check(
          "ArrowRight widens the focused separator",
          afterKey > after + 8,
          `after=${after} afterKey=${afterKey}`
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "all five inspector tabs render on desktop and mobile",
    async ({ check }) => {
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
            await page
              .getByRole("button", { name: "Session inspector" })
              .click()
          }
          await scope.waitFor({ state: "visible" })

          await scope.getByRole("tab", { name: "Command" }).click()
          check(
            `${viewport.width}px Command exposes a search field`,
            await scope
              .getByRole("textbox", {
                name: /Search actions, sessions, messages, and files/,
              })
              .isVisible()
          )

          await scope.getByRole("tab", { name: "Files" }).click()
          await scope
            .getByText("Project files", { exact: true })
            .waitFor({ state: "visible" })
          check(`${viewport.width}px Files lists project files`, true)

          await scope.getByRole("tab", { name: "Changes" }).click()
          await scope
            .getByText("synthetic-main")
            .first()
            .waitFor({ state: "visible" })
          check(
            `${viewport.width}px Changes offers both scopes`,
            (await scope
              .getByRole("button", { name: "Working tree", pressed: true })
              .count()) === 1 &&
              (await scope
                .getByRole("button", { name: "This turn" })
                .count()) === 1
          )

          await scope.getByRole("tab", { name: "Activity" }).click()
          await scope
            .getByText("Queue", { exact: true })
            .waitFor({ state: "visible" })
          check(
            `${viewport.width}px Activity shows run, queue, and attention`,
            (await scope.getByText("Run", { exact: true }).count()) >= 1 &&
              (await scope.getByText("Needs you", { exact: true }).count()) >= 1
          )

          await scope.getByRole("tab", { name: "Session" }).click()
          await scope
            .getByText("Context & tokens")
            .waitFor({ state: "visible" })
          check(
            `${viewport.width}px Session shows archive and local pin`,
            (await scope
              .getByRole("button", { name: /Archive session/ })
              .count()) === 1 &&
              (await scope
                .getByRole("button", {
                  name: /Pin in this browser|Unpin in this browser/,
                })
                .count()) === 1
          )
          check(
            `${viewport.width}px tabs report no page errors`,
            opened.pageErrors.length === 0,
            opened.pageErrors.join(" | ")
          )
          mergeDiagnostics(
            results.find((result) =>
              result.name.startsWith("all five inspector tabs")
            )!,
            opened
          )
        } finally {
          await opened.context.close()
        }
      }
    }
  )

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
          Boolean(
            drawerBox &&
            Math.abs(drawerBox.y + drawerBox.height - 844) <= 1 &&
            drawerBox.width === 390
          ),
        JSON.stringify({
          side: await drawer.getAttribute("data-side"),
          box: drawerBox,
        })
      )

      await page.getByRole("tab", { name: "Changes" }).click()
      await drawer.getByText("synthetic-main").waitFor({ state: "visible" })
      await drawer.getByRole("button", { name: /src\/app\.ts/ }).click()
      await drawer.getByRole("button", { name: "Open read-only file" }).click()
      const fileSection = drawer.locator(
        'section[aria-label="File src/app.ts"]'
      )
      await fileSection.waitFor({ state: "visible" })
      check(
        "mobile working-tree to read-only file flow completes inside the drawer",
        (await fileSection.textContent())?.includes("read-only") === true &&
          (
            await drawer.getByLabel("File content src/app.ts").textContent()
          )?.includes("export const synthetic = true") === true
      )

      await drawer
        .getByRole("button", { name: "Close session inspector" })
        .click()
      await drawer.waitFor({ state: "detached" })
      const focus = await activeElement(page)
      check(
        "closing the mobile inspector returns focus to its trigger",
        focus.ariaLabel === "Session inspector",
        JSON.stringify(focus)
      )
      check(
        "no page errors",
        opened.pageErrors.length === 0,
        opened.pageErrors.join(" | ")
      )
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
    const viewport = document.querySelector<HTMLElement>(
      '[aria-label="Conversation"]'
    )
    if (!viewport) throw new Error("Conversation viewport missing")
    const triggers = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-slot="trace-collapsible-trigger"]'
      ),
    ]
    const viewRect = viewport.getBoundingClientRect()
    const trigger = triggers.find((element) => {
      const rect = element.getBoundingClientRect()
      return (
        rect.height > 0 &&
        rect.bottom > viewRect.top + 8 &&
        rect.top < viewRect.bottom - 8
      )
    })
    if (!trigger) throw new Error("No visible disclosure trigger")
    trigger.dataset.qaAnchor = "target"
    const rect = trigger.getBoundingClientRect()
    return {
      offset: rect.top - viewRect.top,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      expanded: trigger.getAttribute("aria-expanded"),
      messageID:
        trigger.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ??
        null,
    }
  })
}

async function anchorState(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[aria-label="Conversation"]'
    )
    const trigger = document.querySelector<HTMLElement>(
      '[data-qa-anchor="target"]'
    )
    if (!viewport || !trigger) return null
    const viewRect = viewport.getBoundingClientRect()
    return {
      offset: trigger.getBoundingClientRect().top - viewRect.top,
      scrollTop: viewport.scrollTop,
      expanded: trigger.getAttribute("aria-expanded"),
      panelHeight:
        trigger.parentElement
          ?.querySelector<HTMLElement>(
            '[data-slot="trace-collapsible-content"]'
          )
          ?.getBoundingClientRect().height ?? 0,
    }
  })
}

if (browser) {
  await run(
    "conversation disclosure keeps the activated trigger anchored while it expands",
    async ({ check }) => {
      const opened = await openPage({ width: 900, height: 700 }, "conversation")
      const page = opened.page
      try {
        const viewport = page.getByRole("region", { name: "Conversation" })
        await viewport.waitFor({ state: "visible" })
        await page.waitForTimeout(300)
        await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
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
        const samples: {
          at: number
          state: NonNullable<Awaited<ReturnType<typeof anchorState>>>
        }[] = []
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
          JSON.stringify(
            samples.map((sample) => ({
              at: sample.at,
              expanded: sample.state.expanded,
              panelHeight: sample.state.panelHeight,
            }))
          )
        )
        const maxDrift = Math.max(
          ...samples.map((sample) =>
            Math.abs(sample.state.offset - before.offset)
          )
        )
        check(
          "the activated trigger does not drift during the 200ms transition and measurement",
          maxDrift <= 1.5,
          `maxDrift=${maxDrift.toFixed(2)}px samples=${JSON.stringify(samples.map((sample) => ({ at: sample.at, offset: sample.state.offset })))}`
        )
        check(
          "the expansion does not force a jump to the bottom",
          Math.abs(samples.at(-1)!.state.scrollTop - before.scrollTop) <= 1.5,
          `before=${before.scrollTop} after=${samples.at(-1)!.state.scrollTop}`
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("conversation disclosure keeps")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "mobile conversation disclosure expands from a tap without drifting",
    async ({ check }) => {
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
          const element = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
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
        const samples: {
          at: number
          state: NonNullable<Awaited<ReturnType<typeof anchorState>>>
        }[] = []
        for (const at of [0, 100, 250, 500]) {
          if (at > 0) await page.waitForTimeout(at - (samples.at(-1)?.at ?? 0))
          const state = await anchorState(page)
          if (!state)
            throw new Error(`Anchored mobile trigger disappeared at ${at}ms`)
          samples.push({ at, state })
        }
        check(
          "tap expands the disclosure",
          samples.every((sample) => sample.state.expanded === "true") &&
            samples.at(-1)!.state.panelHeight > 0
        )
        const maxDrift = Math.max(
          ...samples.map((sample) =>
            Math.abs(sample.state.offset - before.offset)
          )
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
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("mobile conversation disclosure")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "reader input cancels disclosure anchoring instead of fighting the scroll",
    async ({ check }) => {
      const opened = await openPage({ width: 900, height: 700 }, "conversation")
      const page = opened.page
      try {
        const viewport = page.getByRole("region", { name: "Conversation" })
        await viewport.waitFor({ state: "visible" })
        await page.waitForTimeout(300)
        await page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
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
        check(
          "wheel input changes the reading position",
          Boolean(afterWheel),
          JSON.stringify(afterWheel)
        )
        check(
          "wheel input moved away from the anchored offset",
          Math.abs((afterWheel?.offset ?? before.offset) - before.offset) > 1,
          JSON.stringify({ before: before.offset, after: afterWheel?.offset })
        )
        await page.waitForTimeout(450)
        const settled = await anchorState(page)
        check(
          "the canceled anchor does not restore its old position",
          Boolean(
            settled && Math.abs(settled.offset - afterWheel!.offset) <= 1.5
          ),
          JSON.stringify({
            afterWheel: afterWheel?.offset,
            settled: settled?.offset,
          })
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("reader input cancels")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "streaming growth preserves an open disclosure and the reader position",
    async ({ check }) => {
      const opened = await openPage({ width: 900, height: 700 }, "conversation")
      const page = opened.page
      try {
        await page
          .getByRole("region", { name: "Conversation" })
          .waitFor({ state: "visible" })
        await page.waitForTimeout(350)
        await page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45
        })
        await page.waitForTimeout(350)
        const before = await selectVisibleTrigger(page)
        await page.locator('[data-qa-anchor="target"]').click()
        for (let index = 1; index <= 5; index++) {
          await page.evaluate(
            (text) =>
              (
                window as unknown as Window & {
                  __qa: { stream: (text: string) => void }
                }
              ).__qa.stream(text),
            `Synthetic streamed reply ${"growing text ".repeat(index * 80)}`
          )
          await page.waitForTimeout(80)
        }
        await page.waitForTimeout(500)
        const after = await anchorState(page)
        const streamLength = await page.evaluate(
          () =>
            (
              window as unknown as Window & {
                __qa: { streamText: () => string }
              }
            ).__qa.streamText().length
        )
        check(
          "live-run store received growing streamed text",
          streamLength > 4_000,
          `characters=${streamLength}`
        )
        check(
          "disclosure remains expanded and anchored while the live run grows",
          Boolean(
            after &&
            after.expanded === "true" &&
            Math.abs(after.offset - before.offset) <= 2
          ),
          JSON.stringify({ before, after })
        )
        check(
          "stream growth does not force a bottom jump",
          Boolean(after && Math.abs(after.scrollTop - before.scrollTop) <= 2),
          JSON.stringify({ before: before.scrollTop, after: after?.scrollTop })
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "prepending older history preserves the open disclosure and reading position",
    async ({ check }) => {
      const opened = await openPage(
        { width: 900, height: 700 },
        "conversation-history"
      )
      const page = opened.page
      try {
        await page
          .getByRole("region", { name: "Conversation" })
          .waitFor({ state: "visible" })
        await page.waitForTimeout(350)
        await page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45
        })
        await page.waitForTimeout(350)
        const before = await selectVisibleTrigger(page)
        assert(before.messageID, "Visible disclosure has no message ID")
        await page.locator('[data-qa-anchor="target"]').click()
        await page.waitForTimeout(450)
        const expanded = await anchorState(page)
        assert(expanded?.expanded === "true", "Disclosure did not open")
        await page
          .getByRole("button", { name: "Load older messages" })
          .evaluate((button) => (button as HTMLElement).click())
        await page.waitForTimeout(900)
        const after = await page.evaluate((id) => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          const trigger = document.querySelector<HTMLElement>(
            `[data-message-id="${id}"] [data-slot="trace-collapsible-trigger"]`
          )
          return viewport && trigger
            ? {
                offset:
                  trigger.getBoundingClientRect().top -
                  viewport.getBoundingClientRect().top,
                expanded: trigger.getAttribute("aria-expanded"),
                scrollTop: viewport.scrollTop,
              }
            : null
        }, before.messageID)
        check(
          "older history was actually prepended",
          (await page
            .getByRole("button", { name: "Load older messages" })
            .count()) === 0
        )
        check(
          "same disclosure stays open and near its previous reading position",
          Boolean(
            after &&
            after.expanded === "true" &&
            Math.abs(after.offset - expanded.offset) <= 3
          ),
          JSON.stringify({ before: expanded, after })
        )
        check(
          "history prepend adjusts scroll position instead of jumping to bottom",
          Boolean(after && after.scrollTop > expanded.scrollTop),
          JSON.stringify({
            before: expanded.scrollTop,
            after: after?.scrollTop,
          })
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "mobile viewport resize preserves an open disclosure",
    async ({ check }) => {
      const opened = await openPage(
        { width: 390, height: 844 },
        "conversation",
        undefined,
        { hasTouch: true }
      )
      const page = opened.page
      try {
        await page
          .getByRole("region", { name: "Conversation" })
          .waitFor({ state: "visible" })
        await page.waitForTimeout(350)
        await page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.4
        })
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
        check(
          "disclosure stays expanded through keyboard-like viewport shrink and restore",
          resized?.expanded === "true" && restored?.expanded === "true",
          JSON.stringify({ resized, restored })
        )
        check(
          "viewport resize keeps the reading anchor stable",
          Boolean(
            resized &&
            restored &&
            Math.abs(resized.offset - before.offset) <= 2 &&
            Math.abs(restored.offset - before.offset) <= 2
          ),
          JSON.stringify({ before, resized, restored })
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "reader input cancels history prepend restoration",
    async ({ check }) => {
      const opened = await openPage(
        { width: 900, height: 700 },
        "conversation-history"
      )
      const page = opened.page
      try {
        const viewport = page.getByRole("region", { name: "Conversation" })
        await viewport.waitFor({ state: "visible" })
        await page.waitForTimeout(350)
        await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (el) el.scrollTop = el.scrollHeight * 0.45
        })
        await page.waitForTimeout(350)
        await selectVisibleTrigger(page)
        await page.locator('[data-qa-anchor="target"]').click()
        await page.waitForTimeout(450)
        const beforePrepend = await viewport.evaluate((el) => el.scrollTop)
        await page
          .getByRole("button", { name: "Load older messages" })
          .evaluate((button) => (button as HTMLElement).click())
        await page.waitForTimeout(300)
        const beforeWheel = await viewport.evaluate((el) => el.scrollTop)
        await viewport.hover()
        await page.mouse.wheel(0, 180)
        await page.waitForTimeout(150)
        const afterWheel = await viewport.evaluate((el) => el.scrollTop)
        await page.waitForTimeout(600)
        const settled = await viewport.evaluate((el) => el.scrollTop)
        check(
          "prepend restoration has started before wheel input",
          beforeWheel > beforePrepend + 300,
          JSON.stringify({ beforePrepend, beforeWheel })
        )
        check(
          "wheel changes position during prepend restoration",
          afterWheel - beforeWheel > 100 && afterWheel - beforeWheel < 260,
          JSON.stringify({ beforeWheel, afterWheel })
        )
        check(
          "restoration does not undo the reader's wheel input",
          Math.abs(settled - afterWheel) <= 2,
          JSON.stringify({ afterWheel, settled })
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "long tool errors open safely in a mobile sheet",
    async ({ check }) => {
      const opened = await openPage(
        { width: 390, height: 844 },
        "conversation-long-tool",
        undefined,
        { hasTouch: true }
      )
      const page = opened.page
      try {
        await page
          .getByRole("region", { name: "Conversation" })
          .waitFor({ state: "visible" })
        await page.waitForTimeout(350)
        await page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45
        })
        await page.waitForTimeout(350)
        const before = await selectVisibleTrigger(page)
        const trace = page.locator('[data-qa-anchor="target"]')
        await trace.click()
        assert(before.messageID, "Visible disclosure has no message ID")
        const traceContent = trace
          .locator("..")
          .locator('[data-slot="trace-collapsible-content"]')
        await traceContent.waitFor({ state: "visible" })
        await traceContent
          .locator('[data-slot="collapsible-trigger"]')
          .first()
          .click()
        const detailsButton = page
          .locator(`[data-message-id="${before.messageID}"]`)
          .getByRole("button", {
            name: /View full error for/,
            includeHidden: true,
          })
        await detailsButton.waitFor({ state: "visible" })
        const box = await detailsButton.boundingBox()
        check(
          "mobile long-error action is a 44px target",
          Boolean(box && box.height >= 43.5),
          JSON.stringify(box)
        )
        await detailsButton.click()
        const sheet = page.getByRole("dialog", { name: "Tool error details" })
        await sheet.waitFor({ state: "visible" })
        await page.waitForTimeout(250)
        const sheetBox = await sheet.boundingBox()
        check(
          "long error opens in a bounded bottom sheet",
          Boolean(
            sheetBox &&
            sheetBox.height <= 844 &&
            Math.abs(sheetBox.y + sheetBox.height - 844) < 2
          ),
          JSON.stringify(sheetBox)
        )
        const detail = sheet.getByRole("region", { name: "Full tool error" })
        const text = await detail.textContent()
        check(
          "sheet shows the complete bounded error as text",
          Boolean(
            text?.includes("END-OF-ERROR") &&
            text.includes("<script>bad()</script>")
          )
        )
        check(
          "tool text is not interpreted as active HTML",
          (await detail.locator("script").count()) === 0
        )
        await page.evaluate(() =>
          (
            window as unknown as Window & {
              __qa: { stream: (text: string) => void }
            }
          ).__qa.stream("synthetic stream ".repeat(400))
        )
        await page.waitForTimeout(150)
        check(
          "sheet stays open during live-run updates",
          await sheet.isVisible()
        )
        await page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (viewport) viewport.scrollTop = viewport.scrollHeight
        })
        await page.waitForTimeout(350)
        const offscreen = await page.evaluate((id) => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          const source = document.querySelector<HTMLElement>(
            `[data-message-id="${id}"]`
          )
          return Boolean(
            viewport &&
            source &&
            source.getBoundingClientRect().bottom <
              viewport.getBoundingClientRect().top
          )
        }, before.messageID)
        check(
          "source row is outside the viewport while the sheet remains open",
          offscreen &&
            (await sheet.isVisible()) &&
            (await detailsButton.count()) === 1
        )
        await sheet.getByRole("button", { name: "Close" }).click()
        await sheet.waitFor({ state: "detached" })
        check(
          "closing the sheet restores focus to its trigger",
          await detailsButton.evaluate(
            (button) => document.activeElement === button
          )
        )
        await page.keyboard.press("Enter")
        await sheet.waitFor({ state: "visible" })
        const keyboardDetail = sheet.getByRole("region", {
          name: "Full tool error",
        })
        await keyboardDetail.focus()
        check(
          "full error region is keyboard-focusable for scrolling",
          await keyboardDetail.evaluate(
            (element) => document.activeElement === element
          )
        )
        await page.keyboard.press("Escape")
        await sheet.waitFor({ state: "detached" })
        check(
          "Escape closes the sheet and restores trigger focus",
          await detailsButton.evaluate(
            (button) => document.activeElement === button
          )
        )
        await page.keyboard.press("Enter")
        await sheet.waitFor({ state: "visible" })
        await page.setViewportSize({ width: 900, height: 700 })
        await page.waitForTimeout(300)
        check(
          "rotation to desktop keeps an open sheet and its text available",
          (await sheet.isVisible()) &&
            Boolean((await sheet.textContent())?.includes("END-OF-ERROR"))
        )
        await page.keyboard.press("Escape")
        await sheet.waitFor({ state: "detached" })
        const desktopTrace = page.locator(
          `[data-message-id="${before.messageID}"] [data-slot="trace-collapsible-trigger"]`
        )
        check(
          "closing after rotation restores focus to the desktop trace",
          await desktopTrace.evaluate(
            (element) => document.activeElement === element
          )
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "long tool errors retain desktop inline disclosure",
    async ({ check }) => {
      const opened = await openPage(
        { width: 900, height: 700 },
        "conversation-long-tool"
      )
      const page = opened.page
      try {
        await page
          .getByRole("region", { name: "Conversation" })
          .waitFor({ state: "visible" })
        await page.waitForTimeout(350)
        await page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>(
            '[aria-label="Conversation"]'
          )
          if (viewport) viewport.scrollTop = viewport.scrollHeight * 0.45
        })
        await page.waitForTimeout(350)
        await selectVisibleTrigger(page)
        const trace = page.locator('[data-qa-anchor="target"]')
        await trace.click()
        const content = trace
          .locator("..")
          .locator('[data-slot="trace-collapsible-content"]')
        await content.waitFor({ state: "visible" })
        await content
          .locator('[data-slot="collapsible-trigger"]')
          .first()
          .click()
        await content
          .locator('[data-slot="collapsible-content"]')
          .waitFor({ state: "visible" })
        check(
          "desktop keeps the full error inline",
          (await content.textContent())?.includes("END-OF-ERROR")
        )
        check(
          "desktop does not introduce the mobile sheet action",
          (await content
            .getByRole("button", { name: /View full error/ })
            .count()) === 0
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "notes workspace keeps one readable pane in a narrow container",
    async ({ check }) => {
      const opened = await openPage({ width: 1024, height: 800 }, "notes")
      const page = opened.page
      try {
        const region = page.getByRole("region", { name: "Notes", exact: true })
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        check(
          "narrow container starts on the list",
          (await region.getByRole("article").count()) === 0
        )

        await page.getByRole("button", { name: "Open Release plan" }).click()
        const article = region.getByRole("article", {
          name: "Note Release plan",
        })
        await article.waitFor({ state: "visible" })
        const articleBox = await article.boundingBox()
        check(
          "detail pane fills the narrow container instead of collapsing",
          (articleBox?.width ?? 0) >= 300,
          `width=${articleBox?.width}`
        )
        check(
          "list pane is hidden while the detail is open",
          (await region.getByRole("button", { name: "Open Bugs" }).count()) ===
            0
        )
        await page.getByRole("button", { name: "Back to Notes" }).click()
        await page
          .getByRole("button", { name: "Open Bugs" })
          .waitFor({ state: "visible" })

        const filters = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (!row) return null
          const box = row.getBoundingClientRect()
          return {
            scrollWidth: row.scrollWidth,
            clientWidth: row.clientWidth,
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            buttons: [...row.querySelectorAll("button")].map((button) => {
              const rect = button.getBoundingClientRect()
              return {
                name:
                  button.getAttribute("aria-label") ??
                  button.textContent?.trim() ??
                  "",
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
                dots: button.querySelectorAll("[data-status-dot]").length,
                pressed: button.getAttribute("aria-pressed") === "true",
              }
            }),
          }
        })
        check(
          "all seven status filters plus All render in one row",
          filters?.buttons.length === 8,
          JSON.stringify(filters?.buttons.map((button) => button.name))
        )
        check(
          "the filter row scrolls sideways instead of wrapping",
          Boolean(filters && filters.scrollWidth > filters.clientWidth),
          JSON.stringify(
            filters && {
              scrollWidth: filters.scrollWidth,
              clientWidth: filters.clientWidth,
            }
          )
        )
        check(
          "no status pill is clipped vertically",
          Boolean(
            filters &&
            filters.buttons.every(
              (button) =>
                button.top >= filters.top - 1 &&
                button.bottom <= filters.bottom + 1
            )
          ),
          JSON.stringify(filters?.buttons)
        )
        check(
          "status pills keep 44px targets",
          Boolean(
            filters && filters.buttons.every((button) => button.height >= 44)
          ),
          JSON.stringify(filters?.buttons.map((button) => button.height))
        )
        check(
          "each status pill carries its own colour dot",
          Boolean(
            filters &&
            filters.buttons[0].dots === 0 &&
            filters.buttons.slice(1).every((button) => button.dots === 1)
          ),
          JSON.stringify(filters?.buttons.map((button) => button.dots))
        )
        check(
          "no uppercase category headers remain",
          Boolean(
            filters &&
            filters.buttons[0].name === "All" &&
            filters.buttons
              .slice(1)
              .every((button) => button.name.startsWith("Filter by status: "))
          ),
          JSON.stringify(filters?.buttons.map((button) => button.name))
        )
        check(
          "the filter row starts with All selected",
          Boolean(filters && filters.buttons[0].pressed),
          JSON.stringify(filters?.buttons.map((button) => button.pressed))
        )

        await page
          .getByRole("button", { name: "Filter by status: Finished (Done)" })
          .click()
        await page
          .getByRole("button", { name: "Open Shipped" })
          .waitFor({ state: "visible" })
        check(
          "selecting a pill filters the list",
          (await page.getByRole("button", { name: "Open Bugs" }).count()) === 0
        )
        check(
          "the selected pill reports pressed",
          (await page
            .getByRole("button", { name: "Filter by status: Finished (Done)" })
            .getAttribute("aria-pressed")) === "true"
        )
        await page
          .locator("[data-notes-status-filters]")
          .getByRole("button", { name: "All", exact: true })
          .click()
        await page
          .getByRole("button", { name: "Open Bugs" })
          .waitFor({ state: "visible" })

        const spacesTrigger = page.getByRole("button", {
          name: "Filter by space: All spaces",
        })
        await spacesTrigger.click()
        const spaceItems = page.getByRole("menuitemradio")
        await spaceItems.first().waitFor({ state: "visible" })
        const spaceTexts = await spaceItems.allTextContents()
        check(
          "the spaces pill lists each space once",
          spaceTexts.filter((text) => text.includes("Ideas")).length === 1 &&
            spaceTexts.filter((text) => text.includes("Work")).length === 1,
          JSON.stringify(spaceTexts)
        )
        check(
          "the space menu keeps Global and project badges",
          spaceTexts.some(
            (text) => text.includes("Ideas") && text.includes("Global")
          ) &&
            spaceTexts.some(
              (text) => text.includes("Work") && text.includes("notes")
            ),
          JSON.stringify(spaceTexts)
        )
        await page.keyboard.press("Escape")

        const count = await page
          .locator("[data-notes-status-filters]")
          .evaluate((row) => {
            const live = row.parentElement?.parentElement?.querySelector(
              '[aria-live="polite"]'
            )
            return live?.textContent?.trim() ?? ""
          })
        check(
          "the filter bar shows a live note count",
          /^\d+ notes?$/.test(count),
          count
        )

        const preview = await page
          .locator("#note-preview-note-plan")
          .textContent()
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
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "notes workspace keeps list and detail readable in a wide container",
    async ({ check }) => {
      const opened = await openPage({ width: 1440, height: 900 }, "notes-wide")
      const page = opened.page
      try {
        const region = page.getByRole("region", { name: "Notes", exact: true })
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        await page.getByRole("button", { name: "Open Release plan" }).click()
        const article = region.getByRole("article", {
          name: "Note Release plan",
        })
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
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "notes spaces render once with Global and project badges",
    async ({ check }) => {
      const opened = await openPage({ width: 1440, height: 900 }, "notes-wide")
      const page = opened.page
      try {
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        const rows = await page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              "[data-notes-spaces] > li"
            ),
          ].map((row) => ({
            id: row.dataset.spaceId,
            name: row.querySelector("p")?.textContent?.trim() ?? "",
            scope:
              row.querySelector<HTMLElement>("[data-space-scope]")?.dataset
                .spaceScope ?? "",
            badge:
              row.querySelector("[data-space-scope]")?.textContent?.trim() ??
              "",
            path:
              row.querySelector<HTMLElement>("[data-space-path]")?.dataset
                .spacePath ?? "",
            pathTitle:
              row
                .querySelector<HTMLElement>("[data-space-path]")
                ?.getAttribute("title") ?? "",
          }))
        )
        check(
          "each space is listed exactly once",
          rows.length === 2 && new Set(rows.map((row) => row.id)).size === 2,
          JSON.stringify(rows)
        )
        const ideas = rows.find((row) => row.name === "Ideas")
        const work = rows.find((row) => row.name === "Work")
        check(
          "the Global space carries a Global badge",
          ideas?.scope === "global" && ideas.badge === "Global",
          JSON.stringify(ideas)
        )
        check(
          "the project space carries its directory basename",
          work?.scope === "project" && work.badge === "notes",
          JSON.stringify(work)
        )
        check(
          "the project space shows its absolute path",
          work?.path === "/synthetic/notes" &&
            work.pathTitle === "/synthetic/notes",
          JSON.stringify(work)
        )
        check(
          "a Global space shows only the Global badge",
          ideas?.path === "" && ideas.pathTitle === "",
          JSON.stringify(ideas)
        )

        const trigger = page.getByRole("button", {
          name: "Filter by space: All spaces",
        })
        await trigger.click()
        const options = page.getByRole("menuitemradio")
        await options.first().waitFor({ state: "visible" })
        const texts = await options.allTextContents()
        check(
          "the space picker lists each space once",
          texts.filter((text) => text.includes("Ideas")).length === 1 &&
            texts.filter((text) => text.includes("Work")).length === 1,
          JSON.stringify(texts)
        )
        check(
          "the picker shows the space scope",
          texts.some(
            (text) => text.includes("Ideas") && text.includes("Global")
          ) &&
            texts.some(
              (text) => text.includes("Work") && text.includes("notes")
            ),
          JSON.stringify(texts)
        )
        await page.keyboard.press("Escape")
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "notes status menu groups all seven statuses",
    async ({ check }) => {
      const opened = await openPage({ width: 1440, height: 900 }, "notes-wide")
      const page = opened.page
      try {
        await page.getByRole("button", { name: "Open Bugs" }).click()
        await page.getByRole("button", { name: "Edit", exact: true }).click()
        await page
          .getByRole("button", { name: "Status: To do", exact: true })
          .click()
        const items = page.getByRole("menuitemradio")
        await items.first().waitFor({ state: "visible" })
        check(
          "the status menu lists all seven statuses",
          (await items.count()) === 7
        )
        const menu = await page
          .locator('[data-slot="dropdown-menu-content"]')
          .innerText()
        for (const group of ["Backlog", "Active", "Done"])
          check(
            `the status menu labels the ${group} group`,
            menu.includes(group),
            menu
          )
        check(
          "the menu names every status",
          [
            "Idea",
            "To do",
            "In progress",
            "Blocked",
            "Finished",
            "Cancelled",
            "Archived",
          ].every((label) => menu.includes(label)),
          menu
        )
        await page.keyboard.press("Escape")
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "switching notes projects never shows a confirm dialog",
    async ({ check }) => {
      const opened = await openPage({ width: 1024, height: 800 }, "notes")
      const page = opened.page
      const dialogs: string[] = []
      page.on("dialog", (dialog) => {
        dialogs.push(dialog.message())
        void dialog.dismiss()
      })
      try {
        await page.getByRole("button", { name: /^Notes\s*\d/ }).click()
        await page.getByRole("button", { name: "All notes" }).click()
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })

        await page.locator("[data-qa-switch-project]").click()
        await page.getByRole("button", { name: "All notes" }).click()
        await page
          .getByRole("button", { name: "Open Idea sketch" })
          .waitFor({ state: "visible" })
        check("the workspace follows the newly selected project", true)
        check(
          "switching projects fires no window.confirm",
          dialogs.length === 0,
          dialogs.join(" | ")
        )

        await page.locator("[data-qa-switch-project]").click()
        await page.getByRole("button", { name: "All notes" }).click()
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        check(
          "returning to a project restores it without a prompt",
          dialogs.length === 0,
          dialogs.join(" | ")
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "space editor scopes to any absolute project directory",
    async ({ check }) => {
      const opened = await openPage({ width: 1440, height: 900 }, "notes-wide")
      const page = opened.page
      try {
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        await page.getByRole("button", { name: "New space" }).click()
        await page
          .getByRole("textbox", { name: "Name", exact: true })
          .fill("Scoped")
        const directory = page.getByRole("textbox", {
          name: "Project directory",
        })
        await directory.waitFor({ state: "visible" })
        check(
          "a new space starts empty, meaning Global",
          (await directory.inputValue()) === ""
        )
        check(
          "the directory options stay hidden until the field is used",
          (await page.locator("[data-directory-options]").count()) === 0
        )

        await directory.click()
        await page
          .locator("[data-directory-options]")
          .waitFor({ state: "visible" })
        await page
          .locator('[data-directory="/synthetic"]')
          .waitFor({ state: "visible" })

        const rootRows = await page
          .locator("[data-directory]")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              path: node.getAttribute("data-directory") ?? "",
              text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
            }))
          )
        check(
          "the option list starts with Global",
          rootRows[0]?.path === "" &&
            rootRows[0].text.includes("Visible in every project"),
          JSON.stringify(rootRows)
        )
        check(
          "the root level lists only its subdirectories",
          JSON.stringify(rootRows.map((row) => row.path)) ===
            JSON.stringify(["", "/home", "/synthetic"]),
          JSON.stringify(rootRows)
        )
        check(
          "files and hidden dot-directories are not listed",
          !rootRows.some(
            (row) => row.path === "/notes.txt" || row.path === "/.cache"
          ),
          JSON.stringify(rootRows)
        )
        check(
          "each directory row names its basename and full path",
          rootRows.some(
            (row) =>
              row.path === "/synthetic" &&
              row.text.includes("synthetic") &&
              row.text.includes("/synthetic")
          ),
          JSON.stringify(rootRows)
        )

        await page.locator('[data-directory="/synthetic"]').click()
        check(
          "drilling into a row fills the input with its path",
          (await directory.inputValue()) === "/synthetic"
        )
        await page
          .locator('[data-directory="/synthetic/alpha"]')
          .waitFor({ state: "visible" })
        const childRows = await page
          .locator("[data-directory]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-directory") ?? "")
          )
        check(
          "the browser lists the drilled directory's children",
          ["/synthetic/alpha", "/synthetic/notes", "/synthetic/secret"].every(
            (path) => childRows.includes(path)
          ) && !childRows.includes("/synthetic/.git"),
          JSON.stringify(childRows)
        )
        check(
          "the drill-down lists levels through /api/fs/list",
          fsListRequests.includes("/") && fsListRequests.includes("/synthetic"),
          JSON.stringify(fsListRequests)
        )

        await page.locator('[data-directory-parent="/"]').click()
        check(
          "the up row fills the input with the parent path",
          (await directory.inputValue()) === "/"
        )
        check(
          "the up row disappears at the filesystem root",
          (await page.locator("[data-directory-parent]").count()) === 0
        )
        await page
          .locator('[data-directory="/synthetic"]')
          .waitFor({ state: "visible" })

        await page.locator('[data-directory="/synthetic"]').click()
        await page.locator('[data-directory="/synthetic/alpha"]').click()
        check(
          "drilling again follows the second level",
          (await directory.inputValue()) === "/synthetic/alpha"
        )
        await page.locator('[data-directory-parent="/synthetic"]').click()
        check(
          "the up row returns to the previous level",
          (await directory.inputValue()) === "/synthetic"
        )

        await directory.fill("/synthetic/newproj")
        const custom = page.getByRole("button", {
          name: "Use custom path: /synthetic/newproj",
        })
        await custom.waitFor({ state: "visible" })
        check("a not-yet-created path gets its own row", true)
        await custom.click()
        check(
          "the custom row fills the input",
          (await directory.inputValue()) === "/synthetic/newproj"
        )

        await page.getByRole("textbox", { name: "Name", exact: true }).click()
        check(
          "leaving the field hides the directory options",
          (await page.locator("[data-directory-options]").count()) === 0
        )

        await page.getByRole("button", { name: "Save space" }).click()
        const created = await poll(
          async () =>
            notesRequests
              .filter((entry) => entry.method === "createSpace")
              .at(-1),
          "the space was not saved"
        )
        check(
          "saving writes the custom path as projectDir without an existence check",
          created?.input.name === "Scoped" &&
            created?.input.projectDir === "/synthetic/newproj",
          JSON.stringify(created)
        )
        await page
          .getByRole("button", { name: "Save space" })
          .waitFor({ state: "detached" })
        check(
          "the editor closes after saving a space scoped elsewhere",
          (await page.getByRole("button", { name: "Save space" }).count()) === 0
        )
        check(
          "only one space was created",
          notesRequests.filter((entry) => entry.method === "createSpace")
            .length === 1
        )
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "notes workspace fits a mobile viewport without horizontal overflow",
    async ({ check }) => {
      const opened = await openPage({ width: 390, height: 844 }, "notes")
      const page = opened.page
      try {
        const region = page.getByRole("region", { name: "Notes", exact: true })
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        const overflow = await page.evaluate(() => {
          const section = document.querySelector<HTMLElement>(
            'section[aria-label="Notes"]'
          )
          return {
            document: document.documentElement.scrollWidth - window.innerWidth,
            section: section ? section.scrollWidth - section.clientWidth : 1,
          }
        })
        check(
          "notes list introduces no horizontal overflow",
          overflow.document <= 1 && overflow.section <= 1,
          JSON.stringify(overflow)
        )
        const listBox = await region
          .getByRole("button", { name: "Open Release plan" })
          .boundingBox()
        check(
          "list rows stay inside the viewport",
          Boolean(
            listBox && listBox.x >= 0 && listBox.x + listBox.width <= 390
          ),
          JSON.stringify(listBox)
        )

        await page.getByRole("button", { name: "Open Release plan" }).click()
        const article = region.getByRole("article", {
          name: "Note Release plan",
        })
        await article.waitFor({ state: "visible" })
        const articleBox = await article.boundingBox()
        check(
          "mobile detail fills the viewport width",
          Boolean(
            articleBox &&
            articleBox.width >= 300 &&
            articleBox.x >= 0 &&
            articleBox.x + articleBox.width <= 390
          ),
          JSON.stringify(articleBox)
        )
        await page.getByRole("button", { name: "Back to Notes" }).click()
        await page
          .getByRole("button", { name: "Open Bugs" })
          .waitFor({ state: "visible" })
        check("Back to Notes returns to the list", true)
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )

  await run(
    "notes filter pills scroll sideways with a mouse wheel",
    async ({ check }) => {
      const opened = await openPage({ width: 390, height: 844 }, "notes")
      const page = opened.page
      try {
        await page
          .getByRole("button", { name: "Open Release plan" })
          .waitFor({ state: "visible" })
        const edges = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (!row) return null
          const first = row.querySelector("button")
          return {
            mask: getComputedStyle(row).maskImage,
            rowLeft: row.getBoundingClientRect().left,
            firstLeft: first?.getBoundingClientRect().left ?? 0,
            rightButton: Boolean(
              row.parentElement?.querySelector(
                '[aria-label="Scroll status filters right"]'
              )
            ),
          }
        })
        check(
          "the All pill is never masked away at the start",
          Boolean(
            edges &&
              edges.mask === "none" &&
              edges.firstLeft >= edges.rowLeft - 1
          ),
          JSON.stringify(edges)
        )
        check(
          "an overflowing filter row offers a right scroll button",
          Boolean(edges?.rightButton),
          JSON.stringify(edges)
        )
        await page
          .getByRole("button", { name: "Scroll status filters right" })
          .click()
        await page.waitForFunction(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          return Boolean(row && row.scrollLeft > 0)
        })
        check("the arrow button scrolls the filter row", true)
        await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (row) row.scrollLeft = row.scrollWidth
        })
        await page.waitForFunction(
          () =>
            !document.querySelector(
              '[aria-label="Scroll status filters right"]'
            ) &&
            Boolean(
              document.querySelector('[aria-label="Scroll status filters left"]')
            )
        )
        check("the right arrow hides at maximum scroll", true)
        const pillReveal = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (!row) return null
          row.scrollLeft = 0
          const pill = row.querySelectorAll("button")[7]
          pill.click()
          return { before: 0, label: pill.textContent?.trim() ?? "" }
        })
        await page.waitForFunction(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (!row) return false
          const pill = row.querySelectorAll("button")[7]
          const view = row.getBoundingClientRect()
          const box = pill.getBoundingClientRect()
          return row.scrollLeft > 0 && box.left >= view.left && box.right <= view.right
        })
        check(
          "clicking the clipped last filter scrolls it fully into view",
          Boolean(pillReveal),
          JSON.stringify(pillReveal)
        )
        await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (row) row.scrollLeft = 0
        })
        const wheel = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (!row) return null
          const before = row.scrollLeft
          const event = new WheelEvent("wheel", {
            deltaY: 120,
            bubbles: true,
            cancelable: true,
          })
          const dispatched = row.dispatchEvent(event)
          return {
            overflow: row.scrollWidth - row.clientWidth,
            before,
            after: row.scrollLeft,
            prevented: event.defaultPrevented,
            canceled: !dispatched,
          }
        })
        check(
          "the status filter row overflows horizontally",
          Boolean(wheel && wheel.overflow > 0),
          JSON.stringify(wheel)
        )
        check(
          "a vertical wheel scrolls the pill row sideways",
          Boolean(wheel && wheel.after > wheel.before),
          JSON.stringify(wheel)
        )
        check(
          "the translated wheel prevents the page scroll instead",
          Boolean(wheel && wheel.prevented && wheel.canceled),
          JSON.stringify(wheel)
        )

        const horizontal = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(
            "[data-notes-status-filters]"
          )
          if (!row) return null
          row.scrollLeft = 0
          const event = new WheelEvent("wheel", {
            deltaX: 120,
            deltaY: 0,
            bubbles: true,
            cancelable: true,
          })
          const dispatched = row.dispatchEvent(event)
          return {
            after: row.scrollLeft,
            prevented: event.defaultPrevented,
            canceled: !dispatched,
          }
        })
        check(
          "a trackpad horizontal gesture keeps its native behaviour",
          Boolean(
            horizontal &&
            !horizontal.prevented &&
            !horizontal.canceled &&
            horizontal.after === 0
          ),
          JSON.stringify(horizontal)
        )

        const rtl = await openPage(
          { width: 390, height: 844 },
          "notes",
          undefined,
          { dir: "rtl" }
        )
        try {
          await rtl.page
            .getByRole("button", { name: "Open Release plan" })
            .waitFor({ state: "visible" })
          await rtl.page.evaluate(() =>
            document.documentElement.setAttribute("dir", "rtl")
          )
          await rtl.page.waitForFunction(() => {
            const row = document.querySelector("[data-notes-status-filters]")
            return Boolean(row && getComputedStyle(row).direction === "rtl")
          })
          const reversed = await rtl.page.evaluate(() => {
            const row = document.querySelector<HTMLElement>(
              "[data-notes-status-filters]"
            )
            if (!row) return null
            const before = row.scrollLeft
            const event = new WheelEvent("wheel", {
              deltaY: 120,
              bubbles: true,
              cancelable: true,
            })
            const dispatched = row.dispatchEvent(event)
            return {
              direction: getComputedStyle(row).direction,
              before,
              after: row.scrollLeft,
              prevented: event.defaultPrevented,
              canceled: !dispatched,
            }
          })
          check(
            "the RTL pill row scrolls forward with a vertical wheel",
            Boolean(
              reversed &&
              reversed.direction === "rtl" &&
              reversed.prevented &&
              reversed.canceled &&
              Math.abs(reversed.after) > Math.abs(reversed.before)
            ),
            JSON.stringify(reversed)
          )
        } finally {
          await rtl.context.close()
        }
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
      } finally {
        await opened.context.close()
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Settings > Agents fit
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "Settings > Agents keeps long agent cards inside the panel at 320, 390, and desktop",
    async ({ check }) => {
      for (const width of [320, 390, 1280]) {
        const height = width === 1280 ? 900 : 844
        const opened = await openPage({ width, height }, "settings")
        const page = opened.page
        try {
          await page
            .getByRole("heading", { name: "Agents", exact: true })
            .waitFor({ state: "visible" })
          const longRow = page
            .getByRole("button", {
              name: new RegExp("Orchestrator with an extremely long"),
            })
            .first()
          await longRow.waitFor({ state: "visible" })

          const list = await page.evaluate(() => {
            const panel = document.querySelector('[role="tabpanel"]')
            if (!(panel instanceof HTMLElement)) return null
            const panelRect = panel.getBoundingClientRect()
            const cards = [
              ...panel.querySelectorAll('[data-slot="accordion-item"]'),
            ].map((element) => {
              const rect = element.getBoundingClientRect()
              return { left: rect.left, right: rect.right, width: rect.width }
            })
            const rows = [...panel.querySelectorAll("li button")].map(
              (element) => {
                const rect = element.getBoundingClientRect()
                return { right: rect.right, width: rect.width }
              }
            )
            // Any visible element wholly outside the panel means a child escaped
            // the panel, even when the document itself still clips the page.
            const offenders = [...panel.querySelectorAll("*")]
              .filter((element) => {
                const rect = element.getBoundingClientRect()
                // Skip visually hidden 1px controls and unpainted boxes.
                if (rect.width <= 1 || rect.height <= 1) return false
                return (
                  rect.right > panelRect.right + 1 ||
                  rect.left < panelRect.left - 1
                )
              })
              .slice(0, 5)
              .map((element) => ({
                tag: element.tagName,
                text: (element.textContent ?? "").trim().slice(0, 40),
                right: element.getBoundingClientRect().right,
              }))
            return {
              panelLeft: panelRect.left,
              panelRight: panelRect.right,
              panelClientWidth: panel.clientWidth,
              panelScrollWidth: panel.scrollWidth,
              cards,
              rows,
              offenders,
            }
          })
          check(
            `${width}px: tabpanel has no horizontal overflow`,
            Boolean(list && list.panelScrollWidth <= list.panelClientWidth + 1),
            JSON.stringify(
              list && {
                client: list.panelClientWidth,
                scroll: list.panelScrollWidth,
              }
            )
          )
          const listLeft = list?.panelLeft ?? 0
          const listRight = list?.panelRight ?? 0
          check(
            `${width}px: every agent card stays inside the panel`,
            Boolean(
              list &&
              list.cards.length >= 2 &&
              list.cards.every(
                (card) =>
                  card.left >= listLeft - 1 && card.right <= listRight + 1
              )
            ),
            JSON.stringify(list?.cards)
          )
          check(
            `${width}px: agent rows stay inside the card`,
            Boolean(
              list &&
              list.rows.length >= 2 &&
              list.rows.every((row) => row.right <= listRight + 1)
            ),
            JSON.stringify(list?.rows)
          )
          check(
            `${width}px: no descendant escapes the panel`,
            Boolean(list && list.offenders.length === 0),
            JSON.stringify(list?.offenders)
          )
          const pageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          )
          check(
            `${width}px: page has no horizontal overflow`,
            pageOverflow <= 0,
            `overflow=${pageOverflow}`
          )

          // The long identifier must stay inside its row, truncating where the
          // row is too narrow and simply fitting on a wide desktop card.
          const modelFit = await longRow.evaluate((element) => {
            const spans = [...element.querySelectorAll("span")]
            const model = spans.find((span) =>
              span.textContent?.includes("commandcode/")
            )
            if (!model) return null
            return {
              fits: model.scrollWidth <= model.clientWidth + 1,
              clips: getComputedStyle(model).overflow === "hidden",
              inside:
                model.getBoundingClientRect().right <=
                element.getBoundingClientRect().right + 1,
            }
          })
          check(
            `${width}px: long model id stays inside its row`,
            Boolean(
              modelFit && (modelFit.fits || modelFit.clips) && modelFit.inside
            ),
            JSON.stringify(modelFit)
          )
          if (width < 500) {
            check(
              `${width}px: long model id is truncated, not widened`,
              Boolean(modelFit && !modelFit.fits && modelFit.clips),
              JSON.stringify(modelFit)
            )
          }

          await page.screenshot({
            path: join(shotDir, `settings-agents-list-${width}.png`),
            fullPage: true,
          })

          await longRow.click()
          await page
            .getByRole("button", { name: "Back to all agents" })
            .waitFor({ state: "visible" })
          const detail = await page.evaluate(() => {
            const panel = document.querySelector('[role="tabpanel"]')
            if (!(panel instanceof HTMLElement)) return null
            const panelRect = panel.getBoundingClientRect()
            const offenders = [...panel.querySelectorAll("*")]
              .filter((element) => {
                const rect = element.getBoundingClientRect()
                // Skip visually hidden 1px controls and unpainted boxes.
                if (rect.width <= 1 || rect.height <= 1) return false
                return (
                  rect.right > panelRect.right + 1 ||
                  rect.left < panelRect.left - 1
                )
              })
              .slice(0, 5)
              .map((element) => ({
                tag: element.tagName,
                text: (element.textContent ?? "").trim().slice(0, 40),
                right: element.getBoundingClientRect().right,
              }))
            const fieldsets = [...panel.querySelectorAll("fieldset")].map(
              (element) => {
                const rect = element.getBoundingClientRect()
                return { left: rect.left, right: rect.right }
              }
            )
            return {
              panelLeft: panelRect.left,
              panelRight: panelRect.right,
              panelClientWidth: panel.clientWidth,
              panelScrollWidth: panel.scrollWidth,
              fieldsets,
              offenders,
            }
          })
          check(
            `${width}px: detail tabpanel has no horizontal overflow`,
            Boolean(
              detail && detail.panelScrollWidth <= detail.panelClientWidth + 1
            ),
            JSON.stringify(
              detail && {
                client: detail.panelClientWidth,
                scroll: detail.panelScrollWidth,
              }
            )
          )
          const detailLeft = detail?.panelLeft ?? 0
          const detailRight = detail?.panelRight ?? 0
          check(
            `${width}px: detail fields stay inside the panel`,
            Boolean(
              detail &&
              detail.fieldsets.length >= 1 &&
              detail.fieldsets.every(
                (fieldset) =>
                  fieldset.left >= detailLeft - 1 &&
                  fieldset.right <= detailRight + 1
              )
            ),
            JSON.stringify(detail?.fieldsets)
          )
          check(
            `${width}px: no detail descendant escapes the panel`,
            Boolean(detail && detail.offenders.length === 0),
            JSON.stringify(detail?.offenders)
          )
          const detailPageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          )
          check(
            `${width}px: detail page has no horizontal overflow`,
            detailPageOverflow <= 0,
            `overflow=${detailPageOverflow}`
          )

          await page.screenshot({
            path: join(shotDir, `settings-agents-detail-${width}.png`),
            fullPage: true,
          })
          check(
            `${width}px: no page errors`,
            opened.pageErrors.length === 0,
            opened.pageErrors.join(" | ")
          )
          mergeDiagnostics(
            results.find((result) =>
              result.name.startsWith("Settings > Agents keeps")
            )!,
            opened
          )
        } finally {
          await opened.context.close()
        }
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Desktop question dialog overflow
// ---------------------------------------------------------------------------
if (browser) {
  await run(
    "desktop question dialog keeps long question text inside the dialog",
    async ({ check }) => {
      const opened = await openPage({ width: 1280, height: 900 }, "pending")
      const page = opened.page
      try {
        const trigger = page.getByRole("button", {
          name: /A question needs your answer/,
        })
        await trigger.waitFor({ state: "visible" })
        await trigger.click()

        const dialog = page.locator('[data-slot="dialog-content"]')
        await dialog.waitFor({ state: "visible" })
        const card = dialog.locator("section").first()
        await card.waitFor({ state: "visible" })

        const dialogBox = await dialog.boundingBox()
        const cardBox = await card.boundingBox()
        const controlBox = await dialog
          .locator("textarea, input")
          .first()
          .boundingBox()
        const submitBox = await dialog
          .getByRole("button", { name: "Submit" })
          .boundingBox()
        const dialogRight = (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)

        check(
          "question card stays inside the dialog",
          Boolean(
            cardBox &&
            dialogBox &&
            cardBox.x >= dialogBox.x &&
            cardBox.x + cardBox.width <= dialogRight + 1
          ),
          `card=${JSON.stringify(cardBox)} dialogRight=${dialogRight}`
        )
        check(
          "answer control stays inside the dialog",
          Boolean(
            controlBox &&
            dialogBox &&
            controlBox.x >= dialogBox.x &&
            controlBox.x + controlBox.width <= dialogRight + 1
          ),
          `control=${JSON.stringify(controlBox)} dialogRight=${dialogRight}`
        )
        check(
          "submit action stays inside the dialog",
          Boolean(
            submitBox &&
            dialogBox &&
            submitBox.x + submitBox.width <= dialogRight + 1
          ),
          `submit=${JSON.stringify(submitBox)} dialogRight=${dialogRight}`
        )
        check(
          "dialog stays inside the viewport",
          Boolean(dialogBox && dialogBox.x >= 0 && dialogRight <= 1280),
          JSON.stringify(dialogBox)
        )
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
        check(
          "question dialog introduces no horizontal page overflow",
          overflow <= 0,
          `overflow=${overflow}`
        )

        await page.screenshot({
          path: join(shotDir, "question-dialog-desktop.png"),
        })
        check(
          "no page errors",
          opened.pageErrors.length === 0,
          opened.pageErrors.join(" | ")
        )
        mergeDiagnostics(
          results.find((result) =>
            result.name.startsWith("desktop question dialog")
          )!,
          opened
        )
      } finally {
        await opened.context.close()
      }
    }
  )
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
    console.log(
      `  ${step.ok ? "PASS" : "FAIL"} ${step.name}${step.detail ? ` — ${step.detail}` : ""}`
    )
  }
  if (result.pageErrors.length)
    console.log(`  pageErrors: ${result.pageErrors.join(" | ")}`)
  if (result.consoleErrors.length)
    console.log(`  consoleErrors: ${result.consoleErrors.join(" | ")}`)
}
if (blocker) {
  console.error(`\nBLOCKED: ${blocker}`)
}
console.log(
  `\n${passed} passed, ${failed} failed, ${blocked} blocked. Results: ${resultPath}`
)
if (failed > 0 || blocked > 0 || Boolean(blocker) || results.length === 0) {
  process.exitCode = 1
}
