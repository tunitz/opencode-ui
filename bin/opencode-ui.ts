#!/usr/bin/env bun
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { BunConfigurationError, isLoopbackHost, validateHostname, validateOrigin, validatePath, validatePort } from "../server/bun-config.ts"
import { CLI_HELP, parseCliFlags } from "../server/cli-flags.ts"
import { resolveTrustedOrigins } from "../server/trusted-origins.ts"

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
  const engineUrl = flags.engineUrl === undefined ? undefined : validateOrigin(flags.engineUrl)
  const { allowedHosts, allowedOrigins } = resolveTrustedOrigins({
    hostname,
    port,
    allowedHosts: flags.allowedHosts,
    allowedOrigins: flags.allowedOrigins,
  })
  const flagRoots = flags.artifactRoots.length > 0 ? flags.artifactRoots : undefined
  const artifactRoots = (flagRoots ?? (process.env.OPENCODE_UI_ARTIFACT_ROOTS ?? "").split(",").map((value) => value.trim()).filter(Boolean)).map((value) => resolve(validatePath(value)))
  if (!isLoopbackHost(hostname) && (!allowedHosts.some((host) => !isLoopbackHost(host)) || !allowedOrigins.some((origin) => !isLoopbackHost(new URL(origin).hostname)))) {
    throw new BunConfigurationError("Non-loopback binding needs a trusted non-loopback host and origin. Add local private IPv4 addresses, or pass explicit non-loopback --allowed-host/--allowed-origin. Use --help for security requirements.")
  }
  // Defer all service imports until after help/version and validation. Assets are
  // package-relative, independent of cwd and OPENCODE_UI_BUILD_TARGET.
  const { startBunServer } = await import("../server/bun-server.ts")
  await startBunServer({ hostname, port, engineUrl, artifactRoots,
    assetDirectory: resolve(import.meta.dirname, "../dist-bun-build"),
    security: { allowedHosts, allowedOrigins },
  })
  console.log(`OpenCode UI listening on port ${port}. Set a UI password on first visit. Change it later in Settings → Access.`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof BunConfigurationError ? error.message : "Could not start OpenCode UI. Check the package installation and listener settings.")
  process.exitCode = 1
})
