import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const AUTH_COOKIE_NAME = "opencode_ui_session"
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const AUTH_SESSION_MAX_AGE_SECONDS = AUTH_SESSION_TTL_MS / 1000
export const AUTH_MAX_SESSIONS = 20
export const AUTH_MAX_FAILED_ATTEMPTS = 10
export const AUTH_ATTEMPT_WINDOW_MS = 60_000
export const AUTH_FAILURE_DELAY_MS = 250
export const AUTH_PASSWORD_MIN_LENGTH = 8
export const AUTH_PASSWORD_MAX_LENGTH = 256

export type AuthSession = { tokenHash: string; createdAt: number }

export type AuthState = {
  passwordHash: string | null
  sessions: AuthSession[]
  updatedAt: number
}

/** Expected failures carry the HTTP status and stable error code for the API layer. */
export class AuthError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export type AuthServiceOptions = {
  /** Password is mandatory when the UI binds a non-loopback host. */
  required?: boolean
  stateFile?: string
  now?: () => number
  failureDelayMs?: number
  /** Session cookie name; override when two UI instances share a host. */
  cookieName?: string
}

export type AuthService = ReturnType<typeof createAuthService>

export const AUTH_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/api/ui/auth/status",
  "/api/ui/auth/setup",
  "/api/ui/auth/login",
  "/api/ui/auth/logout",
])

export type AuthGateDecision =
  | { allowed: true }
  | { allowed: false; code: "setup_required" | "auth_required" }

/**
 * Gate every /api path (HTTP and WebSocket upgrades) while a password is configured or
 * the bind host is not loopback. Static assets and the auth endpoints stay reachable.
 */
export function createAuthGate(auth: AuthService) {
  return async (request: Request): Promise<AuthGateDecision> => {
    const path = new URL(request.url).pathname
    if (!path.startsWith("/api")) return { allowed: true }
    if (AUTH_EXEMPT_PATHS.has(path)) return { allowed: true }
    if (!(await auth.gatingActive())) return { allowed: true }
    if (await auth.authenticate(request)) return { allowed: true }
    try {
      return { allowed: false, code: (await auth.configured()) ? "auth_required" : "setup_required" }
    } catch {
      return { allowed: false, code: "auth_required" }
    }
  }
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= AUTH_PASSWORD_MIN_LENGTH && value.length <= AUTH_PASSWORD_MAX_LENGTH
}

type PasswordHasher = {
  hash: (password: string, options: { algorithm: "argon2id" }) => Promise<string>
  verify: (password: string, hash: string) => Promise<boolean>
}

function passwordHasher(): PasswordHasher {
  return (globalThis as unknown as { Bun: { password: PasswordHasher } }).Bun.password
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function buildSessionCookie(
  token: string,
  secure: boolean,
  name: string = AUTH_COOKIE_NAME
): string {
  const base = `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`
  return secure ? `${base}; Secure` : base
}

export function clearSessionCookie(
  secure: boolean,
  name: string = AUTH_COOKIE_NAME
): string {
  const base = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  return secure ? `${base}; Secure` : base
}

function sessionTokenFrom(
  request: Request,
  name: string = AUTH_COOKIE_NAME
): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    if (part.slice(0, index).trim() !== name) continue
    const value = part.slice(index + 1).trim()
    return /^[a-f0-9]{64}$/.test(value) ? value : null
  }
  return null
}

function sessionMatches(session: AuthSession, tokenHash: string): boolean {
  const stored = Buffer.from(session.tokenHash, "hex")
  const candidate = Buffer.from(tokenHash, "hex")
  if (stored.length !== candidate.length || stored.length === 0) return false
  return timingSafeEqual(stored, candidate)
}

function parseState(raw: string): AuthState {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object") throw new Error("invalid auth state")
  const input = parsed as Partial<AuthState>
  const passwordHash = input.passwordHash ?? null
  if (passwordHash !== null && typeof passwordHash !== "string") throw new Error("invalid auth state")
  if (!Array.isArray(input.sessions)) throw new Error("invalid auth state")
  const sessions: AuthSession[] = []
  for (const session of input.sessions) {
    if (!session || typeof session !== "object") throw new Error("invalid auth state")
    const value = session as Partial<AuthSession>
    if (typeof value.tokenHash !== "string" || typeof value.createdAt !== "number") throw new Error("invalid auth state")
    sessions.push({ tokenHash: value.tokenHash, createdAt: value.createdAt })
  }
  return {
    passwordHash,
    sessions,
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : 0,
  }
}

