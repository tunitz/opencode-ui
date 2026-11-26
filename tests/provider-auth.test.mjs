import { expect, test } from "bun:test"

import { parseOAuthCallback } from "../src/lib/provider-auth.ts"

const authorize = "https://auth.openai.com/oauth/authorize?state=expected"

test("parseOAuthCallback accepts a bare authorization code", () => {
  expect(parseOAuthCallback("  code-123  ", authorize)).toEqual({
    code: "code-123",
    error: null,
  })
})

test("parseOAuthCallback extracts the code from a redirect URL", () => {
  expect(
    parseOAuthCallback(
      "http://localhost:1455/auth/callback?code=abc&state=expected",
      authorize
    )
  ).toEqual({ code: "abc", error: null })
})

test("parseOAuthCallback rejects a URL from another sign-in attempt", () => {
  const result = parseOAuthCallback(
    "http://localhost:1455/auth/callback?code=abc&state=foreign",
    authorize
  )
  expect(result.code).toBeNull()
  expect(result.error).toContain("different sign-in")
})

test("parseOAuthCallback reports missing codes and provider errors", () => {
  expect(parseOAuthCallback("http://localhost/callback", authorize).error).toContain(
    "no authorization code"
  )
  expect(
    parseOAuthCallback("http://localhost/callback?error=access_denied", authorize).error
  ).toContain("access_denied")
})
