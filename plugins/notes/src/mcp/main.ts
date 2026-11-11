#!/usr/bin/env bun
import { startNotesMcpServer } from "./server.js"

const created = await startNotesMcpServer({ defaultDirectory: process.cwd() })

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
