import { readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createArtifactDelivery, DEFAULT_ARTIFACT_ROOTS } from "./artifact-delivery.ts"
import { createAuthService } from "./auth.ts"
import { createEngineConnectionsService } from "./engine-connections.ts"
import { createNotesApi } from "./notes-api.ts"
import { createPluginsApi, NOTES_PLUGIN_ID } from "./plugins-api.ts"
import { createSessionShortcutsService } from "./session-shortcuts.ts"
import { createNotificationService } from "./notifications.ts"
import { createBunApplication } from "./bun-application.ts"
import { parseCliFlags, type CliFlags } from "./cli-flags.ts"
import type { PtyBridgeServer } from "./pty-websocket-bridge.ts"
import { resolveTrustedOrigins } from "./trusted-origins.ts"
import { BunConfigurationError, isLoopbackHost, validateHostname, validateOrigin, validatePath, validatePort } from "./bun-config.ts"

const SERVER_HELP = `Usage: bun run start [options]

Direct server for the built OpenCode UI. Requires Bun 1.4.4 and a separately
installed, running OpenCode V2 engine (compatible with @opencode/client 2.1.4).

  --host <host>              Bind hostname/IP (OPENCODE_UI_HOST or 127.0.0.1)
  --port <port>              UI port 1–65535 (OPENCODE_UI_PORT or 5174)
  --engine-url <origin>      Prefill the first connection's engine URL
  --allowed-host <host>      Add exact trusted hostname/IP (repeatable)
  --allowed-origin <origin> Add exact trusted HTTP(S) origin (repeatable)
  --artifact-root <path>     Allow proven artifact files under this root (repeatable;
                            default /tmp/opencode/shots)
  --help, -h                Show help without reading credentials or building assets
  --version, -v             Show package version without starting services

Long options accept --name=value or --name value. When the production frontend
build is missing, scripts/build-bun.ts runs first unless OPENCODE_UI_BUILD_TARGET=dev.
A non-loopback bind automatically trusts this host's private LAN IPv4 addresses
and derives matching HTTP origins. Use --allowed-origin for a custom hostname or
HTTPS proxy; the trusted host is derived from the origin. Prerequisites: see
README.md → Prerequisites.
`

export interface BunServerOptions {
  hostname?: string
  port?: number
  engineUrl?: string
  assetDirectory?: string
  artifactRoots?: readonly string[]
  security?: { allowedHosts: readonly string[]; allowedOrigins: readonly string[] }
}

export type FrontendBuildResult = { exitCode: number | null; stdout?: string; stderr?: string }

/** Pure trigger for the one-time production build in the direct-server entry path. */
export function shouldBuildFrontend(input: {
  assetDirectory?: string
  buildTarget?: string
  assetsPresent: boolean
  buildScriptPresent: boolean
}): boolean {
  return input.assetDirectory === undefined &&
    input.buildTarget !== "dev" &&
    !input.assetsPresent &&
    input.buildScriptPresent
}

function runProductionBuild(repoRoot: string): FrontendBuildResult {
  type SpawnSyncResult = { exitCode: number | null; stdout?: { toString(): string }; stderr?: { toString(): string } }
  const spawnSync = (globalThis as unknown as {
    Bun: {
      spawnSync: (command: string[], options: {
        cwd: string
        stdio: ["inherit", "pipe", "pipe"]
        env: Record<string, string | undefined>
      }) => SpawnSyncResult
    }
  }).Bun.spawnSync
  const result = spawnSync(["bun", "scripts/build-bun.ts"], {
    cwd: repoRoot,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, OPENCODE_UI_BUILD_TARGET: "production" },
  })
  return { exitCode: result.exitCode, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() }
}

/**
 * Build the production frontend when the direct server has no packaged assets.
 * `exists` and `runBuild` are injectable so the decision and failure path stay testable.
 */
