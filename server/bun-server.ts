import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { createAgentConfigService } from "./agent-config.ts"
import { createArtifactDelivery } from "./artifact-delivery.ts"
import { createNotificationService } from "./notifications.ts"
import { createBunApplication } from "./bun-application.ts"
import type { PtyBridgeServer } from "./pty-websocket-bridge.ts"
import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ALLOWED_ORIGINS } from "./request-security.ts"

// Kept separate from the build so importing build tooling never reads credentials
// or starts the notification watcher. This entry point is experimental.
export async function startBunServer() {
  const registration = JSON.parse(await readFile(join(homedir(), ".config", "opencode", "service.json"), "utf8")) as { password?: unknown }
  if (typeof registration.password !== "string" || !registration.password) throw new Error("OpenCode service credential unavailable")
  const authorization = `Basic ${Buffer.from(`opencode:${registration.password}`).toString("base64")}`
  const target = "http://127.0.0.1:8090"
  const directory = resolve(import.meta.dirname, process.env.OPENCODE_UI_BUILD_TARGET === "dev" ? "../dist-bun-dev" : "../dist-bun")
  if (!(await stat(directory)).isDirectory()) throw new Error("Bun frontend build is unavailable")
  const roots = (process.env.OPENCODE_UI_ARTIFACT_ROOTS ?? "/tmp/opencode/shots").split(",").map((value) => value.trim()).filter(Boolean)
  const agents = createAgentConfigService({ opencodeBaseUrl: target, authorization })
  const artifacts = createArtifactDelivery({ opencodeBaseUrl: target, authorization, roots })
  const notifications = createNotificationService({ opencodeBaseUrl: target, authorization })
  const port = Number(process.env.OPENCODE_UI_PORT ?? "5174")
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid UI port")
  const developmentOrigin = process.env.OPENCODE_UI_DEV_ORIGIN
  // The development script binds to loopback and adds only its exact origin.
  if (developmentOrigin && developmentOrigin !== `http://127.0.0.1:${port}`) throw new Error("Invalid development origin")
  const application = createBunApplication({
    target, authorization, directory, agents, artifacts, notifications,
    security: { allowedHosts: DEFAULT_ALLOWED_HOSTS, allowedOrigins: developmentOrigin ? [...DEFAULT_ALLOWED_ORIGINS, developmentOrigin] : DEFAULT_ALLOWED_ORIGINS },
  })
  const bun = (globalThis as unknown as { Bun: { serve: (options: {
    hostname: string; port: number; fetch: typeof application.fetch; websocket: typeof application.websocket
  }) => PtyBridgeServer & { timeout: (request: Request, seconds: number) => void; stop: (force?: boolean) => Promise<void> } } }).Bun
  const server = bun.serve({ hostname: process.env.OPENCODE_UI_HOST ?? "127.0.0.1", port, fetch: application.fetch, websocket: application.websocket })
  void notifications.start().catch(() => console.warn("OpenCode UI notifications unavailable."))
  const stop = () => { notifications.stop(); application.dispose(); void server.stop(true) }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  return server
}

if (import.meta.main) {
  void startBunServer().catch(() => {
    console.error("Could not start OpenCode UI Bun server.")
    process.exitCode = 1
  })
}
