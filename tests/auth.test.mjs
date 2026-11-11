import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  AUTH_FAILURE_DELAY_MS,
  AUTH_MAX_SESSIONS,
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_SESSION_TTL_MS,
  buildSessionCookie,
  clearSessionCookie,
  createAuthService,
  hashSessionToken,
} from "../server/auth.ts"

const dirs = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true })
})

async function workspace() {
  const dir = await mkdtemp("/tmp/opencode/auth-test-")
  dirs.push(dir)
  return { dir, stateFile: join(dir, "auth", "state.json") }
}

const withCookie = (token, url = "http://127.0.0.1:5174/api/ui/auth/status") =>
  new Request(url, { headers: { cookie: `opencode_ui_session=${token}` } })

const password = "correct horse battery"

describe("auth state", () => {
  test("stores only an argon2id hash and SHA-256 session digests", async () => {
    const { dir, stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    const token = await auth.setup(password)
    expect(token).toMatch(/^[a-f0-9]{64}$/)

    const raw = await readFile(stateFile, "utf8")
    expect(raw).not.toContain(password)
    expect(raw).not.toContain(token)
    const stored = JSON.parse(raw)
    expect(stored.passwordHash.startsWith("$argon2id$")).toBe(true)
    expect(await Bun.password.verify(password, stored.passwordHash)).toBe(true)
    expect(stored.sessions).toHaveLength(1)
    expect(stored.sessions[0].tokenHash).toBe(hashSessionToken(token))
    expect(typeof stored.updatedAt).toBe("number")

    const fileStat = await stat(stateFile)
    expect(fileStat.mode & 0o777).toBe(0o600)
    const dirStat = await stat(join(dir, "auth"))
    expect(dirStat.mode & 0o777).toBe(0o700)
  })

  test("setup rejects a second password and invalid lengths", async () => {
    const { stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    await expect(auth.setup("short")).rejects.toMatchObject({ status: 400, code: "invalid" })
    await expect(auth.setup("a".repeat(257))).rejects.toMatchObject({ status: 400, code: "invalid" })
    await auth.setup(password)
    await expect(auth.setup("another password")).rejects.toMatchObject({ status: 409, code: "already_configured" })
  })

  test("status reflects configured, required and authentication", async () => {
    const { stateFile } = await workspace()
    const open = createAuthService({ stateFile, failureDelayMs: 0 })
    expect(await open.status(new Request("http://127.0.0.1/auth"))).toEqual({
      configured: false,
      required: false,
      authenticated: true,
    })

    const token = await open.setup(password)
    expect(await open.status(new Request("http://127.0.0.1/auth"))).toEqual({
      configured: true,
      required: false,
      authenticated: false,
    })
    expect(await open.status(withCookie(token))).toEqual({
      configured: true,
      required: false,
      authenticated: true,
    })

    const { stateFile: requiredFile } = await workspace()
    const required = createAuthService({ stateFile: requiredFile, required: true, failureDelayMs: 0 })
    expect(await required.status(new Request("http://127.0.0.1/auth"))).toEqual({
      configured: false,
      required: true,
      authenticated: false,
    })
  })

  test("login verifies the password and reports not_configured", async () => {
    const { stateFile } = await workspace()
    const unconfigured = createAuthService({ stateFile, failureDelayMs: 0 })
    await expect(unconfigured.login(password, "10.0.0.1")).rejects.toMatchObject({ status: 409, code: "not_configured" })

    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    await auth.setup(password)
    await expect(auth.login("wrong password", "10.0.0.1")).rejects.toMatchObject({ status: 401, code: "invalid_credentials" })
    const token = await auth.login(password, "10.0.0.1")
    expect(await auth.authenticate(withCookie(token))).toBe(true)
  })

  test("throttles failed logins per remote address and recovers after the window", async () => {
    const { stateFile } = await workspace()
    let clock = 1_000_000
    const auth = createAuthService({ stateFile, failureDelayMs: 0, now: () => clock })
    await auth.setup(password)
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(auth.login("wrong password", "10.0.0.9")).rejects.toMatchObject({ status: 401 })
    }
    await expect(auth.login("wrong password", "10.0.0.9")).rejects.toMatchObject({ status: 429, code: "too_many_attempts" })
    // Other addresses are unaffected.
    await expect(auth.login("wrong password", "10.0.0.10")).rejects.toMatchObject({ status: 401 })
    clock += 60_001
    await expect(auth.login("wrong password", "10.0.0.9")).rejects.toMatchObject({ status: 401 })
    expect(AUTH_FAILURE_DELAY_MS).toBe(250)
  })

  test("sessions expire after 30 days and are pruned on writes", async () => {
    const { stateFile } = await workspace()
    let clock = 5_000_000
    const auth = createAuthService({ stateFile, failureDelayMs: 0, now: () => clock })
    const token = await auth.setup(password)
    clock += AUTH_SESSION_TTL_MS - 1
    expect(await auth.authenticate(withCookie(token))).toBe(true)
    clock += 2
    expect(await auth.authenticate(withCookie(token))).toBe(false)
    expect(await auth.status(withCookie(token))).toEqual({
      configured: true,
      required: false,
      authenticated: false,
    })
    await auth.login(password, "10.0.0.1")
    const stored = JSON.parse(await readFile(stateFile, "utf8"))
    expect(stored.sessions).toHaveLength(1)
    expect(stored.sessions[0].tokenHash).not.toBe(hashSessionToken(token))
  })

  test("caps sessions at the newest 20", async () => {
    const { stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    await auth.setup(password)
    const stored = JSON.parse(await readFile(stateFile, "utf8"))
    const base = Date.now() - 100_000
    const manualToken = (index) => String(index).padStart(64, "a")
    stored.sessions = Array.from({ length: 25 }, (_, index) => ({
      tokenHash: manualToken(index),
      createdAt: base + index,
    }))
    await writeFile(stateFile, JSON.stringify(stored), { mode: 0o600 })

    const reloaded = createAuthService({ stateFile, failureDelayMs: 0 })
    await reloaded.login(password, "10.0.0.2")
    const after = JSON.parse(await readFile(stateFile, "utf8"))
    expect(after.sessions).toHaveLength(AUTH_MAX_SESSIONS)
    expect(after.sessions.some((session) => session.tokenHash === manualToken(0))).toBe(false)
    expect(after.sessions.some((session) => session.tokenHash === manualToken(5))).toBe(false)
    expect(after.sessions.some((session) => session.tokenHash === manualToken(6))).toBe(true)
  })

  test("logout removes the session server-side", async () => {
    const { stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    const token = await auth.setup(password)
    expect(await auth.authenticate(withCookie(token))).toBe(true)
    await auth.logout(withCookie(token))
    expect(await auth.authenticate(withCookie(token))).toBe(false)
    await auth.logout(new Request("http://127.0.0.1/auth"))
    expect(await auth.authenticate(withCookie(token))).toBe(false)
  })
})

describe("password changes", () => {
  test("requires the current password and the active session", async () => {
    const { stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    const token = await auth.setup(password)
    await expect(auth.changePassword(withCookie("f".repeat(64)), password, "next password")).rejects.toMatchObject({ status: 401, code: "auth_required" })
    await expect(auth.changePassword(withCookie(token), "wrong password", "next password")).rejects.toMatchObject({ status: 401, code: "invalid_credentials" })
    await expect(auth.changePassword(withCookie(token), password, "short")).rejects.toMatchObject({ status: 400, code: "invalid" })
  })

  test("keeps the current session and invalidates the others", async () => {
    const { stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    const first = await auth.setup(password)
    const second = await auth.login(password, "10.0.0.3")
    await auth.changePassword(withCookie(first), password, "next password")
    expect(await auth.authenticate(withCookie(first))).toBe(true)
    expect(await auth.authenticate(withCookie(second))).toBe(false)
    await expect(auth.login(password, "10.0.0.3")).rejects.toMatchObject({ status: 401 })
    expect(await auth.authenticate(withCookie(await auth.login("next password", "10.0.0.3")))).toBe(true)
  })

  test("removing the password clears every session and is refused when required", async () => {
    const { stateFile } = await workspace()
    const auth = createAuthService({ stateFile, failureDelayMs: 0 })
    const token = await auth.setup(password)
    const other = await auth.login(password, "10.0.0.4")
    await auth.changePassword(withCookie(token), password, "")
    const stored = JSON.parse(await readFile(stateFile, "utf8"))
    expect(stored.passwordHash).toBeNull()
    expect(stored.sessions).toHaveLength(0)
    expect(await auth.authenticate(withCookie(other))).toBe(false)
    expect(await auth.status(new Request("http://127.0.0.1/auth"))).toEqual({
      configured: false,
      required: false,
      authenticated: true,
    })

    const { stateFile: requiredFile } = await workspace()
    const required = createAuthService({ stateFile: requiredFile, required: true, failureDelayMs: 0 })
    const requiredToken = await required.setup(password)
    await expect(required.changePassword(withCookie(requiredToken), password, "")).rejects.toMatchObject({ status: 409, code: "password_required" })
  })
})

describe("session cookie", () => {
  test("uses the contract flags and adds Secure only for https", () => {
    const token = "a".repeat(64)
    const plain = buildSessionCookie(token, false)
    expect(plain).toBe(`opencode_ui_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`)
    expect(plain).not.toContain("Secure")
    expect(buildSessionCookie(token, true).endsWith("; Secure")).toBe(true)
    expect(clearSessionCookie(false)).toBe("opencode_ui_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
    expect(clearSessionCookie(true).endsWith("; Secure")).toBe(true)
  })
})
