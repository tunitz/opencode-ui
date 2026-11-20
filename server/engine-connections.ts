import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { isLoopbackHost, validateOrigin, validatePath } from "./bun-config.ts"

export const CONNECTIONS_ROUTE = "/api/ui/connections"
export const CONNECTIONS_BODY_LIMIT = 16 * 1024
export const DEFAULT_ENGINE_PROFILE_ID = "default"
export const MAX_ENGINE_PROFILES = 32
const MAX_SERVICE_FILE_BYTES = 64 * 1024
const MAX_PASSWORD_LENGTH = 256
const MAX_NAME_LENGTH = 80
const MAX_USERNAME_LENGTH = 64
const TEST_TIMEOUT_MS = 5_000
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type EngineAuthMode = "password" | "service-file"

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
  authMode: EngineAuthMode
  serviceFile?: string
  username: string
  hasPassword: boolean
  isDefault: boolean
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
  authMode: EngineAuthMode
  username: string
  password?: string
  serviceFile?: string
  createdAt: number
  updatedAt: number
}

type StoredState = {
  version: 1
  activeId: string
  profiles: StoredEngineProfile[]
}

export type EngineConnectionsOptions = {
  defaultEngineUrl: string
  defaultAuthorization: string
  defaultServiceFile?: string
  defaultName?: string
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
    throw new ConnectionApiError(400, "invalid_password", "Provide the engine password.")
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

function expandHomePath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return value
}

function normalizeServiceFile(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConnectionApiError(400, "invalid_service_file", "Provide the path to an existing service.json file.")
  }
  try {
    return resolve(validatePath(expandHomePath(value.trim())))
  } catch {
    throw new ConnectionApiError(400, "invalid_service_file", "Service file path must be a valid filesystem path.")
  }
}

function normalizeAuthMode(value: unknown): EngineAuthMode {
  if (value === "password" || value === "service-file") return value
  throw new ConnectionApiError(400, "invalid_auth_mode", "Choose password or service-file authentication.")
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

async function readServiceFilePassword(filePath: string): Promise<string> {
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    throw new ConnectionApiError(
      400,
      "service_file_unreadable",
      "The service file could not be read on the UI server."
    )
  }
  if (!fileStat.isFile() || fileStat.size > MAX_SERVICE_FILE_BYTES) {
    throw new ConnectionApiError(
      400,
      "service_file_invalid",
      "The service file must be a small JSON file with a nonempty password."
    )
  }
  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch {
    throw new ConnectionApiError(
      400,
      "service_file_unreadable",
      "The service file could not be read on the UI server."
    )
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      !isRecord(parsed) ||
      typeof parsed.password !== "string" ||
      !parsed.password.trim() ||
      parsed.password.length > MAX_PASSWORD_LENGTH ||
      /[\r\n\0]/.test(parsed.password)
    ) {
      throw new Error("invalid")
    }
    return parsed.password
  } catch {
    throw new ConnectionApiError(
      400,
      "service_file_invalid",
      "The service file must contain a JSON object with a nonempty password."
    )
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
  if (typeof raw.id !== "string" || !PROFILE_ID_PATTERN.test(raw.id) || raw.id === DEFAULT_ENGINE_PROFILE_ID) {
    return null
  }
  try {
    const name = sanitizeName(raw.name)
    const engineUrl = normalizeEngineUrl(raw.engineUrl)
    const authMode = normalizeAuthMode(raw.authMode)
    const username = normalizeUsername(raw.username)
    const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
    const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
    if (authMode === "password") {
      const password = normalizePassword(raw.password)
      return { id: raw.id, name, engineUrl, authMode, username, password, createdAt, updatedAt }
    }
    const serviceFile = normalizeServiceFile(raw.serviceFile)
    return { id: raw.id, name, engineUrl, authMode, username, serviceFile, createdAt, updatedAt }
  } catch {
    return null
  }
}

