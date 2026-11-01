import type { CommandInfo, SessionMessageInfo } from "@/lib/opencode"

export type NativeCommandAction =
  | "help"
  | "sessions"
  | "new"
  | "open"
  | "models"
  | "agents"
  | "thinking"
  | "settings"
  | "themes"
  | "diff"
  | "copy"
  | "rename"
  | "timeline"
  | "export"
  | "fork"
  | "compact"
  | "undo"
  | "redo"
  | "cd"
  | "clear"
  | "editor"
  | "skills"
  | "mcps"
  | "connect"
  | "worktrees"
  | "plugins"
  | "stats"
  | "reload"
  | "debug"
  | "btw"
  | "status"
  | "unsupported"

export type NativeSlashCommand = {
  name: string
  aliases: string[]
  title: string
  description: string
  category: string
  arguments: "none" | "optional" | "required"
  action: NativeCommandAction
  status: "supported" | "partial" | "unsupported"
  reason?: string
  destructive?: boolean
  modelTriggering?: boolean
}

/**
 * Verified from the archived OpenCode v2.1.4 TUI source
 * (packages/tui/src app.tsx / component/prompt / routes/session / feature-plugins).
 * This is the client-local slash inventory; it is not returned by /api/command.
 */
export const NATIVE_SLASH_COMMANDS: NativeSlashCommand[] = [
  {
    name: "help",
    aliases: [],
    title: "Help",
    description: "Show slash-command help and search.",
    category: "System",
    arguments: "none",
    action: "help",
    status: "supported",
  },
  {
    name: "sessions",
    aliases: ["resume", "continue"],
    title: "Switch session",
    description: "Open the session/project picker.",
    category: "Session",
    arguments: "none",
    action: "sessions",
    status: "supported",
  },
  {
    name: "new",
    aliases: [],
    title: "New session",
    description: "Open the New session dialog.",
    category: "Session",
    arguments: "none",
    action: "new",
    status: "supported",
  },
  {
    name: "clear",
    aliases: [],
    title: "Clear session view",
    description: "Return to the empty view without deleting or stopping the session.",
    category: "Session",
    arguments: "none",
    action: "clear",
    status: "supported",
  },
  {
    name: "open",
    aliases: ["projects", "project"],
    title: "Open session or project",
    description: "Open the project/session navigator.",
    category: "Session",
    arguments: "none",
    action: "open",
    status: "supported",
  },
  {
    name: "models",
    aliases: [],
    title: "Switch model",
    description: "Open the current session's model settings.",
    category: "Agent",
    arguments: "none",
    action: "models",
    status: "supported",
  },
  {
    name: "agents",
    aliases: [],
    title: "Switch agent",
    description: "Open the current session's Agent setting.",
    category: "Agent",
    arguments: "none",
    action: "agents",
    status: "supported",
  },
  {
    name: "variants",
    aliases: ["thinking", "effort"],
    title: "Switch Thinking Level",
    description: "Open the current session's Thinking Level setting.",
    category: "Agent",
    arguments: "none",
    action: "thinking",
    status: "supported",
  },
  {
    name: "mcps",
    aliases: [],
    title: "MCP servers",
    description: "Inspect MCP status and resources; no connect, disconnect, add, or remove actions.",
    category: "Integration",
    arguments: "none",
    action: "mcps",
    status: "supported",
  },
  {
    name: "connect",
    aliases: [],
    title: "Connect an integration",
    description: "Inspect provider/integration methods and connection status.",
    category: "Integration",
    arguments: "none",
    action: "connect",
    status: "partial",
    reason:
      "Key and OAuth provider connections use the native integration API on canonical HTTPS. External-credential and command-based auth methods remain unavailable in the browser-safe flow.",
  },
  {
    name: "settings",
    aliases: [],
    title: "Open settings",
    description: "Open browser-local Web UI Preferences.",
    category: "System",
    arguments: "none",
    action: "settings",
    status: "supported",
  },
  {
    name: "status",
    aliases: [],
    title: "View status",
    description: "Show connection, project, session, and model status.",
    category: "System",
    arguments: "none",
    action: "status",
    status: "supported",
  },
  {
    name: "themes",
    aliases: [],
    title: "Switch theme",
    description: "Open the Light/Dark/System theme picker.",
    category: "System",
    arguments: "none",
    action: "themes",
    status: "supported",
  },
  {
    name: "diff",
    aliases: [],
    title: "Open diff viewer",
    description: "Open the current session's working tree.",
    category: "Session",
    arguments: "none",
    action: "diff",
    status: "supported",
  },
  {
    name: "copy",
    aliases: [],
    title: "Copy last assistant message",
    description: "Copy the latest assistant text to the clipboard.",
    category: "Session",
    arguments: "none",
    action: "copy",
    status: "supported",
  },
  {
    name: "rename",
    aliases: [],
    title: "Rename session",
    description: "Rename the current session, or open the rename dialog.",
    category: "Session",
    arguments: "optional",
    action: "rename",
    status: "supported",
  },
  {
    name: "timeline",
    aliases: [],
    title: "Jump to message",
    description: "Search durable user messages and jump to one.",
    category: "Session",
    arguments: "none",
    action: "timeline",
    status: "supported",
  },
  {
    name: "fork",
    aliases: [],
    title: "Fork session",
    description: "Fork the session before a chosen user message.",
    category: "Session",
    arguments: "none",
    action: "fork",
    status: "supported",
  },
  {
    name: "compact",
    aliases: [],
    title: "Compact session",
    description: "Queue a native session compaction request.",
    category: "Session",
    arguments: "none",
    action: "compact",
    status: "supported",
    modelTriggering: true,
  },
  {
    name: "undo",
    aliases: [],
    title: "Undo previous message",
    description: "Stage a native revert before the latest user message.",
    category: "Session",
    arguments: "none",
    action: "undo",
    status: "supported",
    destructive: true,
  },
  {
    name: "redo",
    aliases: [],
    title: "Redo",
    description: "Clear the staged revert and restore its files and messages.",
    category: "Session",
    arguments: "none",
    action: "redo",
    status: "supported",
    destructive: true,
  },
  {
    name: "export",
    aliases: [],
    title: "Export session transcript",
    description: "Download the native JSON session transfer.",
    category: "Session",
    arguments: "none",
    action: "export",
    status: "supported",
  },
  {
    name: "btw",
    aliases: [],
    title: "Ask a side question",
    description: "One-shot answer from session context without adding it to the conversation.",
    category: "Session",
    arguments: "optional",
    action: "btw",
    status: "supported",
    modelTriggering: true,
  },
  {
    name: "cd",
    aliases: [],
    title: "Change working directory",
    description: "Move the session to an absolute existing directory.",
    category: "Session",
    arguments: "optional",
    action: "cd",
    status: "supported",
  },
  {
    name: "editor",
    aliases: [],
    title: "Open web draft editor",
    description: "Edit the current draft in a larger web dialog.",
    category: "Prompt",
    arguments: "none",
    action: "editor",
    status: "supported",
  },
  {
    name: "skills",
    aliases: [],
    title: "Skills",
    description: "Choose native skills for the next prompt.",
    category: "Prompt",
    arguments: "none",
    action: "skills",
    status: "supported",
  },
  {
    name: "worktrees",
    aliases: [],
    title: "Manage worktrees",
    description: "List, create, refresh, and remove native project worktrees.",
    category: "Project",
    arguments: "none",
    action: "worktrees",
    status: "supported",
  },
  {
    name: "terminal",
    aliases: [],
    title: "Open terminal",
    description: "The terminal is not available in this interface.",
    category: "Terminal",
    arguments: "none",
    action: "unsupported",
    status: "unsupported",
    reason: "The terminal is not available in this interface.",
  },
  {
    name: "plugins",
    aliases: [],
    title: "Plugins",
    description: "Inspect installed plugin metadata; no install, update, or remove actions.",
    category: "System",
    arguments: "none",
    action: "plugins",
    status: "supported",
  },
  {
    name: "stats",
    aliases: [],
    title: "Usage statistics",
    description: "View native token, session, tool, model, and reported cost stats.",
    category: "System",
    arguments: "none",
    action: "stats",
    status: "supported",
  },
  {
    name: "highlights",
    aliases: [],
    title: "Release highlights",
    description: "Show release highlights.",
    category: "System",
    arguments: "none",
    action: "unsupported",
    status: "unsupported",
    reason:
      "2.1.4 embeds release highlights only in the TUI release runtime; they are not exposed by the HTTP API. No current highlights were invented.",
  },
  {
    name: "update",
    aliases: [],
    title: "Update OpenCode",
    description: "Update the local OpenCode installation.",
    category: "System",
    arguments: "none",
    action: "unsupported",
    status: "unsupported",
    reason: "The web client cannot update the server installation.",
  },
  {
    name: "pair",
    aliases: ["web"],
    title: "Pair device",
    description: "Pair a browser/device with the server.",
    category: "System",
    arguments: "none",
    action: "unsupported",
    status: "unsupported",
    reason: "Pairing/auth is a server/gateway concern; no secrets are requested in the web UI.",
  },
  {
    name: "restart",
    aliases: [],
    title: "Restart service",
    description: "Restart the background OpenCode service.",
    category: "System",
    arguments: "none",
    action: "unsupported",
    status: "unsupported",
    destructive: true,
    reason: "The web client does not own or restart the server service.",
  },
  {
    name: "reload",
    aliases: [],
    title: "Reload configuration",
    description: "Reload every loaded OpenCode location and refresh catalogs.",
    category: "System",
    arguments: "none",
    action: "reload",
    status: "supported",
  },
  {
    name: "debug",
    aliases: [],
    title: "Client diagnostics",
    description: "Show sanitized client/network/state diagnostics.",
    category: "System",
    arguments: "none",
    action: "debug",
    status: "partial",
    reason:
      "Safe client-equivalent diagnostics only; no heap dump, environment, config, prompts, or full server-debug parity.",
  },
  {
    name: "exit",
    aliases: ["quit", "q"],
    title: "Exit the app",
    description: "Close the TUI application.",
    category: "System",
    arguments: "none",
    action: "unsupported",
    status: "unsupported",
    reason: "A browser tab cannot be reliably closed by the page.",
  },
]

