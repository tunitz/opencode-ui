import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { BunConfigurationError } from "../server/bun-config.ts"
import { CLI_HELP, parseCliFlags } from "../server/cli-flags.ts"
import { ensureFrontendAssets, serverOptionsFromFlags, shouldBuildFrontend } from "../server/bun-server.ts"

const repoRoot = resolve(import.meta.dirname, "..")
const originalPort = process.env.OPENCODE_UI_PORT
afterEach(() => {
  if (originalPort === undefined) delete process.env.OPENCODE_UI_PORT
  else process.env.OPENCODE_UI_PORT = originalPort
})

const failure = (args) => {
  try {
    parseCliFlags(args)
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(BunConfigurationError)
    return error
  }
}

describe("flag parsing", () => {
  test("parses both value forms and repeatable lists", () => {
    const flags = parseCliFlags([
      "--host=0.0.0.0",
      "--port", "1234",
      "--engine-url=http://engine.test:8090",
      "--service-file", "/tmp/service.json",
      "--allowed-host", "local.test",
      "--allowed-host=other.test",
      "--allowed-origin", "http://local.test:1234",
      "--allowed-origin=http://other.test:1234",
      "--artifact-root", "/tmp/one",
      "--artifact-root=/tmp/two",
    ])
    expect(flags.help).toBe(false)
    expect(flags.version).toBe(false)
    expect(flags.host).toBe("0.0.0.0")
    expect(flags.port).toBe("1234")
    expect(flags.engineUrl).toBe("http://engine.test:8090")
    expect(flags.serviceFile).toBe("/tmp/service.json")
    expect(flags.allowedHosts).toEqual(["local.test", "other.test"])
    expect(flags.allowedOrigins).toEqual(["http://local.test:1234", "http://other.test:1234"])
    expect(flags.artifactRoots).toEqual(["/tmp/one", "/tmp/two"])
  })

  test("handles help and version switches", () => {
    expect(parseCliFlags(["-h"]).help).toBe(true)
    expect(parseCliFlags(["--help"]).help).toBe(true)
    expect(parseCliFlags(["-v"]).version).toBe(true)
    expect(failure(["--help", "--help"])?.message).toContain("Do not repeat")
    expect(failure(["--help", "--version"])?.message).toContain("Choose either")
  })

  test("rejects unknown flags, positionals, repeated scalars and missing values", () => {
    expect(failure(["--token", "secret"])?.message).toContain("Unknown option")
    expect(failure(["positional"])?.message).toContain("Unexpected positional argument")
    expect(failure(["--host", "a.test", "--host", "b.test"])?.message).toContain("Do not repeat --host")
    expect(failure(["--port"])?.message).toContain("--port requires a nonempty value")
    expect(failure(["--port", ""])?.message).toContain("--port requires a nonempty value")
    expect(failure(["--port="])?.message).toContain("--port requires a nonempty value")
    expect(failure(["--port", "-1"])?.message).toContain("--port requires a nonempty value")
  })

  test("help text documents the shared options", () => {
    expect(CLI_HELP).toContain("--engine-url")
    expect(CLI_HELP).toContain("--allowed-origin")
    expect(CLI_HELP).toContain("--version")
  })
})

describe("direct-server option mapping", () => {
  test("uses direct-server defaults without flags", () => {
    delete process.env.OPENCODE_UI_PORT
    const options = serverOptionsFromFlags(parseCliFlags([]))
    expect(options.port).toBe(5174)
    expect(options.hostname).toBeUndefined()
    expect(options.engineUrl).toBeUndefined()
    expect(options.artifactRoots).toBeUndefined()
    expect(options.security).toBeUndefined()
  })

  test("flags override the environment and pass explicit values through", () => {
    process.env.OPENCODE_UI_PORT = "6000"
    expect(serverOptionsFromFlags(parseCliFlags([])).port).toBe(6000)
    const options = serverOptionsFromFlags(parseCliFlags([
      "--host", "0.0.0.0", "--port", "1234",
      "--engine-url", "http://engine.test:8090",
      "--service-file", "/tmp/service.json",
      "--artifact-root", "/tmp/artifacts",
    ]))
    expect(options).toEqual({
      hostname: "0.0.0.0",
      port: 1234,
      engineUrl: "http://engine.test:8090",
      serviceFile: "/tmp/service.json",
      artifactRoots: ["/tmp/artifacts"],
    })
  })

  test("explicit allowlists replace env merging and keep loopback trust", () => {
    const options = serverOptionsFromFlags(parseCliFlags([
      "--allowed-host", "local.test",
      "--allowed-origin", "https://local.test",
    ]))
    expect(options.security).toEqual({
      allowedHosts: ["127.0.0.1", "localhost", "[::1]", "local.test"],
      allowedOrigins: ["http://127.0.0.1:5174", "http://localhost:5174", "http://[::1]:5174", "https://local.test"],
    })
  })
})

