import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type ParseError,
} from "jsonc-parser"

import { resolveAgentConfigDirectory } from "./agent-config.ts"

export const PLUGINS_ROUTE = "/api/ui/plugins"
export const PLUGINS_BODY_LIMIT = 8 * 1024
export const NOTES_PLUGIN_ID = "notes"

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }
const ENGINE_TIMEOUT_MS = 5_000
const MCP_PATH = "/api/experimental/mcp"
const CONFIG_FILE_NAMES = ["opencode.jsonc", "opencode.json"] as const
const DEFAULT_CONFIG_NAME = "opencode.jsonc"
const MAX_CONFIG_BYTES = 1024 * 1024

const NOTES_PLUGIN = {
  id: NOTES_PLUGIN_ID,
  name: "Notes",
  description: "Project notes, planning and daily logs for agents and humans.",
} as const

type EngineServer = { name: string; status: string }

type ConfigCode = "config_read_failed" | "config_write_failed"

class ConfigFileError extends Error {
  code: ConfigCode

  constructor(code: ConfigCode, message: string) {
    super(message)
    this.name = "ConfigFileError"
    this.code = code
  }
}

type ConfigSource = {
  path: string
  text: string | null
  mode: number
}

export type PluginsApiOptions = {
  engineUrl: string
  /** Engine Basic credential. Only ever sent to the engine, never to clients. */
  authorization: string
  /** Repository root used to build the absolute MCP entry path. */
  repoRoot: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Environment used for the global engine config directory lookup (tests). */
  env?: NodeJS.ProcessEnv
  /** Home directory used when XDG_CONFIG_HOME is unset (tests). */
  home?: string
}

export type PluginsApi = {
  handleRequest: (request: Request) => Promise<Response>
}