/**
 * File-backed password and session state for the UI. Passwords are argon2id hashes;
 * session tokens are random and only their SHA-256 digests are stored.
 */
export function createAuthService(options: AuthServiceOptions = {}) {
  const required = options.required ?? false
  const stateFile =
    options.stateFile ??
    process.env.OPENCODE_UI_AUTH_STATE ??
    join(homedir(), ".local", "share", "opencode-ui", "auth", "state.json")
  const now = options.now ?? Date.now
  const failureDelayMs = options.failureDelayMs ?? AUTH_FAILURE_DELAY_MS
  const cookieName = options.cookieName ?? AUTH_COOKIE_NAME
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cookieName)) {
    throw new Error("Invalid session cookie name")
  }

  let state: AuthState | null = null
  let loadPromise: Promise<AuthState> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const failures = new Map<string, number[]>()

  function freshState(): AuthState {
    return { passwordHash: null, sessions: [], updatedAt: 0 }
  }

  async function load(): Promise<AuthState> {
    if (state) return state
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const raw = await readFile(stateFile, "utf8")
        state = parseState(raw)
        await chmod(stateFile, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
          state = freshState()
        } else {
          throw error
        }
      }
      return state
    })()
    return loadPromise
  }

  function prune(target: AuthState, at: number) {
    target.sessions = target.sessions
      .filter((session) => at - session.createdAt < AUTH_SESSION_TTL_MS)
      .sort((left, right) => left.createdAt - right.createdAt)
    while (target.sessions.length > AUTH_MAX_SESSIONS) target.sessions.shift()
  }

  async function persist(target: AuthState) {
    target.updatedAt = now()
    prune(target, target.updatedAt)
    const directory = dirname(stateFile)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const temp = `${stateFile}.${randomBytes(8).toString("hex")}.tmp`
    await writeFile(temp, JSON.stringify(target), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, stateFile)
    await chmod(stateFile, 0o600)
  }

  function mutate<T>(change: (target: AuthState) => Promise<T> | T): Promise<T> {
    const result = queue.then(async () => {
      const target = await load()
      const value = await change(target)
      await persist(target)
      return value
    })
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /**
   * Run a read-only check on the same serialization queue as `mutate`.
   *
   * A password re-check must not write the state file, but it must still be
   * ordered against `login` so the shared failure counter and the session list
   * cannot drift under concurrency.
   */
  function serialized<T>(change: (target: AuthState) => Promise<T> | T): Promise<T> {
    const result = queue.then(async () => change(await load()))
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function validSession(target: AuthState, token: string | null): boolean {
    if (!token) return false
    const tokenHash = hashSessionToken(token)
    const at = now()
    return target.sessions.some(
      (session) => at - session.createdAt < AUTH_SESSION_TTL_MS && sessionMatches(session, tokenHash),
    )
  }

  function addSession(target: AuthState): string {
    const token = randomBytes(32).toString("hex")
    target.sessions.push({ tokenHash: hashSessionToken(token), createdAt: now() })
    prune(target, now())
    return token
  }

  function recentFailures(remote: string): number[] {
    const cutoff = now() - AUTH_ATTEMPT_WINDOW_MS
    const attempts = (failures.get(remote) ?? []).filter((at) => at > cutoff)
    if (attempts.length) failures.set(remote, attempts)
    else failures.delete(remote)
    return attempts
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function configured(): Promise<boolean> {
    return (await load()).passwordHash !== null
  }

  /** Gating is active when a password exists or the bind host is not loopback. */
  async function gatingActive(): Promise<boolean> {
    try {
      return (await load()).passwordHash !== null || required
    } catch {
      // An unreadable state file is treated as configured so requests fail closed.
      return true
    }
  }

  async function authenticate(request: Request): Promise<boolean> {
    try {
      return validSession(await load(), sessionTokenFrom(request, cookieName))
    } catch {
      return false
    }
  }

  async function status(request: Request): Promise<{ configured: boolean; required: boolean; authenticated: boolean }> {
    const target = await load()
    const passwordConfigured = target.passwordHash !== null
    return {
      configured: passwordConfigured,
      required,
      authenticated: validSession(target, sessionTokenFrom(request, cookieName)) || !(passwordConfigured || required),
    }
  }

  async function setup(password: unknown): Promise<string> {
    if (!isValidPassword(password)) throw new AuthError(400, "invalid")
    return mutate(async (target) => {
      if (target.passwordHash !== null) throw new AuthError(409, "already_configured")
      target.passwordHash = await passwordHasher().hash(password, { algorithm: "argon2id" })
      return addSession(target)
    })
  }

  async function login(password: unknown, remote: string): Promise<string> {
    if (typeof password !== "string") throw new AuthError(400, "invalid")
    return mutate(async (target) => {
      if (recentFailures(remote).length >= AUTH_MAX_FAILED_ATTEMPTS) throw new AuthError(429, "too_many_attempts")
      if (target.passwordHash === null) throw new AuthError(409, "not_configured")
      if (!(await passwordHasher().verify(password, target.passwordHash))) {
        const attempts = recentFailures(remote)
        attempts.push(now())
        failures.set(remote, attempts)
        if (failureDelayMs > 0) await delay(failureDelayMs)
        throw new AuthError(401, "invalid_credentials")
      }
      failures.delete(remote)
      return addSession(target)
    })
  }

  /**
   * Re-verify the access password without minting a session.
   *
   * This exists for a step-up check on an already-authenticated request (the
   * *and* the password before a sensitive action. It shares login's failed-attempt
   * counter and failure delay, so it is not a cheaper brute-force oracle than
   * login: the same per-remote window and ceiling apply, a failure is counted
   * identically, and a failure is delayed identically. It deliberately does not
   * clear the counter on success, because it does not create a session; login
   * remains the only place a successful password check resets the window.
   *
   * Nothing is persisted: a successful check mutates no state, so this cannot be
   * used to probe or change the stored hash.
   */
  async function verifyPassword(password: unknown, remote: string): Promise<void> {
    if (typeof password !== "string") throw new AuthError(400, "invalid")
    await serialized(async (target) => {
      if (recentFailures(remote).length >= AUTH_MAX_FAILED_ATTEMPTS)
        throw new AuthError(429, "too_many_attempts")
      if (target.passwordHash === null) throw new AuthError(409, "not_configured")
      if (!(await passwordHasher().verify(password, target.passwordHash))) {
        const attempts = recentFailures(remote)
        attempts.push(now())
        failures.set(remote, attempts)
        if (failureDelayMs > 0) await delay(failureDelayMs)
        throw new AuthError(401, "invalid_credentials")
      }
    })
  }

  async function logout(request: Request): Promise<void> {
    const token = sessionTokenFrom(request, cookieName)
    if (!token) return
    const tokenHash = hashSessionToken(token)
    await mutate((target) => {
      target.sessions = target.sessions.filter((session) => !sessionMatches(session, tokenHash))
    })
  }

  async function changePassword(request: Request, current: unknown, next: unknown): Promise<void> {
    if (typeof current !== "string" || typeof next !== "string") throw new AuthError(400, "invalid")
    if (next !== "" && !isValidPassword(next)) throw new AuthError(400, "invalid")
    if (next === "" && required) throw new AuthError(409, "password_required")
    const token = sessionTokenFrom(request, cookieName)
    await mutate(async (target) => {
      if (target.passwordHash === null) {
        if (next === "") return
        throw new AuthError(401, "auth_required")
      }
      if (!validSession(target, token)) throw new AuthError(401, "auth_required")
      if (!(await passwordHasher().verify(current, target.passwordHash))) throw new AuthError(401, "invalid_credentials")
      if (next === "") {
        target.passwordHash = null
        target.sessions = []
        return
      }
      target.passwordHash = await passwordHasher().hash(next, { algorithm: "argon2id" })
      const tokenHash = hashSessionToken(token as string)
      target.sessions = target.sessions.filter((session) => sessionMatches(session, tokenHash))
    })
  }

  return {
    stateFile,
    required,
    cookieName,
    configured,
    gatingActive,
    authenticate,
    status,
    setup,
    login,
    verifyPassword,
    logout,
    changePassword,
  }
}
