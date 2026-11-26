import { describe, expect, test } from "bun:test"

import {
  DEFAULT_API_PREFIXES,
  evaluateRequest,
  isAllowedApiPath,
  isAllowedOrigin,
} from "../server/request-security.ts"

const secureInput = {
  method: "GET",
  host: "example.test",
  origin: "https://example.test",
  secFetchSite: "same-origin",
  contentType: undefined,
  contentLength: undefined,
  transferEncoding: undefined,
}
const options = {
  allowedHosts: ["example.test"],
  allowedOrigins: ["https://example.test"],
}

describe("system command API allowlist", () => {
  test("allowlists only the pairing prefix, not the debug prefix", () => {
    expect(DEFAULT_API_PREFIXES).not.toContain("/api/debug")
    expect(DEFAULT_API_PREFIXES).toContain("/api/pair")
    expect(isAllowedApiPath("/api/debug", DEFAULT_API_PREFIXES)).toBe(false)
    expect(isAllowedApiPath("/api/debug/locations", DEFAULT_API_PREFIXES)).toBe(false)
    expect(isAllowedApiPath("/api/pair", DEFAULT_API_PREFIXES)).toBe(true)
  })

  test("rejects debug requests but allows pair requests from a trusted origin", () => {
    for (const pathname of ["/api/debug", "/api/debug/locations"]) {
      expect(
        evaluateRequest({ ...secureInput, pathname }, options)
      ).toMatchObject({ allowed: false, status: 403 })
    }
    expect(
      evaluateRequest({ ...secureInput, pathname: "/api/pair" }, options).allowed
    ).toBe(true)
  })

  // Keep the explicit deny as defense in depth if a prefix change ever
  // re-allowlists /api/debug; startsWith also covers versioned sub-paths.
  test("explicitly denies the heap-dump endpoint", () => {
    for (const pathname of ["/api/debug/heap-dump", "/api/debug/heap-dump/now"]) {
      const decision = evaluateRequest(
        {
          ...secureInput,
          method: "POST",
          pathname,
          contentType: "application/json",
          hasBody: true,
        },
        options
      )
      expect(decision).toEqual({
        allowed: false,
        status: 403,
        reason: "heap dumps are not available through the browser",
      })
      expect(decision.allowed === false && /heap/i.test(decision.reason)).toBe(true)
    }
  })

  test("keeps host, origin and method guards intact", () => {
    expect(
      evaluateRequest({ ...secureInput, pathname: "/api/pair", host: "evil.test" }, options)
    ).toMatchObject({ allowed: false, status: 403 })
    expect(
      evaluateRequest({ ...secureInput, pathname: "/api/pair", origin: "https://evil.test" }, options)
    ).toMatchObject({ allowed: false, status: 403 })
    expect(
      evaluateRequest({ ...secureInput, method: "TRACE", pathname: "/api/pair" }, options)
    ).toMatchObject({ allowed: false, status: 405 })
    expect(isAllowedOrigin("http://example.test", options.allowedOrigins)).toBe(false)
  })
})

// Pure helpers live in a browser-global-free module; no window stub needed.
const {
  buildStatusLines,
  changelogUrl,
  compareVersions,
  finiteExpiry,
  flattenUsagePayload,
  highlightRequestInit,
  isVersionAtLeast,
  parseHighlights,
  planUsageLimitsRequest,
  releaseNotesUrl,
  safeReleaseVersion,
  safeServerUrl,
  supportsUsageLimits,
  usageLimitsUrl,
} = await import("../src/lib/system-commands.ts")
const { isBrowserConnectMethod } = await import("../src/lib/provider-auth.ts")

const CHANGELOG = `# Changelog

## v2.3.2

### Highlights

- **Faster startup**: Cold start is up to 2x faster ([#1234](https://github.com/anomalyco/opencode/pull/1234))
- **New usage command**: See remaining limits ([abc123](https://github.com/anomalyco/opencode/commit/abc123))

  - **Nested bullet is ignored**: not an upstream highlight

### Fixes

- **Unrelated fix**: Should not be included ([#9](https://github.com/anomalyco/opencode/pull/9))
`