type NotesStatus = { engineAvailable: boolean; registered: boolean; connected: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function errorResponse(code: string, status: number, message: string): Response {
  return json({ error: { code, message } }, status)
}

function configFailure(error: unknown, fallback: ConfigCode): Response {
  if (error instanceof ConfigFileError) {
    return errorResponse(error.code, 500, error.message)
  }
  return errorResponse(
    fallback,
    500,
    fallback === "config_read_failed"
      ? "The engine configuration could not be read."
      : "The engine configuration could not be updated."
  )
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

function formattingOptions(text: string) {
  return {
    insertSpaces: true,
    tabSize: 2,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  }
}

function createNewConfigText(): string {
  return `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
}

function parseConfigText(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(parsed)) {
    throw new ConfigFileError(
      "config_read_failed",
      "The engine configuration is not valid JSONC, so it was not edited."
    )
  }
  return parsed
}

function notesEntry(root: Record<string, unknown>): unknown {
  const mcp = root.mcp
  if (!isRecord(mcp)) return undefined
  const servers = mcp.servers
  if (!isRecord(servers)) return undefined
  return servers[NOTES_PLUGIN_ID]
}

function isNotesEnabled(text: string | null): boolean {
  if (text === null || text.trim().length === 0) return false
  const entry = notesEntry(parseConfigText(text))
  if (entry === undefined) return false
  const disabled = isRecord(entry) ? entry.disabled : undefined
  return disabled !== true
}

function isNotesConfig(
  value: unknown,
  command: readonly string[]
): boolean {
  if (!isRecord(value) || !Array.isArray(value.command)) return false
  if (value.command.length !== command.length) return false
  if (!value.command.every((part, index) => part === command[index])) {
    return false
  }
  return (
    value.type === "local" &&
    value.disabled === false &&
    value.codemode === false
  )
}

function ensureNotesConfig(
  text: string,
  config: Record<string, unknown>,
  command: readonly string[]
): string {
  const root = parseConfigText(text)
  if (Object.hasOwn(root, "mcp") && !isRecord(root.mcp)) {
    throw new ConfigFileError(
      "config_write_failed",
      "The engine configuration mcp field is not an object, so it was not edited."
    )
  }
  if (isRecord(root.mcp)) {
    const servers = root.mcp.servers
    if (servers !== undefined && !isRecord(servers)) {
      throw new ConfigFileError(
        "config_write_failed",
        "The engine configuration mcp.servers field is not an object, so it was not edited."
      )
    }
  }

  const next = applyEdits(
    text,
    modify(text, ["mcp", "servers", NOTES_PLUGIN_ID], config, {
      formattingOptions: formattingOptions(text),
    })
  )
  const entry = notesEntry(parseConfigText(next))
  if (!isNotesConfig(entry, command)) {
    throw new ConfigFileError(
      "config_write_failed",
      "The edited engine configuration could not be validated and was not saved."
    )
  }
  return next
}

function removeNotesConfig(text: string): string {
  if (text.trim().length === 0) return text
  const root = parseConfigText(text)
  const mcp = root.mcp
  if (!isRecord(mcp)) return text
  const servers = mcp.servers
  if (!isRecord(servers) || !Object.hasOwn(servers, NOTES_PLUGIN_ID)) {
    return text
  }
  const next = applyEdits(
    text,
    modify(text, ["mcp", "servers", NOTES_PLUGIN_ID], undefined, {
      formattingOptions: formattingOptions(text),
    })
  )
  if (notesEntry(parseConfigText(next)) !== undefined) {
    throw new ConfigFileError(
      "config_write_failed",
      "The notes server entry could not be removed."
    )
  }
  return next
}

/** Prefer `opencode.jsonc` when present, then `opencode.json`, else create the former. */
async function readConfigSource(directory: string): Promise<ConfigSource> {
  for (const name of CONFIG_FILE_NAMES) {
    const path = join(directory, name)
    let entry
    try {
      entry = await lstat(path)
    } catch (error) {
      if (isNotFound(error)) continue
      throw new ConfigFileError(
        "config_read_failed",
        "The engine configuration file could not be read."
      )
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new ConfigFileError(
        "config_read_failed",
        "The engine configuration file is not a regular file, so it was not edited."
      )
    }
    if (entry.size > MAX_CONFIG_BYTES) {
      throw new ConfigFileError(
        "config_read_failed",
        "The engine configuration file is too large to edit here."
      )
    }
    let buffer: Buffer
    try {
      buffer = await readFile(path)
    } catch {
      throw new ConfigFileError(
        "config_read_failed",
        "The engine configuration file could not be read."
      )
    }
    if (buffer.byteLength > MAX_CONFIG_BYTES) {
      throw new ConfigFileError(
        "config_read_failed",
        "The engine configuration file is too large to edit here."
      )
    }
    const text = buffer.toString("utf8")
    if (!Buffer.from(text, "utf8").equals(buffer)) {
      throw new ConfigFileError(
        "config_read_failed",
        "The engine configuration file is not valid UTF-8, so it was not edited."
      )
    }
    return { path, text, mode: entry.mode & 0o777 }
  }
  return {
    path: join(directory, DEFAULT_CONFIG_NAME),
    text: null,
    mode: 0o600,
  }
}

/** Private temp file + fsync + rename + best-effort directory fsync. */
async function writeConfigAtomic(
  directory: string,
  target: string,
  text: string,
  mode: number
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temp = join(directory, `.${basename(target)}.${randomUUID()}.tmp`)
  const handle = await open(temp, "wx", 0o600)
  try {
    await handle.writeFile(text, "utf8")
    await handle.chmod(mode)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(temp).catch(() => {})
    throw error
  }
  await handle.close()
  try {
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  try {
    const dir = await open(directory, "r")
    try {
      await dir.sync()
    } finally {
      await dir.close()
    }
  } catch {
    // The atomic rename already succeeded; directory fsync is best-effort.
  }
}

export function createPluginsApi(options: PluginsApiOptions): PluginsApi {
  const engineUrl = options.engineUrl.replace(/\/+$/, "")
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? ENGINE_TIMEOUT_MS
  const mainPath = resolve(options.repoRoot, "plugins/notes/src/mcp/main.ts")
  const configDirectory = resolveAgentConfigDirectory(
    options.env ?? process.env,
    options.home ?? homedir()
  )
  const notesConfig = {
    type: "local" as const,
    command: [process.execPath, mainPath],
    disabled: false,
    codemode: false,
  }

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

  async function readEngineStatus(): Promise<NotesStatus> {
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

  /**
   * The config write is authoritative; hot application through the engine's
   * experimental MCP API is best-effort because that registration is ephemeral
   * and disappears when the engine instance reloads.
   */
  async function hotApply(): Promise<NotesStatus> {
    try {
      await engineFetch(`${MCP_PATH}/${NOTES_PLUGIN_ID}`, {
        method: "PUT",
        body: JSON.stringify({ config: notesConfig }),
      })
    } catch {
      // Re-reading below reports the truthful state.
    }
    let status = await readEngineStatus()
    if (status.engineAvailable && !status.connected) {
      try {
        await engineFetch(`${MCP_PATH}/${NOTES_PLUGIN_ID}/connect`, {
          method: "POST",
        })
      } catch {
        // Re-reading below reports the truthful state.
      }
      status = await readEngineStatus()
    }
    return status
  }

  async function list(): Promise<Response> {
    let source: ConfigSource
    try {
      source = await readConfigSource(configDirectory)
    } catch (error) {
      return configFailure(error, "config_read_failed")
    }
    let registered: boolean
    try {
      registered = isNotesEnabled(source.text)
    } catch (error) {
      return configFailure(error, "config_read_failed")
    }
    const status = await readEngineStatus()
    return json({
      engineAvailable: status.engineAvailable,
      plugins: [
        {
          ...NOTES_PLUGIN,
          registered,
          connected: status.connected,
          restartRequired: registered && !status.connected,
        },
      ],
    })
  }

  async function enable(): Promise<Response> {
    let source: ConfigSource
    try {
      source = await readConfigSource(configDirectory)
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }
    try {
      const before =
        source.text !== null && source.text.trim().length > 0
          ? source.text
          : createNewConfigText()
      const after = ensureNotesConfig(before, notesConfig, notesConfig.command)
      if (after !== before) {
        await writeConfigAtomic(configDirectory, source.path, after, source.mode)
      }
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }

    const status = await hotApply()
    return json({
      registered: true,
      connected: status.connected,
      restartRequired: !status.connected,
    })
  }

  async function disable(): Promise<Response> {
    let source: ConfigSource
    try {
      source = await readConfigSource(configDirectory)
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }
    try {
      if (source.text !== null) {
        const after = removeNotesConfig(source.text)
        if (after !== source.text) {
          await writeConfigAtomic(configDirectory, source.path, after, source.mode)
        }
      }
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }

    try {
      await engineFetch(`${MCP_PATH}/${NOTES_PLUGIN_ID}`, { method: "DELETE" })
    } catch {
      // The persisted config no longer registers the server; the engine may
      // still hold the ephemeral entry until it reloads.
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
