import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { isLoopbackHost, validateOrigin } from "./bun-config.ts"

export const CONNECTIONS_ROUTE = "/api/ui/connections"
export const CONNECTIONS_BODY_LIMIT = 16 * 1024
export const MAX_ENGINE_PROFILES = 32
const MAX_PASSWORD_LENGTH = 256
const MAX_NAME_LENGTH = 80
const MAX_USERNAME_LENGTH = 64
const TEST_TIMEOUT_MS = 5_000
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type ActiveEngineTarget = {
  id: string
  name: string
  engineUrl: string
  authorization: string
  isRemote: boolean
}

export type EngineProfileSummary = {
  id: string
  name: string
  engineUrl: string
  hasPassword: boolean
  isRemote: boolean
  unencryptedRemote: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type EngineTestResult = {
  ok: boolean
  reachable: boolean
  authenticated: boolean
  status: number | null
  version: string | null
  latencyMs: number
  unencryptedRemote: boolean
  error: string | null
}

type StoredEngineProfile = {
  id: string
  name: string
  engineUrl: string
  username: string
  password?: string
  createdAt: number
  updatedAt: number
}

type StoredState = {
  version: 1
  activeId: string | null
  profiles: StoredEngineProfile[]
}

export type EngineConnectionsOptions = {
  suggestedEngineUrl?: string
  stateFile?: string
  fetch?: typeof fetch
  now?: () => number
}

class ConnectionApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ConnectionApiError"
    this.status = status
    this.code = code
  }
}

function defaultStateFile(): string {
  const override = process.env.OPENCODE_UI_CONNECTIONS_STATE?.trim()
  if (override) return resolve(override)
  const xdg = process.env.XDG_DATA_HOME?.trim()
  const base = xdg ? resolve(xdg) : join(homedir(), ".local", "share")
  return join(base, "opencode-ui", "connections.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sanitizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ConnectionApiError(400, "invalid_name", "Provide a name for this connection.")
  }
  const cleaned = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join("")
    .trim()
  if (!cleaned || cleaned.length > MAX_NAME_LENGTH) {
    throw new ConnectionApiError(
      400,
      "invalid_name",
      `Connection name must be 1–${MAX_NAME_LENGTH} characters.`
    )
  }
  return cleaned
}

function normalizeEngineUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConnectionApiError(400, "invalid_url", "Provide an HTTP(S) engine origin, such as http://127.0.0.1:4096.")
  }
  try {
    return validateOrigin(value.trim())
  } catch {
    throw new ConnectionApiError(
      400,
      "invalid_url",
      "Use an absolute HTTP(S) origin without a path, query, fragment, or embedded credentials."
    )
  }
}

function normalizeUsername(value: unknown): string {
  if (value === undefined || value === null || value === "") return "opencode"
  if (typeof value !== "string") {
    throw new ConnectionApiError(400, "invalid_username", "Username must be text.")
  }
  const trimmed = value.trim()
  if (!trimmed) return "opencode"
  if (
    trimmed.length > MAX_USERNAME_LENGTH ||
    trimmed.includes(":") ||
    /[\r\n\0]/.test(trimmed) ||
    Array.from(trimmed).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
  ) {
    throw new ConnectionApiError(400, "invalid_username", "Username contains unsupported characters.")
  }
  return trimmed
}

function normalizePassword(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConnectionApiError(400, "invalid_password", "Enter the engine password. For a background service, run opencode service get password on the engine machine.")
  }
  if (value.length > MAX_PASSWORD_LENGTH || /[\r\n\0]/.test(value)) {
    throw new ConnectionApiError(
      400,
      "invalid_password",
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters without line breaks.`
    )
  }
  return value
}

function basicAuthHeader(username: string, password: string): string {
  return password ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` : ""
}

function targetForProfile(profile: StoredEngineProfile): ActiveEngineTarget {
  return {
    id: profile.id,
    name: profile.name,
    engineUrl: profile.engineUrl,
    authorization: basicAuthHeader(profile.username, profile.password ?? ""),
    isRemote: urlFlags(profile.engineUrl).isRemote,
  }
}

function urlFlags(engineUrl: string): { isRemote: boolean; unencryptedRemote: boolean } {
  const parsed = new URL(engineUrl)
  const isRemote = !isLoopbackHost(parsed.hostname)
  return {
    isRemote,
    unencryptedRemote: isRemote && parsed.protocol === "http:",
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof ConnectionApiError) {
    return jsonResponse(error.status, { error: { code: error.code, message: error.message } })
  }
  return jsonResponse(500, {
    error: { code: "internal_error", message: "The connection request failed." },
  })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ConnectionApiError(400, "invalid_json", "Request body must be a JSON object.")
  }
  if (!isRecord(body)) {
    throw new ConnectionApiError(400, "invalid_json", "Request body must be a JSON object.")
  }
  return body
}

