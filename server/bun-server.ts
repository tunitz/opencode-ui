import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { createAgentConfigService } from "./agent-config.ts"
import { createArtifactDelivery, DEFAULT_ARTIFACT_ROOTS } from "./artifact-delivery.ts"
import { createNotificationService } from "./notifications.ts"
import { createBunApplication } from "./bun-application.ts"
import type { PtyBridgeServer } from "./pty-websocket-bridge.ts"
import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ALLOWED_ORIGINS } from "./request-security.ts"
import { BunConfigurationError, isLoopbackHost, validateHostname, validateOrigin, validatePath, validatePort } from "./bun-config.ts"

// Kept separate from the build so importing build tooling never reads credentials
// or starts the notification watcher. This entry point is experimental.
export interface BunServerOptions {
  hostname?: string
  port?: number
  engineUrl?: string
  serviceFile?: string
  assetDirectory?: string
  artifactRoots?: readonly string[]
  security?: { allowedHosts: readonly string[]; allowedOrigins: readonly string[] }
}

export async function startBunServer(options: BunServerOptions = {}) {
  // Validate all explicit configuration before reading credentials or creating services.
  // No-argument direct invocation deliberately retains the deployment's legacy trust.
  const hostname = validateHostname(options.hostname ?? process.env.OPENCODE_UI_HOST ?? "127.0.0.1")
  const port = validatePort(options.port ?? process.env.OPENCODE_UI_PORT ?? "5174")
  const target = validateOrigin(options.engineUrl ?? "http://127.0.0.1:8090")
  const serviceFile = resolve(validatePath(options.serviceFile ?? join(homedir(), ".config", "opencode", "service.json")))
  const legacyRoots = process.env.OPENCODE_UI_ARTIFACT_ROOTS?.split(",").map((value) => value.trim()).filter(Boolean)
  const roots = (options.artifactRoots ?? legacyRoots ?? DEFAULT_ARTIFACT_ROOTS).map((value) => resolve(validatePath(value)))
  const developmentOrigin = options.security ? undefined : process.env.OPENCODE_UI_DEV_ORIGIN
  if (developmentOrigin && developmentOrigin !== `http://127.0.0.1:${port}`) throw new BunConfigurationError("Invalid development origin; use the existing Bun development script.")
  const security = options.security ? {
    allowedHosts: options.security.allowedHosts.map(validateHostname),
    allowedOrigins: options.security.allowedOrigins.map(validateOrigin),
  } : {
    allowedHosts: DEFAULT_ALLOWED_HOSTS,
    allowedOrigins: developmentOrigin ? [...DEFAULT_ALLOWED_ORIGINS, developmentOrigin] : DEFAULT_ALLOWED_ORIGINS,
  }
  if (options.security && !isLoopbackHost(hostname) &&
    (!security.allowedHosts.some((host) => !isLoopbackHost(host)) || !security.allowedOrigins.some((origin) => !isLoopbackHost(new URL(origin).hostname)))) {
    throw new BunConfigurationError("Non-loopback binding requires explicit non-loopback --allowed-host and --allowed-origin. Provide an authenticated access boundary and secure transport; there is no browser login.")
  }
  const directory = options.assetDirectory ?? resolve(import.meta.dirname, process.env.OPENCODE_UI_BUILD_TARGET === "dev" ? "../dist-bun-dev" : "../dist-bun")
  if (options.assetDirectory) {
    try {
      if (!(await stat(directory)).isDirectory() || !(await stat(join(directory, "index.html"))).isFile()) throw new Error("Missing assets")
    } catch {
      throw new BunConfigurationError("Packaged frontend assets are unavailable. Reinstall OpenCode UI; release packages must include a production build.")
    }
  } else if (!(await stat(directory)).isDirectory()) {
    throw new BunConfigurationError("Bun frontend build is unavailable; prepare the direct server's frontend assets.")
  }
  let contents: string
  try {
    contents = await readFile(serviceFile, "utf8")
  } catch {
    throw new BunConfigurationError("Cannot read the OpenCode service registration. Ensure the separate OpenCode V2 engine is installed/running and the service file is readable; use --service-file to select an existing registration.")
  }
  let password: string
  try {
    const registration: unknown = JSON.parse(contents)
    if (!registration || typeof registration !== "object" || !("password" in registration) || typeof registration.password !== "string" || !registration.password.trim()) throw new Error()
    password = registration.password
  } catch {
    throw new BunConfigurationError("Invalid OpenCode service registration: expected a JSON object with a nonempty password. Select a valid existing registration with --service-file; never pass credentials on the command line.")
  }
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const agents = createAgentConfigService({ opencodeBaseUrl: target, authorization })
  const artifacts = createArtifactDelivery({ opencodeBaseUrl: target, authorization, roots })
  const notifications = createNotificationService({ opencodeBaseUrl: target, authorization })
  const application = createBunApplication({
    target, authorization, directory, agents, artifacts, notifications,
    security,
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
  const stop = () => { notifications.stop(); application.dispose(); void server.stop(true) }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  return server
}

if (import.meta.main) {
  void startBunServer().catch((error: unknown) => {
    console.error(error instanceof BunConfigurationError ? error.message : "Could not start OpenCode UI Bun server.")
    process.exitCode = 1
  })
}