export async function ensureFrontendAssets(input: {
  directory: string
  repoRoot: string
  assetDirectory?: string
  buildTarget?: string
  exists?: (path: string) => boolean | Promise<boolean>
  runBuild?: () => FrontendBuildResult
}): Promise<void> {
  const exists = input.exists ?? (async (path: string) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  })
  if (!shouldBuildFrontend({
    assetDirectory: input.assetDirectory,
    buildTarget: input.buildTarget ?? process.env.OPENCODE_UI_BUILD_TARGET,
    assetsPresent: await exists(input.directory),
    buildScriptPresent: await exists(join(input.repoRoot, "scripts", "build-bun.ts")),
  })) return
  const result = (input.runBuild ?? (() => runProductionBuild(input.repoRoot)))()
  if (result.exitCode !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    const tail = output.length > 4000 ? `\n…${output.slice(-4000)}` : output ? `\n${output}` : ""
    throw new BunConfigurationError(`Frontend build failed. Run bun install and bun run build:bun, or set OPENCODE_UI_BUILD_TARGET=dev for the development build.${tail}`)
  }
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

/** Map shared CLI flags onto direct-server options; flags override the environment. */
export function serverOptionsFromFlags(flags: CliFlags): BunServerOptions {
  const options: BunServerOptions = {}
  const port = validatePort(flags.port ?? process.env.OPENCODE_UI_PORT ?? "5174")
  const hostname = flags.host ?? process.env.OPENCODE_UI_HOST
  if (flags.host !== undefined) options.hostname = flags.host
  options.port = port
  if (flags.engineUrl !== undefined) options.engineUrl = flags.engineUrl
  if (flags.artifactRoots.length > 0) options.artifactRoots = flags.artifactRoots

  const useEnv = flags.allowedHosts.length === 0 && flags.allowedOrigins.length === 0
  const allowedHosts = flags.allowedHosts.length > 0 ? flags.allowedHosts : useEnv ? envList("OPENCODE_UI_ALLOWED_HOSTS") : []
  const allowedOrigins = flags.allowedOrigins.length > 0 ? flags.allowedOrigins : useEnv ? envList("OPENCODE_UI_ALLOWED_ORIGINS") : []
  const nonLoopbackBind = hostname !== undefined && !isLoopbackHost(validateHostname(hostname))
  if (allowedHosts.length > 0 || allowedOrigins.length > 0 || nonLoopbackBind) {
    options.security = resolveTrustedOrigins({ hostname, port, allowedHosts, allowedOrigins })
  }
  return options
}

