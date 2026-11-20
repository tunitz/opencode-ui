import { BunConfigurationError } from "./bun-config.ts"

export const CLI_HELP = `Usage: opencode-ui [options]

Production UI for a separately installed, running OpenCode V2 engine
(compatible with @opencode/client 2.1.4). Requires Bun 1.4.4.

  --host <host>              Bind hostname/IP (OPENCODE_UI_HOST or 127.0.0.1)
  --port <port>              UI port 1–65535 (OPENCODE_UI_PORT or 5174)
  --engine-url <origin>      Prefill the first connection's engine URL
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

Set an OpenCode UI password on first visit. It protects the API on every bind.
Allowlists are not authentication or tenant isolation;
remote use still requires secure transport.
Unprotected remote HTTP engines expose credentials and private traffic.
Configure connections in the browser, never pass credentials as flags. This CLI never installs,
starts, or changes the engine. Artifact roots do not bypass provenance checks.
`

export const scalarFlagNames = new Set(["host", "port", "engine-url"])
export const listFlagNames = new Set(["allowed-host", "allowed-origin", "artifact-root"])

export type CliFlags = {
  help: boolean
  version: boolean
  host?: string
  port?: string
  engineUrl?: string
  allowedHosts: string[]
  allowedOrigins: string[]
  artifactRoots: string[]
}

/**
 * Parse long-option flags shared by the CLI and the direct server entry.
 * Long options accept --name=value or --name value; list options repeat.
 */
export function parseCliFlags(args: readonly string[]): CliFlags {
  const values = new Map<string, string[]>()
  const switches = new Set<string>()
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
    if (!scalarFlagNames.has(name) && !listFlagNames.has(name)) {
      throw new BunConfigurationError("Unknown option. Use --help for supported options; credential flags are not supported.")
    }
    if (scalarFlagNames.has(name) && values.has(name)) throw new BunConfigurationError(`Do not repeat --${name}.`)
    const value = equals === -1 ? args[++index] : token.slice(equals + 1)
    if (!value || !value.trim() || (equals === -1 && value.startsWith("-"))) {
      throw new BunConfigurationError(`--${name} requires a nonempty value.`)
    }
    values.set(name, [...(values.get(name) ?? []), value])
  }
  if (switches.size > 1) throw new BunConfigurationError("Choose either --help or --version, not both.")
  return {
    help: switches.has("--help"),
    version: switches.has("--version"),
    host: values.get("host")?.[0],
    port: values.get("port")?.[0],
    engineUrl: values.get("engine-url")?.[0],
    allowedHosts: values.get("allowed-host") ?? [],
    allowedOrigins: values.get("allowed-origin") ?? [],
    artifactRoots: values.get("artifact-root") ?? [],
  }
}