describe("production build trigger", () => {
  const trigger = (overrides) => shouldBuildFrontend({
    assetsPresent: false,
    buildScriptPresent: true,
    ...overrides,
  })

  test("only builds the default production assets when they are missing", () => {
    expect(trigger({})).toBe(true)
    expect(trigger({ assetDirectory: "/srv/assets" })).toBe(false)
    expect(trigger({ buildTarget: "dev" })).toBe(false)
    expect(trigger({ assetsPresent: true })).toBe(false)
    expect(trigger({ buildScriptPresent: false })).toBe(false)
  })

  test("runs the build only when the decision allows it", async () => {
    let builds = 0
    const runBuild = () => { builds++; return { exitCode: 0 } }
    const exists = (path) => path.endsWith("scripts/build-bun.ts")

    await ensureFrontendAssets({ directory: "/missing", repoRoot, exists, runBuild })
    expect(builds).toBe(1)

    await ensureFrontendAssets({ directory: "/missing", repoRoot, assetDirectory: "/srv/assets", exists, runBuild })
    await ensureFrontendAssets({ directory: "/missing", repoRoot, buildTarget: "dev", exists, runBuild })
    await ensureFrontendAssets({ directory: "/missing", repoRoot, exists: () => true, runBuild })
    await ensureFrontendAssets({ directory: "/missing", repoRoot, exists: () => false, runBuild })
    expect(builds).toBe(1)
  })

  test("reports the build output tail on failure", async () => {
    const output = `${"x".repeat(4100)}final build error`
    await expect(ensureFrontendAssets({
      directory: "/missing",
      repoRoot,
      exists: (path) => path.endsWith("scripts/build-bun.ts"),
      runBuild: () => ({ exitCode: 1, stdout: "", stderr: output }),
    })).rejects.toThrow(/Frontend build failed[\s\S]*final build error/)
  })
})

describe("direct-server entry", () => {
  test("prints help and version without reading credentials", () => {
    const help = Bun.spawnSync(["bun", "server/bun-server.ts", "--help"], { cwd: repoRoot })
    expect(help.exitCode).toBe(0)
    expect(help.stdout.toString()).toContain("Usage: bun run start")
    expect(help.stderr.toString()).toBe("")

    const version = Bun.spawnSync(["bun", "server/bun-server.ts", "--version"], { cwd: repoRoot })
    expect(version.exitCode).toBe(0)
    const expected = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version
    expect(version.stdout.toString().trim()).toBe(expected)

    const rejected = Bun.spawnSync(["bun", "server/bun-server.ts", "--not-a-flag"], { cwd: repoRoot })
    expect(rejected.exitCode).toBe(1)
    expect(rejected.stderr.toString()).toContain("Unknown option")
  })

  test("refactored CLI keeps its help and package defaults", () => {
    const help = Bun.spawnSync(["bun", "bin/opencode-ui.ts", "--help"], { cwd: repoRoot })
    expect(help.exitCode).toBe(0)
    expect(help.stdout.toString()).toContain("http://127.0.0.1:4096")
    expect(help.stdout.toString()).toContain("Usage: opencode-ui")
    const version = Bun.spawnSync(["bun", "bin/opencode-ui.ts", "--version"], { cwd: repoRoot })
    expect(version.exitCode).toBe(0)
    const expected = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version
    expect(version.stdout.toString().trim()).toBe(expected)
  })
})