export type SlashCommand = {
  id: string
  name: string
  aliases: string[]
  title: string
  description: string
  category: string
  arguments: "none" | "optional" | "required"
  source: "native" | "server"
  native?: NativeSlashCommand
  server?: CommandInfo
  status: "supported" | "partial" | "unsupported"
  reason?: string
}

export type SlashInput = {
  name: string
  argumentsText: string
}

/** Parse only a command at the very start; never evaluate shell syntax. */
export function parseSlashInput(text: string): SlashInput | null {
  const match = /^\/([^\s]+)(?:[ \t]+([\s\S]*))?$/.exec(text)
  if (!match) return null
  return { name: match[1], argumentsText: match[2] ?? "" }
}

/** Open the picker only while the first token is still being typed. */
export function slashQuery(text: string): string | null {
  if (!text.startsWith("/")) return null
  const rest = text.slice(1)
  if (/\s/.test(rest)) return null
  return rest
}

export function matchesSlashCommand(
  command: SlashCommand,
  query: string
): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [
    command.name,
    ...command.aliases,
    command.title,
    command.description,
  ].some((value) => value.toLowerCase().includes(normalized))
}

export function mergeSlashCommands(
  serverCommands: readonly CommandInfo[]
): SlashCommand[] {
  const native: SlashCommand[] = NATIVE_SLASH_COMMANDS.map((command) => ({
    id: `native:${command.name}`,
    name: command.name,
    aliases: command.aliases,
    title: command.title,
    description: command.description,
    category: command.category,
    arguments: command.arguments,
    source: "native",
    native: command,
    status: command.status,
    reason: command.reason,
  }))
  const nativeNames = new Set(
    native.flatMap((command) => [command.name, ...command.aliases])
  )
  const server = serverCommands.map<SlashCommand>((command) => ({
      id: `server:${command.name}`,
      name: command.name,
      aliases: [],
      title: command.description || `/${command.name}`,
      description:
        command.description ||
        "Native project/plugin command from GET /api/command.",
      category: nativeNames.has(command.name)
        ? "Project command (same name as native)"
        : "Project commands",
      arguments: "optional",
      source: "server",
      server: command,
      status: "supported",
    }))
  return [...native, ...server]
}

export function findSlashCommand(
  commands: readonly SlashCommand[],
  name: string
): SlashCommand | null {
  return (
    commands.find(
      (command) =>
        command.name === name || command.aliases.includes(name)
    ) ?? null
  )
}

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string
): SlashCommand[] {
  return commands
    .filter((command) => matchesSlashCommand(command, query))
    .toSorted((a, b) => {
      if (a.source !== b.source) return a.source === "native" ? -1 : 1
      return `${a.category}/${a.name}`.localeCompare(
        `${b.category}/${b.name}`
      )
    })
}

/** Text of the latest assistant response, for the native /copy command. */
export function latestAssistantText(
  messages: readonly SessionMessageInfo[]
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== "assistant") continue
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (text) return text
  }
  return null
}
