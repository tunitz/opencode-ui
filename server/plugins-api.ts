import { randomUUID } from "node:crypto"
import { link, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { homedir, hostname } from "node:os"
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
/** Bounded re-reads when another writer changes the config mid-edit. */
const MAX_CONFIG_WRITE_ATTEMPTS = 3
/** Cooperative writer lock inside the config directory. */
const CONFIG_LOCK_NAME = ".opencode-ui-config.lock"
const CONFIG_LOCK_TIMEOUT_MS = 3_000
const CONFIG_LOCK_POLL_MS = 25

type PluginDescriptor = {
  id: string
  name: string
  description: string
  /** Absolute MCP entry path inside the installation root. */
  entryPath: (repoRoot: string) => string
  /** Canonical `mcp.servers.<id>` entry; may throw when trusted launch env is invalid. */
  mcpConfig: (entryPath: string, env: NodeJS.ProcessEnv) => Record<string, unknown>
  /**
   * Extra absolute files the entry needs at runtime, for descriptors whose
   * package does not guarantee them.
   */
  requiredRuntimeFiles?: (repoRoot: string) => string[]
  /** Compare the entry's env exactly so a stale data directory is rewritten. */
  managesEnv: boolean
}

const PLUGINS: readonly PluginDescriptor[] = [
  {
    id: NOTES_PLUGIN_ID,
    name: "Notes",
    description: "Project notes, planning and daily logs for agents and humans.",
    entryPath: (repoRoot) => resolve(repoRoot, "plugins/notes/src/mcp/main.ts"),
    mcpConfig: (entryPath) => ({
      type: "local",
      command: [process.execPath, entryPath],
      disabled: false,
      codemode: false,
    }),
    managesEnv: false,
  },
]

const PLUGINS_BY_ID = new Map(PLUGINS.map((plugin) => [plugin.id, plugin]))

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
  /** Optional live target provider when switching engines at runtime. */
  getTarget?: () => { engineUrl: string; authorization: string }
  /** Repository root used to build the absolute MCP entry path. */
  repoRoot: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Environment used for the global engine config directory lookup (tests). */
  env?: NodeJS.ProcessEnv
  /** Home directory used when XDG_CONFIG_HOME is unset (tests). */
  home?: string
  /**
   * Test seam: awaited after the config is read and before the pre-commit
   * conflict check, so a test can simulate an external writer.
   */
  beforeConfigCommit?: () => void | Promise<void>
  /**
   * Bounded wait, measured from request arrival, for the in-process config
   * queue and then the cooperative writer lock (tests).
   */
  configLockTimeoutMs?: number
  /**
   * Total budget for the best-effort engine reconcile that follows the atomic
   * config edit (tests). Never exceeds the per-call engine timeout.
   */
  hotApplyTimeoutMs?: number
}

export type PluginsApi = {
  handleRequest: (request: Request) => Promise<Response>
}

type EngineState = { engineAvailable: boolean; servers?: EngineServer[] }

type PersistedPluginState = {
  /** The persisted entry exists and is not `disabled: true`. */
  configured: boolean
  /** The persisted entry when it is an object, for the engine apply payload. */
  config?: Record<string, unknown>
}

type EngineReconcile = {
  connected: boolean
  /** `null` when the engine is unreachable or its list shape is unknown. */
  engineSynced: boolean | null
}

type PluginSettlement = {
  registered: boolean
  connected: boolean
  restartRequired: boolean
  engineSynced: boolean | null
}

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

function pluginEntry(
  root: Record<string, unknown>,
  id: string
): unknown {
  const mcp = root.mcp
  if (!isRecord(mcp)) return undefined
  const servers = mcp.servers
  if (!isRecord(servers)) return undefined
  return servers[id]
}

function isPluginEnabled(root: Record<string, unknown>, id: string): boolean {
  const entry = pluginEntry(root, id)
  if (entry === undefined) return false
  const disabled = isRecord(entry) ? entry.disabled : undefined
  return disabled !== true
}

function sameEnv(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) return actual === undefined
  if (!isRecord(expected) || !isRecord(actual)) return false
  const keys = Object.keys(expected)
  if (keys.length !== Object.keys(actual).length) return false
  return keys.every((key) => Object.hasOwn(actual, key) && actual[key] === expected[key])
}

