import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import {
  parseSessionShortcuts,
  updateSessionShortcut,
  type SessionShortcut,
  type SessionShortcuts,
  type ShortcutState,
} from "../src/lib/session-shortcuts.ts"

export const SESSION_SHORTCUTS_ROUTE = "/api/ui/session-shortcuts"
export const SESSION_SHORTCUTS_BODY_LIMIT = 8 * 1024

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/
const VERSION = 2

type PersistedState = {
  version: 2
  byConnection: Record<string, SessionShortcuts>
  legacy: SessionShortcuts
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function emptyShortcuts(): SessionShortcuts {
  return parseSessionShortcuts(null)
}

function emptyPersisted(): PersistedState {
  return { version: VERSION, byConnection: Object.create(null), legacy: emptyShortcuts() }
}

/** Return a detached, connection-scoped view of the persisted state. */
function stateForConnection(state: PersistedState, connectionId: string | null): ShortcutState {
  const shortcuts =
    connectionId && CONNECTION_ID.test(connectionId)
      ? parseSessionShortcuts(JSON.stringify(state.byConnection[connectionId] ?? {}))
      : emptyShortcuts()
  return { shortcuts, legacyCount: Object.keys(state.legacy).length }
}

function normalizePersisted(value: PersistedState): PersistedState {
  const byConnection: Record<string, SessionShortcuts> = Object.create(null)
  if (value.byConnection && typeof value.byConnection === "object" && !Array.isArray(value.byConnection)) {
    for (const [id, bucket] of Object.entries(value.byConnection)) {
      if (!CONNECTION_ID.test(id)) continue
      byConnection[id] = parseSessionShortcuts(bucket ? JSON.stringify(bucket) : null)
    }
  }
  return {
    version: VERSION,
    byConnection,
    legacy: parseSessionShortcuts(value.legacy ? JSON.stringify(value.legacy) : null),
  }
}

export type SessionShortcutsService = {
  handleRequest(request: Request): Promise<Response>
  read(connectionId?: string | null): Promise<ShortcutState>
  dispose(): void
}

/**
 * Server-wide session pins and labels, scoped to the saved OpenCode connection
 * they were created on. They never change native session data; they are stored
 * in app-owned state so every browser and device shares them.
 */
export function createSessionShortcutsService(options: {
  stateFile?: string
} = {}): SessionShortcutsService {
  const stateFile =
    options.stateFile ??
    process.env.OPENCODE_UI_SESSION_SHORTCUTS_STATE ??
    join(homedir(), ".local", "share", "opencode-ui", "session-shortcuts.json")

  let cache: PersistedState | null = null
  let loadPromise: Promise<PersistedState> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  async function load(): Promise<PersistedState> {
    if (cache) return cache
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      let raw: string | null = null
      try {
        raw = await readFile(stateFile, "utf8")
        await chmod(stateFile, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          loadPromise = null
          throw error
        }
      }
      let state: PersistedState
      let needsPersist = false
      if (!raw) {
        state = emptyPersisted()
        needsPersist = true
      } else {
        try {
          const parsed: unknown = JSON.parse(raw)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
              (parsed as PersistedState).version === VERSION) {
            state = normalizePersisted(parsed as PersistedState)
          } else {
            // A flat v1 map becomes the legacy bucket of the v2 file.
            state = emptyPersisted()
            state.legacy = parseSessionShortcuts(raw)
            needsPersist = true
          }
        } catch {
          state = emptyPersisted()
        }
      }
      cache = state
      if (needsPersist) await persist(state)
      return state
    })()
    return loadPromise
  }

  async function persist(state: PersistedState): Promise<void> {
    const directory = dirname(stateFile)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temp = `${stateFile}.${randomBytes(8).toString("hex")}.tmp`
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, stateFile)
    await chmod(stateFile, 0o600)
  }

  function mutate<T>(change: (state: PersistedState) => Promise<T> | T): Promise<T> {
    const result = queue.then(async () => {
      const state = await load()
      const value = await change(state)
      await persist(state)
      return value
    })
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  async function read(connectionId: string | null = null): Promise<ShortcutState> {
    return stateForConnection(await load(), connectionId)
  }

  return {
    read,
    dispose() {
      disposed = true
    },
    async handleRequest(request: Request): Promise<Response> {
      if (disposed) return json({ error: { code: "unavailable" } }, 503)
      const url = new URL(request.url)
      const path = url.pathname
      if (path !== SESSION_SHORTCUTS_ROUTE) return json({ error: { code: "not_found" } }, 404)

      if (request.method === "GET") {
        try {
          return json(await read(url.searchParams.get("connectionId")))
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
        const input = body as {
          action?: unknown
          connectionId?: unknown
          id?: unknown
          change?: unknown
        }
        if (typeof input.connectionId !== "string" || !CONNECTION_ID.test(input.connectionId)) {
          return json({ error: { code: "invalid" } }, 400)
        }
        const connectionId = input.connectionId

        if (input.action === "assignLegacy") {
          try {
            const next = await mutate((state) => {
              const active = state.byConnection[connectionId] ?? emptyShortcuts()
              const merged = emptyShortcuts()
              for (const [id, value] of Object.entries(active)) merged[id] = value
              // Existing active values win; legacy fills the gaps.
              for (const [id, value] of Object.entries(state.legacy)) {
                if (!Object.hasOwn(merged, id)) merged[id] = value
              }
              state.byConnection[connectionId] = merged
              state.legacy = emptyShortcuts()
              return stateForConnection(state, connectionId)
            })
            return json(next)
          } catch {
            return json({ error: { code: "invalid" } }, 400)
          }
        }

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
            const current = state.byConnection[connectionId] ?? emptyShortcuts()
            const updated = updateSessionShortcut(current, input.id as string, change)
            state.byConnection[connectionId] = updated
            // Removing the last shortcut also clears a matching legacy entry so
            // a re-assigned pin can be removed normally.
            if (!Object.hasOwn(updated, input.id as string) && Object.hasOwn(state.legacy, input.id as string)) {
              delete state.legacy[input.id as string]
            }
            return stateForConnection(state, connectionId)
          })
          return json(next)
        } catch {
          return json({ error: { code: "invalid" } }, 400)
        }
      }

      return json({ error: { code: "method_not_allowed" } }, 405)
    },
  }
}
