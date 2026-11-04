import type { Plugin } from "@opencode/plugin"
import { setupNotesServer } from "./server.js"

const plugin = {
  id: "opencode-notes",
  setup: setupNotesServer,
} satisfies Plugin.Plugin

export default plugin
