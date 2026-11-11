#!/usr/bin/env bun
import { homedir } from "node:os"
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { BunConfigurationError, isLoopbackHost, validateHostname, validateOrigin, validatePath, validatePort } from "../server/bun-config.ts"
import { CLI_HELP, parseCliFlags } from "../server/cli-flags.ts"

async function main() {
  const flags = parseCliFlags(process.argv.slice(2))
  if (flags.help) { console.log(CLI_HELP); return }
  if (flags.version) {
    const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
    console.log(metadata.version)
    return
  }

  const hostname = validateHostname(flags.host ?? process.env.OPENCODE_UI_HOST ?? "127.0.0.1")
  const port = validatePort(flags.port ?? process.env.OPENCODE_UI_PORT ?? "5174")
  const engineUrl = validateOrigin(flags.engineUrl ?? "http://127.0.0.1:4096")
  const serviceFile = resolve(validatePath(flags.serviceFile ?? resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "opencode/service.json")))
  const allowedHosts = ["127.0.0.1", "localhost", "[::1]", ...flags.allowedHosts.map(validateHostname)]
  const allowedOrigins = [
    `http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`,
    ...flags.allowedOrigins.map(validateOrigin),
  ]
  const flagRoots = flags.artifactRoots.length > 0 ? flags.artifactRoots : undefined
  const artifactRoots = (flagRoots ?? (process.env.OPENCODE_UI_ARTIFACT_ROOTS ?? "").split(",").map((value) => value.trim()).filter(Boolean)).map((value) => resolve(validatePath(value)))
  if (!isLoopbackHost(hostname) && (!allowedHosts.some((host) => !isLoopbackHost(host)) || !allowedOrigins.some((origin) => !isLoopbackHost(new URL(origin).hostname)))) {
    throw new BunConfigurationError("Non-loopback binding requires explicit non-loopback --allowed-host and --allowed-origin. Use --help for security requirements.")
  }
  if (new URL(engineUrl).protocol === "http:" && !isLoopbackHost(new URL(engineUrl).hostname)) {
    console.warn("Warning: remote HTTP engine transport is unencrypted. Use HTTPS or a trusted secure tunnel to protect credentials and private traffic.")
  }
  // Defer all service imports until after help/version and validation. Assets are
  // package-relative, independent of cwd and OPENCODE_UI_BUILD_TARGET.
  const { startBunServer } = await import("../server/bun-server.ts")
  await startBunServer({ hostname, port, engineUrl, serviceFile, artifactRoots,
    assetDirectory: resolve(import.meta.dirname, "../dist-bun-build"),
    security: { allowedHosts, allowedOrigins },
  })
  console.log(`OpenCode UI listening on port ${port}. Set a UI password in Settings → Access; non-loopback binds require one.`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof BunConfigurationError ? error.message : "Could not start OpenCode UI. Check the package installation, separate OpenCode engine, and service credential setup.")
  process.exitCode = 1
})