// Kept separate from the build so importing build tooling never reads credentials
// or starts the notification watcher.
export async function startBunServer(options: BunServerOptions = {}) {
  // Validate all explicit configuration before reading credentials or creating services.
  // No-argument direct invocation deliberately retains the deployment's legacy trust.
  const hostname = validateHostname(options.hostname ?? process.env.OPENCODE_UI_HOST ?? "127.0.0.1")
  const port = validatePort(options.port ?? process.env.OPENCODE_UI_PORT ?? "5174")
  const suggestedEngineUrl = options.engineUrl === undefined ? undefined : validateOrigin(options.engineUrl)
  const legacyRoots = process.env.OPENCODE_UI_ARTIFACT_ROOTS?.split(",").map((value) => value.trim()).filter(Boolean)
  const roots = (options.artifactRoots ?? legacyRoots ?? DEFAULT_ARTIFACT_ROOTS).map((value) => resolve(validatePath(value)))
  const developmentOrigin = options.security ? undefined : process.env.OPENCODE_UI_DEV_ORIGIN
  if (developmentOrigin) validateOrigin(developmentOrigin)
  const devExtraHosts = options.security ? [] : envList("OPENCODE_UI_ALLOWED_HOSTS")
  const devExtraOrigins = options.security ? [] : envList("OPENCODE_UI_ALLOWED_ORIGINS")
  const security = resolveTrustedOrigins({
    hostname,
    port,
    allowedHosts: options.security?.allowedHosts ?? devExtraHosts,
    allowedOrigins: options.security?.allowedOrigins ?? [
      ...devExtraOrigins,
      ...(developmentOrigin ? [developmentOrigin] : []),
    ],
  })
  if (!isLoopbackHost(hostname) &&
    (!security.allowedHosts.some((host) => !isLoopbackHost(host)) || !security.allowedOrigins.some((origin) => !isLoopbackHost(new URL(origin).hostname)))) {
    throw new BunConfigurationError("Non-loopback binding needs a trusted non-loopback host and origin. Add local private IPv4 addresses, or pass explicit non-loopback --allowed-host/--allowed-origin. The required UI password gate is a shared access boundary, not tenant isolation; use secure transport.")
  }
  const directory = options.assetDirectory ?? resolve(import.meta.dirname, process.env.OPENCODE_UI_BUILD_TARGET === "dev" ? "../dist-bun-dev" : "../dist-bun-build")
  if (options.assetDirectory) {
    try {
      if (!(await stat(directory)).isDirectory() || !(await stat(join(directory, "index.html"))).isFile()) throw new Error("Missing assets")
    } catch {
      throw new BunConfigurationError("Packaged frontend assets are unavailable. Reinstall OpenCode UI; release packages must include a production build.")
    }
  } else {
    await ensureFrontendAssets({ directory, repoRoot: resolve(import.meta.dirname, "..") })
    try {
      if (!(await stat(directory)).isDirectory()) throw new Error("Missing assets")
    } catch {
      throw new BunConfigurationError("Bun frontend build is unavailable; prepare the direct server's frontend assets with bun run build:bun.")
    }
  }
  const connections = createEngineConnectionsService({ suggestedEngineUrl })
  await connections.init()
  const activeEngine = () => connections.getActiveTarget()
  const upstream = () => {
    const current = activeEngine()
    return {
      opencodeBaseUrl: current?.engineUrl ?? "",
      authorization: current?.authorization,
      isRemote: current?.isRemote ?? false,
    }
  }
  const auth = createAuthService({
    required: true,
    cookieName: process.env.OPENCODE_UI_SESSION_COOKIE,
  })
  const artifacts = createArtifactDelivery({
    getTarget: upstream,
    roots,
  })
  const notifications = createNotificationService({
    ...upstream(),
  })
  const notes = createNotesApi({
    getConnectionId: () => connections.getActiveTarget()?.id ?? null,
  })
  const plugins = createPluginsApi({
    engineUrl: "",
    authorization: "",
    getTarget: () => activeEngine() ?? { engineUrl: "", authorization: "" },
    getConnectionId: () => activeEngine()?.id ?? null,
    repoRoot: resolve(import.meta.dirname, ".."),
  })
  const sessionShortcuts = createSessionShortcutsService()
  const application = createBunApplication({
    getTarget: () => {
      const current = activeEngine()
      return current ? { target: current.engineUrl, authorization: current.authorization } : null
    },
    directory,
    artifacts,
    notifications,
    auth,
    connections,
    notes,
    plugins,
    sessionShortcuts,
    security,
  })
  const unsubscribeConnections = connections.onChange((target) => {
    application.resetEngineConnections()
    notifications.reconfigure(upstream())
    // The Notes MCP entry carries the owning connection id in its env. Rewrite
    // it on every switch so agent tools see the same scope as the browser UI.
    // A no-op when Notes is not enabled or no connection is active.
    if (target?.id) void plugins.refreshScope(NOTES_PLUGIN_ID).catch(() => undefined)
  })
  const bun = (globalThis as unknown as { Bun: { serve: (options: {
    hostname: string; port: number; fetch: typeof application.fetch; websocket: typeof application.websocket
  }) => PtyBridgeServer & { timeout: (request: Request, seconds: number) => void; stop: (force?: boolean) => Promise<void> } } }).Bun
  let server: ReturnType<typeof bun.serve>
  try {
    server = bun.serve({ hostname: hostname.startsWith("[") ? hostname.slice(1, -1) : hostname, port, fetch: application.fetch, websocket: application.websocket })
  } catch {
    application.dispose()
    throw new BunConfigurationError("Cannot bind the UI listener. Check --host, choose an available --port, and verify local bind permissions.")
  }
  void notifications.start().catch(() => console.warn("OpenCode UI notifications unavailable."))
  const stop = () => { unsubscribeConnections(); notifications.stop(); application.dispose(); void server.stop(true) }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  return server
}

if (import.meta.main) {
  try {
    const flags = parseCliFlags(process.argv.slice(2))
    if (flags.help) {
      console.log(SERVER_HELP)
    } else if (flags.version) {
      const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
      console.log(metadata.version)
    } else {
      await startBunServer(serverOptionsFromFlags(flags))
    }
  } catch (error: unknown) {
    console.error(error instanceof BunConfigurationError ? error.message : "Could not start OpenCode UI Bun server.")
    process.exitCode = 1
  }
}