export function createEngineConnectionsService(options: EngineConnectionsOptions) {
  const defaultEngineUrl = validateOrigin(options.defaultEngineUrl)
  const defaultAuthorization = options.defaultAuthorization
  const defaultServiceFile = options.defaultServiceFile
  const defaultName = options.defaultName ?? "Default (startup)"
  const stateFile = options.stateFile ?? defaultStateFile()
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now

  const defaultTarget: ActiveEngineTarget = {
    id: DEFAULT_ENGINE_PROFILE_ID,
    name: defaultName,
    engineUrl: defaultEngineUrl,
    authorization: defaultAuthorization,
    isRemote: urlFlags(defaultEngineUrl).isRemote,
  }

  let activeTarget: ActiveEngineTarget = defaultTarget
  let state: StoredState = { version: 1, activeId: DEFAULT_ENGINE_PROFILE_ID, profiles: [] }
  let loaded = false
  let loadPromise: Promise<void> | null = null
  let mutationQueue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<(target: ActiveEngineTarget) => void>()

  function notifyListeners(target: ActiveEngineTarget) {
    for (const listener of listeners) {
      try {
        listener(target)
      } catch {
        // One listener failing must not block other services from switching.
      }
    }
  }

  async function resolveProfileAuthorization(profile: StoredEngineProfile): Promise<string> {
    if (profile.authMode === "password") {
      if (!profile.password) {
        throw new ConnectionApiError(400, "invalid_password", "Saved password is missing for this profile.")
      }
      return basicAuthHeader(profile.username, profile.password)
    }
    if (!profile.serviceFile) {
      throw new ConnectionApiError(400, "invalid_service_file", "Service file path is missing for this profile.")
    }
    const password = await readServiceFilePassword(profile.serviceFile)
    return basicAuthHeader(profile.username, password)
  }

  async function resolveTargetForId(id: string): Promise<ActiveEngineTarget> {
    if (id === DEFAULT_ENGINE_PROFILE_ID) return defaultTarget
    const profile = state.profiles.find((item) => item.id === id)
    if (!profile) {
      throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
    }
    const authorization = await resolveProfileAuthorization(profile)
    return {
      id: profile.id,
      name: profile.name,
      engineUrl: profile.engineUrl,
      authorization,
      isRemote: urlFlags(profile.engineUrl).isRemote,
    }
  }

  async function persist(): Promise<void> {
    const dir = dirname(stateFile)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700).catch(() => {})
    const tmp = `${stateFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    try {
      await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
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
            const rawActive = typeof parsed.activeId === "string" ? parsed.activeId : DEFAULT_ENGINE_PROFILE_ID
            const activeId =
              rawActive === DEFAULT_ENGINE_PROFILE_ID || profiles.some((p) => p.id === rawActive)
                ? rawActive
                : DEFAULT_ENGINE_PROFILE_ID
            state = { version: 1, activeId, profiles }
            if (activeId !== DEFAULT_ENGINE_PROFILE_ID) {
              try {
                activeTarget = await resolveTargetForId(activeId)
              } catch {
                // Fall back to the CLI startup profile if a saved service file vanished between restarts.
                state.activeId = DEFAULT_ENGINE_PROFILE_ID
                activeTarget = defaultTarget
              }
            }
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException | null)?.code
          if (code !== "ENOENT") {
            // Corrupt or unreadable state file: stay on the startup default without crashing boot.
            state = { version: 1, activeId: DEFAULT_ENGINE_PROFILE_ID, profiles: [] }
            activeTarget = defaultTarget
          }
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

  function summarize(): {
    activeId: string
    active: EngineProfileSummary
    profiles: EngineProfileSummary[]
  } {
    const defaultFlags = urlFlags(defaultEngineUrl)
    const defaultSummary: EngineProfileSummary = {
      id: DEFAULT_ENGINE_PROFILE_ID,
      name: defaultName,
      engineUrl: defaultEngineUrl,
      authMode: "service-file",
      ...(defaultServiceFile ? { serviceFile: defaultServiceFile } : {}),
      username: "opencode",
      hasPassword: true,
      isDefault: true,
      isRemote: defaultFlags.isRemote,
      unencryptedRemote: defaultFlags.unencryptedRemote,
      isActive: state.activeId === DEFAULT_ENGINE_PROFILE_ID,
      createdAt: 0,
      updatedAt: 0,
    }
    const customSummaries: EngineProfileSummary[] = state.profiles.map((profile) => {
      const flags = urlFlags(profile.engineUrl)
      return {
        id: profile.id,
        name: profile.name,
        engineUrl: profile.engineUrl,
        authMode: profile.authMode,
        ...(profile.serviceFile ? { serviceFile: profile.serviceFile } : {}),
        username: profile.username,
        hasPassword: profile.authMode === "password" ? Boolean(profile.password) : false,
        isDefault: false,
        isRemote: flags.isRemote,
        unencryptedRemote: flags.unencryptedRemote,
        isActive: state.activeId === profile.id,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      }
    })
    const profiles = [defaultSummary, ...customSummaries]
    const active = profiles.find((item) => item.isActive) ?? defaultSummary
    return { activeId: active.id, active, profiles }
  }

  async function probeEngine(engineUrl: string, authorization: string): Promise<EngineTestResult> {
    const flags = urlFlags(engineUrl)
    const started = now()
    let response: Response
    try {
      response = await fetchImpl(`${engineUrl}/api/info`, {
        headers: { authorization, accept: "application/json" },
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
        error: "Authentication failed — check the engine password or service file.",
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

  async function handleTest(body: Record<string, unknown>): Promise<Response> {
    const profileId = typeof body.profileId === "string" && body.profileId.trim() ? body.profileId.trim() : null
    const hasExplicitUrl = typeof body.engineUrl === "string" && body.engineUrl.trim().length > 0

    // Testing a saved profile directly (no candidate overrides).
    if (profileId && !hasExplicitUrl) {
      const target = await resolveTargetForId(profileId)
      return jsonResponse(200, await probeEngine(target.engineUrl, target.authorization))
    }

    const engineUrl = normalizeEngineUrl(body.engineUrl)
    const authMode = normalizeAuthMode(body.authMode ?? "password")
    const username = normalizeUsername(body.username)

    if (authMode === "service-file") {
      const serviceFile = normalizeServiceFile(body.serviceFile)
      const password = await readServiceFilePassword(serviceFile)
      return jsonResponse(200, await probeEngine(engineUrl, basicAuthHeader(username, password)))
    }

    const rawPassword = typeof body.password === "string" ? body.password : ""
    if (rawPassword) {
      const password = normalizePassword(rawPassword)
      return jsonResponse(200, await probeEngine(engineUrl, basicAuthHeader(username, password)))
    }

    // Reuse an existing profile's saved password ONLY when the URL is identical.
    // Never forward a saved credential to a different origin (prevents exfiltration).
    if (profileId && profileId !== DEFAULT_ENGINE_PROFILE_ID) {
      const existing = state.profiles.find((item) => item.id === profileId)
      if (existing && existing.authMode === "password" && existing.password) {
        if (existing.engineUrl !== engineUrl) {
          throw new ConnectionApiError(
            400,
            "credential_required_for_url_change",
            "Re-enter the password when testing a different engine URL."
          )
        }
        return jsonResponse(200, await probeEngine(engineUrl, basicAuthHeader(username, existing.password)))
      }
    }

    throw new ConnectionApiError(400, "invalid_password", "Provide the engine password to test this connection.")
  }

  async function handleCreate(body: Record<string, unknown>): Promise<Response> {
    return serialize(async () => {
      if (state.profiles.length >= MAX_ENGINE_PROFILES) {
        throw new ConnectionApiError(409, "limit_exceeded", `At most ${MAX_ENGINE_PROFILES} saved connections are supported.`)
      }
      const name = sanitizeName(body.name)
      const engineUrl = normalizeEngineUrl(body.engineUrl)
      const authMode = normalizeAuthMode(body.authMode ?? "password")
      const username = normalizeUsername(body.username)
      const timestamp = now()
      const id = `eng_${randomBytes(8).toString("hex")}`
      let profile: StoredEngineProfile
      if (authMode === "password") {
        const password = normalizePassword(body.password)
        profile = { id, name, engineUrl, authMode, username, password, createdAt: timestamp, updatedAt: timestamp }
      } else {
        const serviceFile = normalizeServiceFile(body.serviceFile)
        // Validate readability before saving.
        await readServiceFilePassword(serviceFile)
        profile = { id, name, engineUrl, authMode, username, serviceFile, createdAt: timestamp, updatedAt: timestamp }
      }
      state.profiles.push(profile)
      let switched: ActiveEngineTarget | null = null
      if (body.activate === true) {
        switched = await resolveTargetForId(profile.id)
        state.activeId = profile.id
      }
      await persist()
      if (switched) {
        activeTarget = switched
        notifyListeners(switched)
      }
      const summary = summarize()
      const created = summary.profiles.find((item) => item.id === profile.id)!
      return jsonResponse(201, { profile: created, ...summary })
    })
  }

  async function handleUpdate(id: string, body: Record<string, unknown>): Promise<Response> {
    return serialize(async () => {
      if (id === DEFAULT_ENGINE_PROFILE_ID) {
        throw new ConnectionApiError(400, "default_immutable", "The startup default connection cannot be edited; create a new profile instead.")
      }
      const index = state.profiles.findIndex((item) => item.id === id)
      if (index < 0) {
        throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
      }
      const existing = state.profiles[index]
      const name = body.name !== undefined ? sanitizeName(body.name) : existing.name
      const engineUrl = body.engineUrl !== undefined ? normalizeEngineUrl(body.engineUrl) : existing.engineUrl
      const authMode = body.authMode !== undefined ? normalizeAuthMode(body.authMode) : existing.authMode
      const username = body.username !== undefined ? normalizeUsername(body.username) : existing.username
      const urlChanged = engineUrl !== existing.engineUrl

      let updated: StoredEngineProfile
      if (authMode === "password") {
        const suppliedPassword = typeof body.password === "string" && body.password.length > 0
        if (suppliedPassword) {
          const password = normalizePassword(body.password)
          updated = {
            id: existing.id,
            name,
            engineUrl,
            authMode,
            username,
            password,
            createdAt: existing.createdAt,
            updatedAt: now(),
          }
        } else if (existing.authMode === "password" && existing.password) {
          if (urlChanged) {
            throw new ConnectionApiError(
              400,
              "credential_required_for_url_change",
              "Enter the password for the new engine URL before saving."
            )
          }
          updated = {
            id: existing.id,
            name,
            engineUrl,
            authMode,
            username,
            password: existing.password,
            createdAt: existing.createdAt,
            updatedAt: now(),
          }
        } else {
          throw new ConnectionApiError(400, "invalid_password", "Provide the engine password.")
        }
      } else {
        const serviceFile =
          body.serviceFile !== undefined
            ? normalizeServiceFile(body.serviceFile)
            : existing.serviceFile
              ? existing.serviceFile
              : normalizeServiceFile(undefined)
        await readServiceFilePassword(serviceFile)
        updated = {
          id: existing.id,
          name,
          engineUrl,
          authMode,
          username,
          serviceFile,
          createdAt: existing.createdAt,
          updatedAt: now(),
        }
      }

      const previous = state.profiles[index]
      state.profiles[index] = updated
      let switched: ActiveEngineTarget | null = null
      if (state.activeId === id) {
        try {
          switched = await resolveTargetForId(id)
        } catch (error) {
          state.profiles[index] = previous
          throw error
        }
      }
      await persist()
      if (switched) {
        activeTarget = switched
        notifyListeners(switched)
      }
      const summary = summarize()
      const profileSummary = summary.profiles.find((item) => item.id === id)!
      return jsonResponse(200, { profile: profileSummary, ...summary })
    })
  }

  async function handleDelete(id: string): Promise<Response> {
    return serialize(async () => {
      if (id === DEFAULT_ENGINE_PROFILE_ID) {
        throw new ConnectionApiError(400, "default_immutable", "The startup default connection cannot be deleted.")
      }
      if (state.activeId === id) {
        throw new ConnectionApiError(409, "cannot_delete_active", "Switch to another connection before deleting this one.")
      }
      const index = state.profiles.findIndex((item) => item.id === id)
      if (index < 0) {
        throw new ConnectionApiError(404, "not_found", "Connection profile was not found.")
      }
      state.profiles.splice(index, 1)
      await persist()
      return jsonResponse(200, summarize())
    })
  }

  async function handleActivate(id: string): Promise<Response> {
    return serialize(async () => {
      const nextTarget = await resolveTargetForId(id)
      const changed =
        activeTarget.id !== nextTarget.id ||
        activeTarget.engineUrl !== nextTarget.engineUrl ||
        activeTarget.authorization !== nextTarget.authorization
      state.activeId = id
      await persist()
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
    onChange(listener: (target: ActiveEngineTarget) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    handleRequest,
    stateFile,
  }
}

export type EngineConnectionsService = ReturnType<typeof createEngineConnectionsService>