describe("release highlights parser", () => {
  test("parses the upstream bullet shape and strips trailing PR links", () => {
    expect(parseHighlights(CHANGELOG)).toEqual([
      { title: "Faster startup", body: "Cold start is up to 2x faster" },
      { title: "New usage command", body: "See remaining limits" },
    ])
  })

  test("returns an honest empty list without a Highlights section", () => {
    expect(parseHighlights("## v2.1.4\n\n- **Something**: without a section")).toEqual([])
    expect(parseHighlights("")).toEqual([])
  })

  test("caps items at five and ignores non-highlight headings", () => {
    const many = `### Highlights\n${Array.from(
      { length: 8 },
      (_, index) => `- **Feature ${index}**: Body ${index} ([#${index}](https://example.test/p/${index}))`
    ).join("\n")}\n## Next\n\n- **Later**: ignored`
    const parsed = parseHighlights(many)
    expect(parsed).toHaveLength(5)
    expect(parsed[0]).toEqual({ title: "Feature 0", body: "Body 0" })
    expect(parsed.some((item) => item.title === "Later")).toBe(false)
  })

  test("bounds and hardens the public changelog request", () => {
    const init = highlightRequestInit()
    expect(init.credentials).toBe("omit")
    expect(init.signal).toBeDefined()
  })
})

describe("version and capability gates", () => {
  test("compares dotted versions", () => {
    expect(compareVersions("2.1.4", "2.3.2")).toBeLessThan(0)
    expect(compareVersions("2.3.2", "2.3.2")).toBe(0)
    expect(compareVersions("2.10.0", "2.3.2")).toBeGreaterThan(0)
  })

  // The native usage-limits route was verified in upstream v2.3.2
  // (packages/protocol/src/groups/usage.ts and the v2.3.2 OpenAPI document).
  // The pinned v2.1.4 client has no typed method, so the dialog uses a raw
  // fetch but gates it at >=2.3.2 rather than downgrading /usage.
  test("gates usage limits at 2.3.2 and plans no fetch on the pinned engine", () => {
    expect(supportsUsageLimits(null)).toBe(false)
    expect(supportsUsageLimits("2.1.4")).toBe(false)
    expect(supportsUsageLimits("2.3.1")).toBe(false)
    expect(supportsUsageLimits("2.3.2")).toBe(true)
    expect(supportsUsageLimits("2.4.0")).toBe(true)
    expect(isVersionAtLeast("2.3.2", "2.3.2")).toBe(true)

    expect(planUsageLimitsRequest("2.1.4", "/tmp/project")).toEqual({
      fetch: false,
      reason: "unsupported-version",
    })
    expect(planUsageLimitsRequest(null, "/tmp/project")).toEqual({
      fetch: false,
      reason: "unsupported-version",
    })
    expect(planUsageLimitsRequest("2.3.2", null)).toEqual({
      fetch: false,
      reason: "missing-directory",
    })

    const plan = planUsageLimitsRequest("2.3.2", "/tmp/project")
    expect(plan.fetch).toBe(true)
    expect(plan.fetch ? plan.url : null).toBe(usageLimitsUrl("/tmp/project"))
    expect(plan.fetch ? plan.url : null).toContain("usage/limits")
  })

  test("validates versions before interpolating them into URLs", () => {
    expect(safeReleaseVersion("2.1.4")).toBe("2.1.4")
    expect(safeReleaseVersion("2.3.2-beta.1")).toBe("2.3.2-beta.1")
    expect(safeReleaseVersion("../../evil")).toBeNull()
    expect(safeReleaseVersion("2.1.4/../secret")).toBeNull()
    expect(safeReleaseVersion(null)).toBeNull()
    expect(changelogUrl("2.1.4")).toBe(
      "https://raw.githubusercontent.com/anomalyco/opencode/v2.1.4/CHANGELOG.md"
    )
    expect(releaseNotesUrl("2.1.4")).toBe(
      "https://github.com/anomalyco/opencode/releases/tag/v2.1.4"
    )
  })

  test("validates server URLs", () => {
    expect(safeServerUrl("http://192.168.1.5:5174")).toBe("http://192.168.1.5:5174/")
    expect(safeServerUrl("https://ui.example.test")).toBe("https://ui.example.test/")
    expect(safeServerUrl("http://user:pass@example.test")).toBeNull()
    expect(safeServerUrl("javascript:alert(1)")).toBeNull()
    expect(safeServerUrl(undefined)).toBeNull()
    expect(Number.isNaN(finiteExpiry("Infinity"))).toBe(true)
    expect(finiteExpiry(1234)).toBe(1234)
  })

  test("all native RPC auth methods are browser-connectable", () => {
    for (const type of ["key", "oauth", "external", "command"] as const) {
      expect(isBrowserConnectMethod({ ...{ type }, id: "m", label: "M" } as never)).toBe(true)
    }
    expect(isBrowserConnectMethod({ type: "env", names: ["TOKEN"] })).toBe(false)
  })
})

