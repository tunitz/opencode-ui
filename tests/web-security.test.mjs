import { describe, expect, test } from "bun:test"
import { evaluateWebRequest, secureWebResponse } from "../server/web-security.ts"

const options = { allowedHosts: ["example.test"], allowedOrigins: ["https://example.test"] }
const headers = { host: "example.test", origin: "https://example.test" }

describe("Web gateway security", () => {
  test("checks hosts even for static routes", () => {
    const request = new Request("https://example.test/", { headers: { host: "evil.test" } })
    expect(evaluateWebRequest(request, options).allowed).toBe(false)
  })

  test("does not proxy the unallowlisted bare API path", () => {
    const request = new Request("https://example.test/api", { headers })
    expect(evaluateWebRequest(request, options).allowed).toBe(false)
  })

  test("rejects a non-JSON mutation body without relying on length headers", () => {
    const request = new Request("https://example.test/api/session", {
      method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "payload",
    })
    expect(evaluateWebRequest(request, options)).toEqual({ allowed: false, status: 415, reason: "browser mutation must be JSON" })
  })

  test("allows JSON mutations from a trusted origin", () => {
    const request = new Request("https://example.test/api/session", {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}",
    })
    expect(evaluateWebRequest(request, options).allowed).toBe(true)
  })

  test("exposes only the explicit notes RPC methods with normal mutation guards", () => {
    const request = (path, init = {}) => new Request(`https://example.test${path}`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}", ...init,
    })
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/list"), options).allowed).toBe(true)
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/list"), { ...options, allowedApiPrefixes: [] }).allowed).toBe(false)
    for (const path of ["/api/rpc/other/list", "/api/rpc/opencode-notes/other", "/api/rpc/opencode-notes/list/extra"]) {
      expect(evaluateWebRequest(request(path), options).allowed).toBe(false)
    }
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/list", { method: "GET", body: undefined }), options).status).toBe(405)
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/list", { headers: { host: "example.test", "content-type": "application/json" } }), options).status).toBe(403)
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/create", { headers: { ...headers, "content-type": "text/plain" } }), options).status).toBe(415)
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/create", { headers, body: undefined }), options).status).toBe(415)
    expect(evaluateWebRequest(request("/api/rpc/opencode-notes/delete", { headers: { ...headers, origin: "https://evil.test", "content-type": "application/json" } }), options).status).toBe(403)
  })

  test("keeps artifact CSP and applies no-store and security headers", () => {
    const request = new Request("https://example.test/api/ui/artifact", { headers })
    const response = secureWebResponse(request, new Response("content", { headers: { "content-security-policy": "sandbox; default-src 'none'" } }))
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("vary")).toBe("Origin")
  })

  test("preserves SSE streaming cache policy", () => {
    const request = new Request("https://example.test/api/event", { headers })
    const response = secureWebResponse(request, new Response("", { headers: { "content-type": "text/event-stream" } }))
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
  })
})
