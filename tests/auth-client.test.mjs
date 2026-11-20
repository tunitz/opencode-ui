import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  AuthApiError,
  authAwareFetch,
  changePassword,
  getAuthStatus,
  isAuthErrorPayload,
  login,
  logout,
  registerUnauthorizedHandler,
  setupPassword,
} from "../src/lib/auth"

const originalFetch = globalThis.fetch
let calls
let respond

function install() {
  calls = []
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      headers: init.headers ?? {},
      cache: init.cache,
      credentials: init.credentials,
    }
    calls.push(call)
    return respond(call)
  }
}

beforeEach(install)
afterEach(() => {
  globalThis.fetch = originalFetch
})

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

describe("getAuthStatus", () => {
  test("reads the status endpoint without caching and returns the shape", async () => {
    respond = () =>
      json({ configured: true, required: false, authenticated: true })
    const status = await getAuthStatus()
    expect(status).toEqual({
      configured: true,
      required: false,
      authenticated: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/api/ui/auth/status")
    expect(calls[0].method).toBe("GET")
    expect(calls[0].cache).toBe("no-store")
    expect(calls[0].credentials).toBe("same-origin")
  })

  test("rejects a malformed status payload instead of guessing", async () => {
    respond = () => json({ configured: "yes" })
    await expect(getAuthStatus()).rejects.toBeInstanceOf(AuthApiError)
    await expect(getAuthStatus()).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
    })
  })

  test("reports a network failure with status 0", async () => {
    respond = () => {
      throw new TypeError("offline")
    }
    await expect(getAuthStatus()).rejects.toMatchObject({
      status: 0,
      code: "network",
      message: "The server could not be reached.",
    })
  })

  test("maps an auth_required error body to AuthApiError", async () => {
    respond = () => json({ error: { code: "auth_required" } }, 401)
    await expect(getAuthStatus()).rejects.toMatchObject({
      status: 401,
      code: "auth_required",
      message: "Sign in to continue.",
    })
  })
})

describe("password endpoints", () => {
  test("setup posts only the password", async () => {
    respond = () => json({ ok: true })
    await setupPassword("correct horse")
    expect(calls[0]).toMatchObject({
      url: "/api/ui/auth/setup",
      method: "POST",
      body: { password: "correct horse" },
    })
    expect(calls[0].headers["content-type"]).toBe("application/json")
  })

  test("login surfaces invalid_credentials and throttling verbatim", async () => {
    respond = () => json({ error: { code: "invalid_credentials" } }, 401)
    await expect(login("wrong horse")).rejects.toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "That password is incorrect.",
    })

    respond = () => json({ error: { code: "too_many_attempts" } }, 429)
    await expect(login("wrong horse")).rejects.toMatchObject({
      status: 429,
      code: "too_many_attempts",
      message: "Too many attempts. Try again in a minute.",
    })
  })

  test("prefers a server-provided message when present", async () => {
    respond = () =>
      json({ error: { code: "invalid_credentials", message: "Nope." } }, 401)
    await expect(login("wrong horse")).rejects.toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "Nope.",
    })
  })

  test("changePassword sends current and next, including removal", async () => {
    respond = () => json({ ok: true })
    await changePassword("old password", "new password")
    expect(calls[0]).toMatchObject({
      url: "/api/ui/auth/password",
      method: "PUT",
      body: { current: "old password", next: "new password" },
    })

    await changePassword("old password", "")
    expect(calls[1].body).toEqual({ current: "old password", next: "" })
  })

  test("changePassword surfaces password_required as an error", async () => {
    respond = () => json({ error: { code: "password_required" } }, 409)
    await expect(changePassword("old password", "")).rejects.toMatchObject({
      status: 409,
      code: "password_required",
      message: "A password is required on this network.",
    })
  })

  test("logout posts and accepts an empty 204 response", async () => {
    respond = () => new Response(null, { status: 204 })
    await expect(logout()).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({
      url: "/api/ui/auth/logout",
      method: "POST",
    })
    expect(calls[0].body).toBeUndefined()
  })
})

describe("isAuthErrorPayload", () => {
  test("recognizes only the two gated-session codes", () => {
    expect(isAuthErrorPayload({ error: { code: "auth_required" } })).toBe(true)
    expect(isAuthErrorPayload({ error: { code: "setup_required" } })).toBe(true)
    expect(isAuthErrorPayload({ error: { code: "invalid_credentials" } })).toBe(
      false
    )
    expect(isAuthErrorPayload({ error: {} })).toBe(false)
    expect(isAuthErrorPayload({ error: "auth_required" })).toBe(false)
    expect(isAuthErrorPayload(null)).toBe(false)
    expect(isAuthErrorPayload("auth_required")).toBe(false)
    expect(isAuthErrorPayload(undefined)).toBe(false)
  })
})

describe("authAwareFetch", () => {
  test("signals only UI API 401s, not engine-proxied auth failures", async () => {
    const signal = []
    const unregister = registerUnauthorizedHandler((code) => signal.push(code))
    respond = () => json({ error: { code: "auth_required" } }, 401)
    try {
      await authAwareFetch("/api/agent")
      expect(signal).toEqual([])

      await authAwareFetch("/api/ui/session-shortcuts")
      expect(signal).toEqual(["auth_required"])
    } finally {
      unregister()
    }
  })
})
