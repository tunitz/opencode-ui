#!/usr/bin/env bun
import { homedir } from "node:os"
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { BunConfigurationError, isLoopbackHost, validateHostname, validateOrigin, validatePath, validatePort } from "../server/bun-config.ts"

const help = `Usage: opencode-ui [options]

Production UI for a separately installed, running OpenCode V2 engine
(compatible with @opencode/client 2.1.4). Requires Bun 1.4.4.

  --host <host>              Bind hostname/IP (OPENCODE_UI_HOST or 127.0.0.1)
  --port <port>              UI port 1–65535 (OPENCODE_UI_PORT or 5174)
  --engine-url <origin>      Engine HTTP(S) host and port (http://127.0.0.1:4096)
  --service-file <path>      Existing registration containing a password
                            ($XDG_CONFIG_HOME/opencode/service.json, else
                             ~/.config/opencode/service.json)
  --allowed-host <host>      Add exact trusted hostname/IP (repeatable)
  --allowed-origin <origin> Add exact trusted HTTP(S) origin (repeatable)
  --artifact-root <path>     Allow proven artifact files under this root (repeatable;
                            replaces OPENCODE_UI_ARTIFACT_ROOTS, otherwise empty)
  --help, -h                Show help without reading credentials or starting services
  --version, -v             Show package version without starting services

Long options accept --name=value or --name value. Relative paths use your cwd.
Trust defaults to 127.0.0.1, localhost and [::1], with exact HTTP origins at the
UI port. --host changes binding only, never trust. Non-loopback binding requires
explicit non-loopback --allowed-host AND --allowed-origin. Proxy public hosts
and origins must also be explicitly allowed, even with a loopback listener.

No browser login exists. Remote use requires an authenticated access boundary
and secure transport; allowlists are not authentication or tenant isolation.
Unprotected remote HTTP engines expose credentials and private traffic.
Credentials stay in the service file, never flags. This CLI never installs,
starts, or changes the engine. Artifact roots do not bypass provenance checks.
`

const scalarNames = new Set(["host", "port", "engine-url", "service-file"])
const listNames = new Set(["allowed-host", "allowed-origin", "artifact-root"])

async function main() {
  const values = new Map<string, string[]>()
  const switches = new Set<string>()
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    const alias = token === "-h" ? "--help" : token === "-v" ? "--version" : token
    if (alias === "--help" || alias === "--version") {
      if (switches.has(alias)) throw new BunConfigurationError("Do not repeat --help or --version.")
      switches.add(alias)
      continue
    }
    if (!token.startsWith("--")) throw new BunConfigurationError("Unexpected positional argument. Use --help for supported options.")
    const equals = token.indexOf("=")
    const name = token.slice(2, equals === -1 ? undefined : equals)
    if (!scalarNames.has(name) && !listNames.has(name)) throw new BunConfigurationError("Unknown option. Use --help for supported options; credential flags are not supported.")
    if (scalarNames.has(name) && values.has(name)) throw new BunConfigurationError(`Do not repeat --${name}.`)
    const value = equals === -1 ? args[++index] : token.slice(equals + 1)
    if (!value || !value.trim() || (equals === -1 && value.startsWith("-"))) throw new BunConfigurationError(`--${name} requires a nonempty value.`)
    values.set(name, [...(values.get(name) ?? []), value])
  }
  if (switches.size > 1) throw new BunConfigurationError("Choose either --help or --version, not both.")
  if (switches.has("--help")) { console.log(help); return }
  if (switches.has("--version")) {
    const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
    console.log(metadata.version)
    return
  }

  const scalar = (name: string) => values.get(name)?.[0]
  const hostname = validateHostname(scalar("host") ?? process.env.OPENCODE_UI_HOST ?? "127.0.0.1")
  const port = validatePort(scalar("port") ?? process.env.OPENCODE_UI_PORT ?? "5174")
  const engineUrl = validateOrigin(scalar("engine-url") ?? "http://127.0.0.1:4096")
  const serviceFile = resolve(validatePath(scalar("service-file") ?? resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "opencode/service.json")))
  const allowedHosts = ["127.0.0.1", "localhost", "[::1]", ...(values.get("allowed-host") ?? []).map(validateHostname)]
  const allowedOrigins = [
    `http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`,
    ...(values.get("allowed-origin") ?? []).map(validateOrigin),
  ]
  const artifactRoots = (values.get("artifact-root") ?? (process.env.OPENCODE_UI_ARTIFACT_ROOTS ?? "").split(",").map((value) => value.trim()).filter(Boolean)).map((value) => resolve(validatePath(value)))
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
  console.log(`OpenCode UI listening on port ${port}. No browser login; keep access protected.`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof BunConfigurationError ? error.message : "Could not start OpenCode UI. Check the package installation, separate OpenCode engine, and service credential setup.")
  process.exitCode = 1
})
