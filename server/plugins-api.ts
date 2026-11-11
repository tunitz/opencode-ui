import { resolve } from "node:path"

export const PLUGINS_ROUTE = "/api/ui/plugins"
export const PLUGINS_BODY_LIMIT = 8 * 1024
export const NOTES_PLUGIN_ID = "notes"

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }
const ENGINE_TIMEOUT_MS = 5_000
const MCP_PATH = "/api/experimental/mcp"

const NOTES_PLUGIN = {
  id: NOTES_PLUGIN_ID,
  name: "Notes",
  description: "Project notes, planning and daily logs for agents and humans.",
} as const

type EngineServer = { name: string; status: string }

export type PluginsApiOptions = {
  engineUrl: string
  /** Engine Basic credential. Only ever sent to the engine, never to clients. */
  authorization: string
  /** Repository root used to build the absolute MCP entry path. */
  repoRoot: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export type PluginsApi = {
  handleRequest: (request: Request) => Promise<Response>
}

type NotesStatus = { engineAvailable: boolean; registered: boolean; connected: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function errorResponse(code: string, status: number, message: string): Response {
  return json({ error: { code, message } }, status)
}

/**
 * The engine wraps lists as `{ location, data: [...] }`; tolerate a bare array
 * and unknown status shapes so a protocol drift degrades to "not registered".
 */
function engineServers(payload: unknown): EngineServer[] | undefined {
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : undefined
  if (!entries) return undefined
  const servers: EngineServer[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue
    const status = isRecord(entry.status)
      ? typeof entry.status.status === "string"
        ? entry.status.status
        : "unknown"
      : typeof entry.status === "string"
        ? entry.status
        : "unknown"
    servers.push({ name: entry.name, status })
  }
  return servers
}

/** Short, credential-free excerpt of an engine error body for the UI. */
async function failureMessage(response: Response): Promise<string> {
  const text = (await response.text().catch(() => "")).trim()
  const detail = text.length > 400 ? `${text.slice(0, 400)}…` : text
  return `Engine rejected the request (HTTP ${response.status})${detail ? `: ${detail}` : ""}`
}

export function createPluginsApi(options: PluginsApiOptions): PluginsApi {
  const engineUrl = options.engineUrl.replace(/\/+$/, "")
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? ENGINE_TIMEOUT_MS
  const mainPath = resolve(options.repoRoot, "plugins/notes/src/mcp/main.ts")

  async function engineFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchImpl(`${engineUrl}${path}`, {
      ...init,
      headers: {
        authorization: options.authorization,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    })
  }

  async function readNotesStatus(): Promise<NotesStatus> {
    const unavailable: NotesStatus = { engineAvailable: false, registered: false, connected: false }
    let response: Response
    try {
      response = await engineFetch("/api/mcp", { method: "GET" })
    } catch {
      return unavailable
    }
    if (!response.ok) return unavailable
    let servers: EngineServer[] | undefined
    try {
      servers = engineServers(await response.json())
    } catch {
      servers = undefined
    }
    const notes = servers?.find((server) => server.name === NOTES_PLUGIN_ID)
    return {
      engineAvailable: true,
      registered: notes !== undefined,
      connected: notes?.status === "connected",
    }
  }

  async function list(): Promise<Response> {
    const status = await readNotesStatus()
    return json({
      engineAvailable: status.engineAvailable,
      plugins: [
        {
          ...NOTES_PLUGIN,
          registered: status.registered,
          connected: status.connected,
          restartRequired: status.registered && !status.connected,
        },
      ],
    })
  }

  async function enable(): Promise<Response> {
    const config = {
      type: "local" as const,
      command: [process.execPath, mainPath],
      disabled: false,
      codemode: false,
    }
    let response: Response
    try {
      response = await engineFetch(`${MCP_PATH}/${NOTES_PLUGIN_ID}`, {
        method: "PUT",
        body: JSON.stringify({ config }),
      })
    } catch {
      return errorResponse("engine_unavailable", 502, "The OpenCode engine is unreachable.")
    }
    if (!response.ok) {
      const message = await failureMessage(response)
      return errorResponse(response.status >= 500 ? "engine_unavailable" : "engine_rejected", 502, message)
    }
    let status = await readNotesStatus()
    // The engine connects a newly added server immediately; ask explicitly when
    // it reports the server as registered but not connected.
    if (status.engineAvailable && !status.connected) {
      try {
        await engineFetch(`${MCP_PATH}/${NOTES_PLUGIN_ID}/connect`, { method: "POST" })
      } catch {
        // Re-reading below reports the truthful state.
      }
      status = await readNotesStatus()
    }
    return json({
      registered: true,
      connected: status.connected,
      restartRequired: !status.connected,
    })
  }

  async function disable(): Promise<Response> {
    let response: Response
    try {
      response = await engineFetch(`${MCP_PATH}/${NOTES_PLUGIN_ID}`, { method: "DELETE" })
    } catch {
      return errorResponse("engine_unavailable", 502, "The OpenCode engine is unreachable.")
    }
    // Already absent is the desired end state.
    if (!response.ok && response.status !== 404) {
      const message = await failureMessage(response)
      return errorResponse(response.status >= 500 ? "engine_unavailable" : "engine_rejected", 502, message)
    }
    return json({ registered: false })
  }

  async function handleRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === PLUGINS_ROUTE) {
      if (request.method !== "GET") return errorResponse("method_not_allowed", 405, "Use GET.")
      return list()
    }
    if (path === `${PLUGINS_ROUTE}/${NOTES_PLUGIN_ID}/enable`) {
      if (request.method !== "POST") return errorResponse("method_not_allowed", 405, "Use POST.")
      return enable()
    }
    if (path === `${PLUGINS_ROUTE}/${NOTES_PLUGIN_ID}/disable`) {
      if (request.method !== "POST") return errorResponse("method_not_allowed", 405, "Use POST.")
      return disable()
    }
    return errorResponse("not_found", 404, "Unknown plugins endpoint.")
  }

  return { handleRequest }
}
