#!/usr/bin/env bun
import { startNotesMcpServer } from "./server.js"

// The UI server injects the active saved connection id when it registers this
// MCP server. It is an internal scope, never logged.
const scopeEnv = process.env.OPENCODE_UI_CONNECTION_SCOPE
const scope =
  typeof scopeEnv === "string" && scopeEnv.trim()
    ? { connectionId: scopeEnv.trim() }
    : undefined

const created = await startNotesMcpServer({
  defaultDirectory: process.cwd(),
  scope,
})

created.server.onclose = () => {
  process.exit(0)
}

let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  await created.server.close().catch(() => undefined)
  process.exit(0)
}

process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())