function isPluginConfig(
  value: unknown,
  config: Record<string, unknown>,
  managesEnv: boolean
): boolean {
  const command = config.command
  if (!isRecord(value) || !Array.isArray(value.command) || !Array.isArray(command)) {
    return false
  }
  if (value.command.length !== command.length) return false
  if (!value.command.every((part, index) => part === command[index])) {
    return false
  }
  if (
    value.type !== "local" ||
    value.disabled !== false ||
    value.codemode !== false
  ) {
    return false
  }
  return !managesEnv || sameEnv(config.env, value.env)
}

function ensurePluginConfig(
  text: string,
  id: string,
  config: Record<string, unknown>,
  managesEnv: boolean
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
    modify(text, ["mcp", "servers", id], config, {
      formattingOptions: formattingOptions(text),
    })
  )
  const entry = pluginEntry(parseConfigText(next), id)
  if (!isPluginConfig(entry, config, managesEnv)) {
    throw new ConfigFileError(
      "config_write_failed",
      "The edited engine configuration could not be validated and was not saved."
    )
  }
  return next
}

function removePluginConfig(text: string, id: string): string {
  if (text.trim().length === 0) return text
  const root = parseConfigText(text)
  const mcp = root.mcp
  if (!isRecord(mcp)) return text
  const servers = mcp.servers
  if (!isRecord(servers) || !Object.hasOwn(servers, id)) {
    return text
  }
  const next = applyEdits(
    text,
    modify(text, ["mcp", "servers", id], undefined, {
      formattingOptions: formattingOptions(text),
    })
  )
  if (pluginEntry(parseConfigText(next), id) !== undefined) {
    throw new ConfigFileError(
      "config_write_failed",
      `The ${id} server entry could not be removed.`
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

/**
 * In-process ordering keyed by config directory. This serializes a whole
 * settle pass (atomic config edit, authoritative re-read, one engine
 * reconcile) so concurrent Notes requests in one server never interleave.
 * It does not hold the cooperative file lock across engine calls: that lock
 * covers only the config mutation and is released before the reconcile.
 *
 * `waitMs` bounds how long a request may wait for its turn, measured from the
 * request's own arrival. A task that never gets its turn is never started, so a
 * timed-out request cannot mutate the config later. A timed-out waiter keeps
 * its place until the task ahead settles, so later waiters cannot overtake a
 * running section.
 */
const configQueues = new Map<string, Promise<void>>()

function withConfigQueue<T>(
  directory: string,
  waitMs: number,
  task: () => Promise<T>
): Promise<T> {
  const key = resolve(directory)
  const previous = configQueues.get(key) ?? Promise.resolve()
  let releaseGate!: () => void
  const gate = new Promise<void>((resolveGate) => {
    releaseGate = resolveGate
  })
  configQueues.set(key, gate)
  void gate.then(() => {
    if (configQueues.get(key) === gate) configQueues.delete(key)
  })

  return new Promise<T>((resolveTask, rejectTask) => {
    const queueTimeout = () =>
      new ConfigFileError(
        "config_write_failed",
        "This server is still processing another engine configuration edit, so the configuration was not edited. Try again."
      )
    let cancelled = waitMs <= 0
    if (cancelled) rejectTask(queueTimeout())
    const timer =
      waitMs > 0
        ? setTimeout(() => {
            cancelled = true
            rejectTask(queueTimeout())
          }, waitMs)
        : undefined
    const pending = timer as { unref?: () => void } | undefined
    if (pending && typeof pending.unref === "function") pending.unref()
    void previous.then(async () => {
      // A timed-out waiter keeps its place until the task ahead of it settles;
      // releasing the gate early would let later waiters overtake the running
      // critical section.
      if (cancelled) {
        releaseGate()
        return
      }
      if (timer !== undefined) clearTimeout(timer)
      try {
        resolveTask(await task())
      } catch (error) {
        rejectTask(error)
      } finally {
        releaseGate()
      }
    })
  })
}

/** Best-effort external-change detection: compare the file with the read snapshot. */
async function configSourceUnchanged(
  directory: string,
  source: ConfigSource
): Promise<boolean> {
  try {
    const current = await readConfigSource(directory)
    return current.path === source.path && current.text === source.text
  } catch {
    return false
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path)
    return entry.isFile() && !entry.isSymbolicLink()
  } catch {
    return false
  }
}

/** Fail closed: the entry and every runtime file it actually imports must exist. */
async function pluginInstalled(
  plugin: PluginDescriptor,
  repoRoot: string
): Promise<boolean> {
  if (!(await isRegularFile(plugin.entryPath(repoRoot)))) return false
  for (const file of plugin.requiredRuntimeFiles?.(repoRoot) ?? []) {
    if (!(await isRegularFile(file))) return false
  }
  return true
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && error.code === "EEXIST"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

type ConfigLockHandle = {
  path: string
  token: string
  dev: number
  ino: number
}

/**
 * Create the visible lock atomically: fill and fsync a private temp file, then
 * hard-link it into place. The link fails with EEXIST if a lock already exists,
 * so no reader can observe a partially written lock. A crash before the link
 * leaves only an inert temp file, never a lock.
 *
 * There is deliberately no automatic stale reclaim: proving that a visible lock
 * is stale and unlinking exactly that inode is not possible without a race
 * against a replacement lock. A crashed owner therefore fails closed and is
 * reported for manual recovery.
 *
 * The lock is cooperative only. An editor that ignores it can still replace the
 * config between the snapshot check and the atomic rename; the caller's
 * pre-commit re-read detects but cannot prevent that, so this is not CAS.
 */
async function acquireConfigLock(
  directory: string,
  timeoutMs: number,
  createDirectory: boolean
): Promise<ConfigLockHandle | null> {
  if (createDirectory) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
  const path = join(directory, CONFIG_LOCK_NAME)
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const temp = join(directory, `.${CONFIG_LOCK_NAME}.${token}.tmp`)
    let tempCreated = false
    try {
      const handle = await open(temp, "wx", 0o600)
      tempCreated = true
      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            host: hostname(),
            token,
            createdAt: new Date().toISOString(),
          }),
          "utf8"
        )
        await handle.sync()
      } finally {
        await handle.close()
      }
      await link(temp, path)
      await unlink(temp).catch(() => {})
      const entry = await lstat(path)
      return { path, token, dev: entry.dev, ino: entry.ino }
    } catch (error) {
      if (tempCreated) await unlink(temp).catch(() => {})
      if (isAlreadyExists(error)) {
        // Another writer holds the lock; wait for it below.
      } else if (isNotFound(error) && !createDirectory) {
        // The config directory does not exist, so there is nothing to edit.
        return null
      } else {
        throw new ConfigFileError(
          "config_write_failed",
          "The engine configuration lock could not be created, so the configuration was not edited."
        )
      }
    }
    if (Date.now() >= deadline) {
      throw new ConfigFileError(
        "config_write_failed",
        `The engine configuration lock ${path} is held, so the configuration was not edited. Wait for the current writer to finish; if no configuration write is running, remove the lock file and try again. The lock is not reclaimed automatically.`
      )
    }
    await sleep(CONFIG_LOCK_POLL_MS)
  }
}

