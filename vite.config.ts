import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin, type ProxyOptions } from "vite"
import {
  createSecurityMiddleware,
  createUpgradeGuard,
  stripUpstreamCorsHeaders,
} from "./server/request-security.ts"
import {
  createArtifactDelivery,
  createArtifactMiddleware,
} from "./server/artifact-delivery.ts"
import {
  createNotificationMiddleware,
  createNotificationService,
} from "./server/notifications.ts"
import {
  createAgentConfigMiddleware,
  createAgentConfigService,
} from "./server/agent-config.ts"

// Real-data preview: bind only the tailnet interface. Vite's CLI --host overrides this,
// so the systemd unit must pass the same IP.
const tailscaleHost = "100.67.153.70"

// Tailscale access: exact names only; IP literals are always allowed by Vite.
const tailscaleAllowedHosts = [
  "tun-pc",
  "tun-minipc",
  "tun-minipc.great-vernier.ts.net",
  ".great-vernier.ts.net",
]

const opencodeTarget = "http://127.0.0.1:8090"

// Local dev/preview only: hold the OpenCode Basic credential server-side.
// This is not the production gateway (no TLS, browser cookie, CSRF, or route
// allowlist). Never expose this value to client code, logs, or the bundle.
function readOpenCodeAuthorization(): string | undefined {
  try {
    const registration = JSON.parse(
      readFileSync(
        join(homedir(), ".config", "opencode", "service.json"),
        "utf8"
      )
    ) as { password?: unknown }

    if (
      typeof registration.password !== "string" ||
      registration.password.length === 0
    ) {
      return undefined
    }

    return `Basic ${Buffer.from(`opencode:${registration.password}`).toString(
      "base64"
    )}`
  } catch {
    return undefined
  }
}

const authorization = readOpenCodeAuthorization()

if (!authorization) {
  console.warn(
    "OpenCode dev proxy: service credential unavailable; /api requests will return 401."
  )
}

// Override any browser-supplied Authorization header with the held credential
// and never forward it from the client.
function authenticatedProxy(): ProxyOptions {
  return {
    target: opencodeTarget,
    changeOrigin: false,
    ws: true,
    configure(proxy) {
      const authorize = (proxyRequest: { removeHeader: (name: string) => void; setHeader: (name: string, value: string) => void }) => {
        proxyRequest.removeHeader("authorization")
        if (authorization) {
          proxyRequest.setHeader("authorization", authorization)
        }
      }
      proxy.on("proxyReq", authorize)
      proxy.on("proxyReqWs", authorize)
      proxy.on("proxyRes", (proxyResponse) => {
        stripUpstreamCorsHeaders(proxyResponse.headers)
        const contentType = proxyResponse.headers["content-type"]
        proxyResponse.headers["cache-control"] =
          typeof contentType === "string" && contentType.includes("text/event-stream")
            ? "no-cache, no-transform"
            : "no-store"
        const vary = proxyResponse.headers.vary
        if (typeof vary === "string" && vary.trim()) {
          if (!vary.toLowerCase().split(",").map((part) => part.trim()).includes("origin")) {
            proxyResponse.headers.vary = `${vary}, Origin`
          }
        } else {
          proxyResponse.headers.vary = "Origin"
        }
      })
    },
  }
}

function securityPlugin(): Plugin {
  const install = (server: {
    middlewares: { use: (middleware: ReturnType<typeof createSecurityMiddleware>) => void }
    httpServer: { prependListener: (event: string, listener: (request: import("node:http").IncomingMessage, socket: import("node:net").Socket) => void) => void } | null
  }) => {
    server.middlewares.use(createSecurityMiddleware())
    const guard = createUpgradeGuard()
    server.httpServer?.prependListener("upgrade", (request, socket) => {
      guard(request, socket)
    })
  }
  return {
    name: "opencode-ui-request-security",
    configureServer(server) {
      install(server)
    },
    configurePreviewServer(server) {
      install(server)
    },
  }
}

const artifactRoots = (process.env.OPENCODE_UI_ARTIFACT_ROOTS ?? "/tmp/opencode/shots")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const artifactDelivery = createArtifactDelivery({
  roots: artifactRoots,
  opencodeBaseUrl: opencodeTarget,
  authorization,
})

function artifactPlugin(): Plugin {
  const install = (server: {
    middlewares: { use: (middleware: ReturnType<typeof createArtifactMiddleware>) => void }
  }) => {
    server.middlewares.use(createArtifactMiddleware(artifactDelivery))
  }
  return {
    name: "opencode-ui-artifact-delivery",
    configureServer(server) {
      install(server)
    },
    configurePreviewServer(server) {
      install(server)
    },
  }
}

const agentConfigService = createAgentConfigService({
  opencodeBaseUrl: opencodeTarget,
  authorization,
})

function agentConfigPlugin(): Plugin {
  const install = (server: {
    middlewares: {
      use: (middleware: ReturnType<typeof createAgentConfigMiddleware>) => void
    }
  }) => {
    server.middlewares.use(createAgentConfigMiddleware(agentConfigService))
  }
  return {
    name: "opencode-ui-agent-config",
    configureServer(server) {
      install(server)
    },
    configurePreviewServer(server) {
      install(server)
    },
  }
}

const notificationService = createNotificationService({
  opencodeBaseUrl: opencodeTarget,
  authorization,
})
let notificationStarted = false
function startNotifications() {
  if (notificationStarted) return
  notificationStarted = true
  void notificationService.start().catch((error: unknown) => {
    console.warn(
      "OpenCode UI notifications unavailable:",
      error instanceof Error ? error.message : "unknown error"
    )
  })
}

function notificationPlugin(): Plugin {
  const install = (server: {
    middlewares: { use: (middleware: ReturnType<typeof createNotificationMiddleware>) => void }
    httpServer: { once: (event: string, listener: () => void) => void } | null
  }) => {
    server.middlewares.use(createNotificationMiddleware(notificationService))
    startNotifications()
    server.httpServer?.once("close", () => notificationService.stop())
  }
  return {
    name: "opencode-ui-notifications",
    configureServer(server) {
      install(server)
    },
    configurePreviewServer(server) {
      install(server)
    },
  }
}

const proxy = {
  "/api": authenticatedProxy(),
  "/openapi.json": authenticatedProxy(),
} satisfies Record<string, ProxyOptions>

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    securityPlugin(),
    // Must run before the broad /api/ui artifact middleware so the agent
    // route is not consumed as an unknown artifact request.
    agentConfigPlugin(),
    notificationPlugin(),
    artifactPlugin(),
  ],
  server: {
    host: tailscaleHost,
    port: 5174,
    strictPort: true,
    allowedHosts: tailscaleAllowedHosts,
    proxy,
  },
  preview: {
    host: tailscaleHost,
    port: 5174,
    strictPort: true,
    allowedHosts: tailscaleAllowedHosts,
    proxy,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
