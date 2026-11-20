import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import {
  parseSessionShortcuts,
  updateSessionShortcut,
  type SessionShortcut,
  type SessionShortcuts,
} from "../src/lib/session-shortcuts.ts"

export const SESSION_SHORTCUTS_ROUTE = "/api/ui/session-shortcuts"
export const SESSION_SHORTCUTS_BODY_LIMIT = 8 * 1024

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export type SessionShortcutsService = {
  handleRequest(request: Request): Promise<Response>
  read(): Promise<SessionShortcuts>
  dispose(): void
}

/**
 * Server-wide session pins and labels. They never change native session data;
 * they are stored in app-owned state so every browser and device shares them.
 */
export function createSessionShortcutsService(options: {
  stateFile?: string
} = {}): SessionShortcutsService {
  const stateFile =
    options.stateFile ??
    process.env.OPENCODE_UI_SESSION_SHORTCUTS_STATE ??
    join(homedir(), ".local", "share", "opencode-ui", "session-shortcuts.json")

  let cache: SessionShortcuts | null = null
  let loadPromise: Promise<SessionShortcuts> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  async function load(): Promise<SessionShortcuts> {
    if (cache) return cache
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const raw = await readFile(stateFile, "utf8")
        cache = parseSessionShortcuts(raw)
        await chmod(stateFile, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          loadPromise = null
          throw error
        }
        cache = parseSessionShortcuts(null)
      }
      return cache
    })()
    return loadPromise
  }

  async function persist(state: SessionShortcuts): Promise<void> {
    const directory = dirname(stateFile)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temp = `${stateFile}.${randomBytes(8).toString("hex")}.tmp`
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, stateFile)
    await chmod(stateFile, 0o600)
  }

  function mutate<T>(change: (state: SessionShortcuts) => Promise<T> | T): Promise<T> {
    const result = queue.then(async () => {
      const state = await load()
      const value = await change(state)
      await persist(state)
      return value
    })
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  async function read(): Promise<SessionShortcuts> {
    return structuredClone(await load())
  }

  return {
    read,
    dispose() {
      disposed = true
    },
    async handleRequest(request: Request): Promise<Response> {
      if (disposed) return json({ error: { code: "unavailable" } }, 503)
      const path = new URL(request.url).pathname
      if (path !== SESSION_SHORTCUTS_ROUTE) return json({ error: { code: "not_found" } }, 404)

      if (request.method === "GET") {
        try {
          return json({ shortcuts: await read() })
        } catch {
          return json({ error: { code: "state_unreadable" } }, 500)
        }
      }

      if (request.method === "POST") {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ error: { code: "invalid" } }, 400)
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json({ error: { code: "invalid" } }, 400)
        }
        const input = body as { id?: unknown; change?: unknown }
        if (typeof input.id !== "string" || !input.id || input.id.length > 256) {
          return json({ error: { code: "invalid" } }, 400)
        }
        if (!input.change || typeof input.change !== "object" || Array.isArray(input.change)) {
          return json({ error: { code: "invalid" } }, 400)
        }
        const change: Partial<SessionShortcut> = {}
        const candidate = input.change as Record<string, unknown>
        if (candidate.pinned !== undefined) {
          if (typeof candidate.pinned !== "boolean") return json({ error: { code: "invalid" } }, 400)
          change.pinned = candidate.pinned
        }
        if (candidate.label !== undefined) {
          if (typeof candidate.label !== "string") return json({ error: { code: "invalid" } }, 400)
          change.label = candidate.label
        }
        try {
          const next = await mutate((state) => {
            const updated = updateSessionShortcut(state, input.id as string, change)
            for (const key of Object.keys(state)) delete state[key]
            Object.assign(state, updated)
            return read()
          })
          return json({ shortcuts: await next })
        } catch {
          return json({ error: { code: "invalid" } }, 400)
        }
      }

      return json({ error: { code: "method_not_allowed" } }, 405)
    },
  }
}