/**
 * Release only the inode we created. The cooperative protocol means no other
 * participant replaces a held lock; the inode and token checks additionally
 * avoid deleting an uncooperative replacement, though the final unlink still
 * has a check-to-unlink window that cannot be closed with plain path unlinks.
 */
async function releaseConfigLock(lock: ConfigLockHandle): Promise<void> {
  try {
    const entry = await lstat(lock.path)
    if (entry.dev !== lock.dev || entry.ino !== lock.ino) return
    const raw = await readFile(lock.path, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.token !== lock.token) return
    await unlink(lock.path)
  } catch {
    // A missing or replaced lock is not ours to delete.
  }
}

type MutateConfigOptions = {
  /** Absolute time by which the cooperative lock wait must finish. */
  deadline: number
  beforeCommit?: () => void | Promise<void>
  createDirectory?: boolean
}

/**
 * Atomic config edit under the cooperative file lock. The lock is released as
 * soon as the edit settles; the engine reconcile happens after it returns.
 */
async function mutateConfig(
  directory: string,
  mutate: (text: string) => string,
  options: MutateConfigOptions
): Promise<void> {
  const lock = await acquireConfigLock(
    directory,
    Math.max(0, options.deadline - Date.now()),
    options.createDirectory ?? true
  )
  if (lock === null) return
  try {
    for (let attempt = 0; attempt < MAX_CONFIG_WRITE_ATTEMPTS; attempt += 1) {
      const source = await readConfigSource(directory)
      const before =
        source.text !== null && source.text.trim().length > 0
          ? source.text
          : createNewConfigText()
      const after = mutate(before)
      if (options.beforeCommit) await options.beforeCommit()
      // Re-read even on the no-op path: an external writer may have changed
      // the file after our snapshot, so an unchanged edit is not proof that
      // the entry we read is still there.
      if (!(await configSourceUnchanged(directory, source))) continue
      if (after === before) return
      await writeConfigAtomic(directory, source.path, after, source.mode)
      return
    }
    throw new ConfigFileError(
      "config_write_failed",
      "The engine configuration changed while it was being edited, so it was not saved. Re-read the configuration and try again."
    )
  } finally {
    await releaseConfigLock(lock)
  }
}