function sanitizeStoredProfile(raw: unknown): StoredEngineProfile | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== "string" || !PROFILE_ID_PATTERN.test(raw.id) || raw.id === "default") {
    return null
  }
  try {
    const name = sanitizeName(raw.name)
    const engineUrl = normalizeEngineUrl(raw.engineUrl)
    const username = normalizeUsername(raw.username)
    const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
    const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
    // Keep legacy profile metadata without reading credentials from the filesystem.
    const password = raw.password === undefined || raw.password === "" ? "" : normalizePassword(raw.password)
    return { id: raw.id, name, engineUrl, username, password, createdAt, updatedAt }
  } catch {
    return null
  }
}

export function createEngineConnectionsService(options: EngineConnectionsOptions) {
  const suggestedEngineUrl = options.suggestedEngineUrl && validateOrigin(options.suggestedEngineUrl)
  const stateFile = options.stateFile ?? defaultStateFile()
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now

  let activeTarget: ActiveEngineTarget | null = null
  let state: StoredState = { version: 1, activeId: null, profiles: [] }
  let loaded = false
  let loadPromise: Promise<void> | null = null
  let mutationQueue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<(target: ActiveEngineTarget | null) => void>()

  function notifyListeners(target: ActiveEngineTarget | null) {
    for (const listener of listeners) {
      try {
        listener(target)
      } catch {
        // One listener failing must not block other services from switching.
      }
    }
  }

  function resolveTargetForId(id: string): ActiveEngineTarget {
    const profile = state.profiles.find((item) => item.id === id)
    if (!profile) {
      throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
    }
    return targetForProfile(profile)
  }

  async function persist(next: StoredState): Promise<void> {
    const dir = dirname(stateFile)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700).catch(() => {})
    const tmp = `${stateFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      await chmod(tmp, 0o600).catch(() => {})
      await rename(tmp, stateFile)
    } catch (error) {
      await unlink(tmp).catch(() => {})
      throw error
    }
  }

  async function load(): Promise<void> {
    if (loaded) return
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const text = await readFile(stateFile, "utf8")
          const parsed: unknown = JSON.parse(text)
          if (isRecord(parsed) && Array.isArray(parsed.profiles)) {
            const seen = new Set<string>()
            const profiles: StoredEngineProfile[] = []
            for (const raw of parsed.profiles) {
              const sanitized = sanitizeStoredProfile(raw)
              if (!sanitized || seen.has(sanitized.id)) continue
              seen.add(sanitized.id)
              profiles.push(sanitized)
              if (profiles.length >= MAX_ENGINE_PROFILES) break
            }
            const active = profiles.find((profile) => profile.id === parsed.activeId) ?? profiles[0]
            activeTarget = active ? targetForProfile(active) : null
            state = { version: 1, activeId: active?.id ?? null, profiles }
          }
        } catch {
          // Missing, corrupt, or unreadable state: start without an engine.
        }
        loaded = true
      })()
    }
    await loadPromise
  }

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = mutationQueue.then(work, work)
    mutationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  function summarize() {
    const profiles: EngineProfileSummary[] = state.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      engineUrl: profile.engineUrl,
      ...urlFlags(profile.engineUrl),
      hasPassword: Boolean(profile.password),
      isActive: state.activeId === profile.id,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    }))
    const active = profiles.find((item) => item.isActive) ?? null
    return { activeId: state.activeId, active, profiles, suggestedEngineUrl }
  }

  async function probeEngine(engineUrl: string, authorization: string): Promise<EngineTestResult> {
    const flags = urlFlags(engineUrl)
    const started = now()
    let response: Response
    try {
      response = await fetchImpl(`${engineUrl}/api/info`, {
        headers: { ...(authorization ? { authorization } : {}), accept: "application/json" },
        redirect: "manual",
        proxy: false,
        cache: "no-store",
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      } as RequestInit)
    } catch (error) {
      const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      return {
        ok: false,
        reachable: false,
        authenticated: false,
        status: null,
        version: null,
        latencyMs: Math.max(0, now() - started),
        unencryptedRemote: flags.unencryptedRemote,
        error: aborted
          ? "Connection timed out while reaching the engine."
          : "Could not connect to the engine at this URL.",
      }
    }

    const latencyMs = Math.max(0, now() - started)
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {})
      return {
        ok: false,
        reachable: true,
        authenticated: false,
        status: response.status,
        version: null,
        latencyMs,
        unencryptedRemote: flags.unencryptedRemote,
        error: response.status === 403
          ? "The engine denied access (HTTP 403). Check its access settings."
          : "The engine rejected the password (HTTP 401). Check the address with opencode service status and the password with opencode service get password on the engine machine.",
      }
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {})
      return {
        ok: false,
        reachable: true,
        authenticated: false,
        status: response.status,
        version: null,
        latencyMs,
        unencryptedRemote: flags.unencryptedRemote,
        error: "The target URL redirected instead of answering as an OpenCode engine.",
      }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return {
        ok: false,
        reachable: true,
        authenticated: false,
        status: response.status,
        version: null,
        latencyMs,
        unencryptedRemote: flags.unencryptedRemote,
        error: `Engine responded with HTTP ${response.status}.`,
      }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return {
        ok: false,
        reachable: true,
        authenticated: true,
        status: response.status,
        version: null,
        latencyMs,
        unencryptedRemote: flags.unencryptedRemote,
        error: "Server responded, but /api/info did not return valid OpenCode JSON.",
      }
    }
    const version = isRecord(body) && typeof body.version === "string" ? body.version : null
    if (!version) {
      return {
        ok: false,
        reachable: true,
        authenticated: true,
        status: response.status,
        version: null,
        latencyMs,
        unencryptedRemote: flags.unencryptedRemote,
        error: "Server responded, but did not report an OpenCode engine version.",
      }
    }
    return {
      ok: true,
      reachable: true,
      authenticated: true,
      status: response.status,
      version,
      latencyMs,
      unencryptedRemote: flags.unencryptedRemote,
      error: null,
    }
  }

  async function probeCredentials(engineUrl: string, username: string, password: string, allowTrim: boolean) {
    const result = await probeEngine(engineUrl, basicAuthHeader(username, password))
    const trimmed = password.trim()
    // A paste can include surrounding whitespace. Prefer the exact password so
    // intentional spaces in a valid password are preserved.
    if (!allowTrim || result.status !== 401 || trimmed === password) return { result, password }
    const retry = await probeEngine(engineUrl, basicAuthHeader(username, trimmed))
    return retry.ok ? { result: retry, password: trimmed } : { result, password }
  }

  async function verifyCredentials(engineUrl: string, username: string, password: string, allowTrim: boolean) {
    const checked = await probeCredentials(engineUrl, username, password, allowTrim)
    if (!checked.result.ok) {
      throw new ConnectionApiError(422, "engine_connection_failed", checked.result.error ?? "Could not verify the engine connection.")
    }
    return checked.password
  }

  function passwordFor(body: Record<string, unknown>, engineUrl: string, existing?: StoredEngineProfile): string {
    // Omission keeps the saved password only at the same origin.
    if (body.password === undefined && existing?.password) {
      if (existing.engineUrl !== engineUrl) {
        throw new ConnectionApiError(
          400,
          "credential_required_for_url_change",
          "Enter the engine password for the new URL."
        )
      }
      return existing.password
    }
    return normalizePassword(body.password)
  }

  async function handleTest(body: Record<string, unknown>): Promise<Response> {
    const existing = typeof body.profileId === "string"
      ? state.profiles.find((profile) => profile.id === body.profileId)
      : undefined
    if (body.profileId !== undefined && !existing) {
      throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
    }
    const engineUrl = body.engineUrl === undefined && existing
      ? existing.engineUrl
      : normalizeEngineUrl(body.engineUrl)
    const password = passwordFor(body, engineUrl, existing)
    const { result } = await probeCredentials(engineUrl, existing?.username ?? "opencode", password, body.password !== undefined)
    return jsonResponse(200, result)
  }

  async function handleCreate(body: Record<string, unknown>): Promise<Response> {
    return serialize(async () => {
      if (state.profiles.length >= MAX_ENGINE_PROFILES) {
        throw new ConnectionApiError(409, "limit_exceeded", `At most ${MAX_ENGINE_PROFILES} saved connections are supported.`)
      }
      const name = sanitizeName(body.name)
      const engineUrl = normalizeEngineUrl(body.engineUrl)
      const username = "opencode"
      const password = await verifyCredentials(engineUrl, username, normalizePassword(body.password), true)
      const profile: StoredEngineProfile = {
        id: `eng_${randomBytes(8).toString("hex")}`,
        name,
        engineUrl,
        username,
        password,
        createdAt: now(),
        updatedAt: now(),
      }
      const activate = state.activeId === null || body.activate === true
      const next = { ...state, activeId: activate ? profile.id : state.activeId, profiles: [...state.profiles, profile] }
      await persist(next)
      state = next
      if (activate) {
        activeTarget = targetForProfile(profile)
        notifyListeners(activeTarget)
      }
      const summary = summarize()
      return jsonResponse(201, { profile: summary.profiles.find((item) => item.id === profile.id)!, ...summary })
    })
  }

  async function handleUpdate(id: string, body: Record<string, unknown>): Promise<Response> {
    return serialize(async () => {
      const existing = state.profiles.find((item) => item.id === id)
      if (!existing) {
        throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
      }
      const engineUrl = body.engineUrl !== undefined ? normalizeEngineUrl(body.engineUrl) : existing.engineUrl
      const name = body.name !== undefined ? sanitizeName(body.name) : existing.name
      let password = passwordFor(body, engineUrl, existing)
      if (engineUrl !== existing.engineUrl || body.password !== undefined) {
        password = await verifyCredentials(engineUrl, existing.username, password, body.password !== undefined)
      }
      const updated = { ...existing, name, engineUrl, password, updatedAt: now() }
      const next = { ...state, profiles: state.profiles.map((item) => item.id === id ? updated : item) }
      await persist(next)
      state = next
      if (state.activeId === id) {
        activeTarget = targetForProfile(updated)
        notifyListeners(activeTarget)
      }
      const summary = summarize()
      return jsonResponse(200, { profile: summary.profiles.find((item) => item.id === id)!, ...summary })
    })
  }

  async function handleDelete(id: string): Promise<Response> {
    return serialize(async () => {
      const profiles = state.profiles.filter((item) => item.id !== id)
      if (profiles.length === state.profiles.length) {
        throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
      }
      const removingActive = state.activeId === id
      if (removingActive && profiles.length) {
        throw new ConnectionApiError(409, "cannot_delete_active", "Switch to another connection before deleting this one.")
      }
      const next = { ...state, activeId: removingActive ? null : state.activeId, profiles }
      await persist(next)
      state = next
      if (removingActive) {
        activeTarget = null
        notifyListeners(null)
      }
      return jsonResponse(200, summarize())
    })
  }

  async function handleActivate(id: string): Promise<Response> {
    return serialize(async () => {
      const nextTarget = resolveTargetForId(id)
      if (!nextTarget.authorization) {
        throw new ConnectionApiError(400, "invalid_password", "Edit this connection and enter the engine password before switching to it.")
      }
      const changed = activeTarget?.id !== nextTarget.id
      const next = { ...state, activeId: id }
      await persist(next)
      state = next
      activeTarget = nextTarget
      if (changed) notifyListeners(nextTarget)
      return jsonResponse(200, summarize())
    })
  }

  async function handleRequest(request: Request): Promise<Response> {
    await load()
    const path = new URL(request.url).pathname
    try {
      if (path === CONNECTIONS_ROUTE) {
        if (request.method === "GET") return jsonResponse(200, summarize())
        if (request.method === "POST") return await handleCreate(await readJsonBody(request))
        return jsonResponse(405, { error: { code: "method_not_allowed", message: "Use GET or POST." } })
      }
      if (path === `${CONNECTIONS_ROUTE}/test`) {
        if (request.method !== "POST") {
          return jsonResponse(405, { error: { code: "method_not_allowed", message: "Use POST." } })
        }
        return await handleTest(await readJsonBody(request))
      }
      const activateMatch = /^\/api\/ui\/connections\/([^/]+)\/activate$/.exec(path)
      if (activateMatch) {
        if (request.method !== "POST") {
          return jsonResponse(405, { error: { code: "method_not_allowed", message: "Use POST." } })
        }
        const id = decodeURIComponent(activateMatch[1])
        if (!PROFILE_ID_PATTERN.test(id)) {
          throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
        }
        return await handleActivate(id)
      }
      const itemMatch = /^\/api\/ui\/connections\/([^/]+)$/.exec(path)
      if (itemMatch) {
        const id = decodeURIComponent(itemMatch[1])
        if (!PROFILE_ID_PATTERN.test(id)) {
          throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
        }
        if (request.method === "PUT") return await handleUpdate(id, await readJsonBody(request))
        if (request.method === "DELETE") return await handleDelete(id)
        return jsonResponse(405, { error: { code: "method_not_allowed", message: "Use PUT or DELETE." } })
      }
      return jsonResponse(404, { error: { code: "not_found", message: "Unknown connections endpoint." } })
    } catch (error) {
      return errorResponse(error)
    }
  }

  return {
    init: load,
    getActiveTarget: () => activeTarget,
    onChange(listener: (target: ActiveEngineTarget | null) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    handleRequest,
    stateFile,
  }
}

export type EngineConnectionsService = ReturnType<typeof createEngineConnectionsService>