describe("adapter source guards", () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text()

  test("connect dialog has no HTTPS gating and uses every native auth method", async () => {
    const source = await read("../src/components/connect-dialog.tsx")
    expect(source).not.toContain("isSecureContext")
    expect(source).not.toContain("canonicalHttpsOrigin")
    expect(source).not.toContain("available only on the canonical HTTPS")
    expect(source).toContain("integration.connect.external")
    expect(source).toContain("integration.command.connect")
    expect(source).toContain("integration.command.status")
    expect(source).toContain("integration.command.cancel")
    expect(source).toContain("Credentials traverse this HTTP origin")
  })

  test("MCP and plugin dialogs use native operations with confirmations", async () => {
    const source = await read("../src/components/integration-command-dialogs.tsx")
    for (const call of ["mcp.add", "mcp.remove", "mcp.connect", "mcp.disconnect", "plugin.check", "plugin.update"]) {
      expect(source).toContain(`openCode.${call}`)
    }
    expect(source).toContain("Remove MCP server?")
    expect(source).toContain("Update plugin?")
    expect(source).toContain("sanitizedNativeError")
    expect(source).toContain("Heap dumps and native debug bodies are never exposed")
  })

  test("system dialogs use native pairing and never expose a heap dump", async () => {
    const source = await read("../src/components/system-command-dialogs.tsx")
    expect(source).toContain("openCode.server.pair()")
    expect(source).toContain("openCode.server.info()")
    expect(source).not.toContain("heap-dump")
    // Usage fetches only through the version-gated plan, never an inline path.
    expect(source).toContain("planUsageLimitsRequest(resolved, directory)")
    expect(source).toContain("if (!plan.fetch)")
    expect(source).toContain("fetch(plan.url")
    const helpers = await read("../src/lib/system-commands.ts")
    expect(helpers).toContain("packages/protocol/src/groups/usage.ts")
    expect(helpers).toContain("/api/experimental/usage/limits")
  })
})

describe("safe native value rendering", () => {
  test("status lines use real server info without secrets", () => {
    const lines = buildStatusLines(
      {
        version: "2.1.4",
        pid: 4242,
        urls: ["http://localhost:4096", "https://user:pw@bad.test"],
        paths: { tmp: "/tmp" },
        capabilities: { persistentPty: true },
      },
      {
        connection: "connected",
        streamStatus: "ready",
        scope: "all",
        location: null,
        activeSession: null,
      }
    )
    expect(lines).toContain("Server version: 2.1.4")
    expect(lines).toContain("Server PID: 4242")
    expect(lines).toContain("Server URLs: http://localhost:4096/")
    expect(lines.some((line) => line.includes("bad.test"))).toBe(false)
    expect(lines).toContain("Persistent PTY: available")
  })

  test("usage payload flattening drops sensitive keys", () => {
    const rows = flattenUsagePayload({
      remaining: 42,
      resetAt: "2026-11-20T00:00:00Z",
      access_token: "supersecret",
      nested: { used: 8, apiKey: "nope" },
    })
    expect(rows).toEqual([
      { label: "remaining", value: "42" },
      { label: "resetAt", value: "2026-11-20T00:00:00Z" },
      { label: "nested.used", value: "8" },
    ])
  })
})