export function createPluginsApi(options: PluginsApiOptions): PluginsApi {
  const staticEngineUrl = options.engineUrl.replace(/\/+$/, "")
  const resolveTarget = () => {
    if (!options.getTarget) {
      return { engineUrl: staticEngineUrl, authorization: options.authorization }
    }
    const current = options.getTarget()
    return {
      engineUrl: current.engineUrl.replace(/\/+$/, ""),
      authorization: current.authorization,
    }
  }
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? ENGINE_TIMEOUT_MS
  // The reconcile runs after the config lock is released, but the in-process
  // queue still waits on it: cap its total time instead of multiplying the
  // per-call timeout by the number of engine calls it makes.
  const hotApplyTimeoutMs = options.hotApplyTimeoutMs ?? timeoutMs
  /** One bounded wait budget for the in-process queue and the file lock. */
  const configWaitMs = options.configLockTimeoutMs ?? CONFIG_LOCK_TIMEOUT_MS
  const env = options.env ?? process.env
  const configDirectory = resolveAgentConfigDirectory(
    env,
    options.home ?? homedir()
  )

  function pluginEntryPath(plugin: PluginDescriptor): string {
    return plugin.entryPath(options.repoRoot)
  }

  async function engineFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const { engineUrl, authorization } = resolveTarget()
    return fetchImpl(`${engineUrl}${path}`, {
      ...init,
      redirect: "manual",
      proxy: false,
      headers: {
        ...(authorization ? { authorization } : {}),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    } as RequestInit)
  }

  /** Remaining hot-apply budget as a signal; `null` means the budget is spent. */
  function engineCallSignal(deadline: number): AbortSignal | null {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    return AbortSignal.timeout(Math.min(remaining, timeoutMs))
  }

  async function readEngineStatus(
    signal?: AbortSignal | null
  ): Promise<EngineState> {
    if (signal === null) return { engineAvailable: false }
    let response: Response
    try {
      response = await engineFetch("/api/mcp", { method: "GET", signal })
    } catch {
      return { engineAvailable: false }
    }
    if (!response.ok) return { engineAvailable: false }
    let servers: EngineServer[] | undefined
    try {
      servers = engineServers(await response.json())
    } catch {
      servers = undefined
    }
    return { engineAvailable: true, servers }
  }

  function engineConnected(state: EngineState, id: string): boolean {
    return state.servers?.find((server) => server.name === id)?.status === "connected"
  }

  /**
   * `true`/`false` when the engine's list is readable, `null` when the engine is
   * unreachable or its payload shape is unknown. `null` must never be treated
   * as "absent", or a broken engine read would look like a divergence.
   */
  function engineServerPresent(state: EngineState, id: string): boolean | null {
    if (!state.engineAvailable || state.servers === undefined) return null
    return state.servers.some((server) => server.name === id)
  }

  /** Re-read the persisted entry after the file lock has been released. */
  async function readPersistedPlugin(
    plugin: PluginDescriptor
  ): Promise<PersistedPluginState> {
    const source = await readConfigSource(configDirectory)
    const root =
      source.text === null || source.text.trim().length === 0
        ? undefined
        : parseConfigText(source.text)
    const entry = root === undefined ? undefined : pluginEntry(root, plugin.id)
    return {
      configured: root !== undefined && isPluginEnabled(root, plugin.id),
      config: isRecord(entry) ? entry : undefined,
    }
  }

  /**
   * Apply or compensate the engine so it matches the authoritative persisted
   * entry, exactly once, using the entry that was re-read after the config lock
   * was released. The config write stays authoritative; an unreachable or
   * timed-out engine is reported as not synchronized, never assumed.
   *
   * Bounded by `hotApplyTimeoutMs` end to end rather than once per engine call.
   */
  async function reconcileEngine(
    plugin: PluginDescriptor,
    persisted: PersistedPluginState,
    fallbackConfig?: Record<string, unknown>
  ): Promise<EngineReconcile> {
    const deadline = Date.now() + hotApplyTimeoutMs
    let state = await readEngineStatus(engineCallSignal(deadline))
    if (!state.engineAvailable) {
      // Cannot observe or correct the engine.
      return { connected: false, engineSynced: null }
    }

    if (persisted.configured) {
      // One apply pass: send the persisted entry, then connect if needed. If
      // the persisted entry is not an object and this request cannot build a
      // payload, report the observed presence instead of failing a write that
      // already succeeded.
      const config = persisted.config ?? fallbackConfig
      if (config === undefined) {
        return {
          connected: engineConnected(state, plugin.id),
          engineSynced: engineServerPresent(state, plugin.id),
        }
      }
      const putSignal = engineCallSignal(deadline)
      if (putSignal !== null) {
        try {
          await engineFetch(`${MCP_PATH}/${plugin.id}`, {
            method: "PUT",
            body: JSON.stringify({ config }),
            signal: putSignal,
          })
        } catch {
          // The re-read below reports the truthful state.
        }
        state = await readEngineStatus(engineCallSignal(deadline))
        if (state.engineAvailable && !engineConnected(state, plugin.id)) {
          const connectSignal = engineCallSignal(deadline)
          if (connectSignal !== null) {
            try {
              await engineFetch(`${MCP_PATH}/${plugin.id}/connect`, {
                method: "POST",
                signal: connectSignal,
              })
            } catch {
              // The re-read below reports the truthful state.
            }
            state = await readEngineStatus(engineCallSignal(deadline))
          }
        }
      }
      const present = engineServerPresent(state, plugin.id)
      return {
        connected: engineConnected(state, plugin.id),
        engineSynced: present === null ? null : present,
      }
    }

    // Persisted disabled: remove the ephemeral entry only when it exists.
    const present = engineServerPresent(state, plugin.id)
    if (present === false) return { connected: false, engineSynced: true }
    const deleteSignal = engineCallSignal(deadline)
    if (deleteSignal === null) {
      return { connected: engineConnected(state, plugin.id), engineSynced: false }
    }
    try {
      await engineFetch(`${MCP_PATH}/${plugin.id}`, {
        method: "DELETE",
        signal: deleteSignal,
      })
    } catch {
      // The re-read below reports the truthful state.
    }
    state = await readEngineStatus(engineCallSignal(deadline))
    const stillPresent = engineServerPresent(state, plugin.id)
    return {
      connected: engineConnected(state, plugin.id),
      engineSynced: stillPresent === null ? null : !stillPresent,
    }
  }

  async function list(): Promise<Response> {
    let source: ConfigSource
    try {
      source = await readConfigSource(configDirectory)
    } catch (error) {
      return configFailure(error, "config_read_failed")
    }
    let root: Record<string, unknown> | undefined
    try {
      root =
        source.text === null || source.text.trim().length === 0
          ? undefined
          : parseConfigText(source.text)
    } catch (error) {
      return configFailure(error, "config_read_failed")
    }
    const engine = await readEngineStatus()
    const plugins = []
    for (const plugin of PLUGINS) {
      const installed = await pluginInstalled(plugin, options.repoRoot)
      const configured = root !== undefined && isPluginEnabled(root, plugin.id)
      const registered = configured && installed
      const connected = installed && engineConnected(engine, plugin.id)
      // Residual: does the running engine still hold an entry the config does
      // not register, or lack one the config does? `null` means unreadable.
      const present = engineServerPresent(engine, plugin.id)
      const engineSynced =
        present === null ? null : configured ? present : !present
      plugins.push({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        configured,
        installed,
        registered,
        connected,
        restartRequired: registered && !connected,
        engineSynced,
      })
    }
    return json({ engineAvailable: engine.engineAvailable, plugins })
  }

  /**
   * One ordered settle pass: atomic config edit under the cooperative file
   * lock, then an authoritative re-read and exactly one engine reconcile. The
   * in-process queue keeps the whole pass ordered for concurrent requests in
   * this server; the file lock is never held across engine calls.
   */
  async function settlePlugin(
    plugin: PluginDescriptor,
    mutate: (text: string) => string,
    request: {
      receivedAt: number
      createDirectory: boolean
      installed: boolean
      fallbackConfig?: Record<string, unknown>
    }
  ): Promise<PluginSettlement> {
    return withConfigQueue(
      configDirectory,
      request.receivedAt + configWaitMs - Date.now(),
      async () => {
        await mutateConfig(configDirectory, mutate, {
          deadline: request.receivedAt + configWaitMs,
          beforeCommit: options.beforeConfigCommit,
          createDirectory: request.createDirectory,
        })
        // The file lock is released here. Whatever the config says now is the
        // authoritative state, including a change another writer made.
        const persisted = await readPersistedPlugin(plugin)
        const engine = await reconcileEngine(
          plugin,
          persisted,
          request.fallbackConfig
        )
        const registered = persisted.configured && request.installed
        return {
          registered,
          connected: request.installed && engine.connected,
          restartRequired: registered && !engine.connected,
          engineSynced: engine.engineSynced,
        }
      }
    )
  }

  async function enable(
    plugin: PluginDescriptor,
    receivedAt: number
  ): Promise<Response> {
    const entryPath = pluginEntryPath(plugin)
    // Match `list`: never persist an entry whose files are missing from this
    // installation, otherwise the UI would immediately report it as not
    // installed while the config claimed it was registered.
    const installed = await pluginInstalled(plugin, options.repoRoot)
    if (!installed) {
      return errorResponse(
        "plugin_not_installed",
        409,
        `${plugin.name} is not installed with its required runtime files, so agent access was not enabled.`
      )
    }
    let config: Record<string, unknown>
    try {
      config = plugin.mcpConfig(entryPath, env)
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }
    try {
      const settled = await settlePlugin(
        plugin,
        (text) =>
          ensurePluginConfig(text, plugin.id, config, plugin.managesEnv),
        { receivedAt, createDirectory: true, installed, fallbackConfig: config }
      )
      return json(settled)
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }
  }

  async function disable(
    plugin: PluginDescriptor,
    receivedAt: number
  ): Promise<Response> {
    // A missing config directory is not created for a disable; the queue still
    // orders the compensating engine removal in this server.
    const installed = await pluginInstalled(plugin, options.repoRoot)
    try {
      const settled = await settlePlugin(
        plugin,
        (text) => removePluginConfig(text, plugin.id),
        { receivedAt, createDirectory: false, installed }
      )
      return json(settled)
    } catch (error) {
      return configFailure(error, "config_write_failed")
    }
  }

  async function handleRequest(request: Request): Promise<Response> {
    const receivedAt = Date.now()
    const path = new URL(request.url).pathname
    if (path === PLUGINS_ROUTE) {
      if (request.method !== "GET") return errorResponse("method_not_allowed", 405, "Use GET.")
      return list()
    }
    const route = /^\/api\/ui\/plugins\/([^/]+)\/(enable|disable)$/.exec(path)
    if (route) {
      const plugin = PLUGINS_BY_ID.get(route[1])
      if (!plugin) {
        return errorResponse("not_found", 404, "Unknown plugin.")
      }
      if (request.method !== "POST") {
        return errorResponse("method_not_allowed", 405, "Use POST.")
      }
      return route[2] === "enable"
        ? enable(plugin, receivedAt)
        : disable(plugin, receivedAt)
    }
    return errorResponse("not_found", 404, "Unknown plugins endpoint.")
  }

  return { handleRequest }
}
