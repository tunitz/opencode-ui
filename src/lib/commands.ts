import type { CommandInfo } from "@/lib/opencode"

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
  | "terminal"
  | "plugins"
  | "pair"
  | "highlights"
  | "usage"
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
    description: "Manage MCP status, resources, servers, and connections.",
    category: "Integration",
    arguments: "none",
    action: "mcps",
    status: "supported",
  },
  {
    name: "connect",
    aliases: [],
    title: "Connect an integration",
    description: "Connect a provider using key, OAuth, external, or command methods.",
    category: "Integration",
    arguments: "none",
    action: "connect",
    status: "supported",
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
    description: "Show native server, connection, project, session, and model status.",
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
    description: "Open the larger web draft editor.",
    category: "Prompt",
    arguments: "none",
    action: "editor",
    status: "unsupported",
    reason: "Out of scope for browser slash-command parity; launching a local OS editor is not possible in a browser.",
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
    description: "Open a browser shell backed by the native PTY API.",
    category: "Terminal",
    arguments: "none",
    action: "terminal",
    status: "supported",
  },
  {
    name: "plugins",
    aliases: [],
    title: "Plugins",
    description: "Inspect, check, and update installed plugins.",
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
    name: "usage",
    aliases: [],
    title: "View usage limits",
    description: "Show native usage limits when the engine exposes them.",
    category: "System",
    arguments: "none",
    action: "usage",
    status: "supported",
  },
  {
    name: "highlights",
    aliases: [],
    title: "Release highlights",
    description: "Show real release highlights for the running OpenCode version.",
    category: "System",
    arguments: "none",
    action: "highlights",
    status: "supported",
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
    description: "Issue a native pairing code for another device.",
    category: "System",
    arguments: "none",
    action: "pair",
    status: "supported",
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
    description: "Show sanitized client and native server diagnostics.",
    category: "System",
    arguments: "none",
    action: "debug",
    status: "supported",
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
  /**
   * Catalog epoch stamped onto server-sourced entries at merge time. Native
   * entries keep 0: they never execute through the server catalog, so the
   * composer's freshness guard ignores them.
   */
  catalogEpoch: number
  native?: NativeSlashCommand
  server?: CommandInfo
  status: "supported" | "partial" | "unsupported"
  reason?: string
}

export type SlashInput = {
  name: string
  argumentsText: string
}

/**
 * Parse only a command at the very start; never evaluate shell syntax.
 *
 * Mirrors the native OpenCode TUI v2.1.4 `parseSlashHead`: the separator is the
 * first space, tab, or newline, and the arguments are the exact text after that
 * single separator character. Repeated spaces and CRLF bytes are preserved.
 */
export function parseSlashInput(text: string): SlashInput | null {
  if (!text.startsWith("/")) return null
  const rest = text.slice(1)
  const end = rest.search(/[ \t\n]/)
  if (end === -1) return { name: rest, argumentsText: "" }
  return { name: rest.slice(0, end), argumentsText: rest.slice(end + 1) }
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
  serverCommands: readonly CommandInfo[],
  catalogEpoch = 0
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
    catalogEpoch: 0,
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
      catalogEpoch,
      server: command,
      status: "supported",
    }))
  return [...native, ...server]
}

/**
 * Pure freshness guard for a server/catalog command. The composer captures the
 * epoch from the selected command when it is activated and re-checks it here
 * immediately before the POST so a catalog change between selection and submit
 * can never execute against a stale (or failed) catalog. Native built-ins never
 * reach this guard.
 */
export function isStaleServerCommand(input: {
  commandsStatus: string
  commandsDirectory: string | null
  catalogEpoch: number
  commands: readonly { name: string }[]
  commandName: string
  capturedEpoch: number
  directory: string | null
}): boolean {
  return (
    input.commandsStatus !== "ready" ||
    input.commandsDirectory !== input.directory ||
    input.capturedEpoch !== input.catalogEpoch ||
    !input.commands.some((command) => command.name === input.commandName)
  )
}

/**
 * Pure submit decision for the composer. No React or DOM access: the composer
 * passes in its composing/touch/picker state so keyboard and button submits can
 * share one testable policy.
 *
 * A leading slash with no parsed name (for example `/   `) is a picker error,
 * never a literal prompt — the native TUI would not send it as a command either.
 */
export type SlashSubmitInput = {
  draft: string
  isComposing: boolean
  isTouch: boolean
  /** The slash picker is active for this draft. */
  pickerOpen: boolean
  /** Only keyboard Enter is suppressed on touch; the Send button still submits. */
  viaKeyboardEnter?: boolean
  /** Modified Enter or an unsendable draft must not submit. */
  submitAllowed?: boolean
}

export type SlashSubmitDecision =
  | { kind: "composing" }
  | { kind: "ignore" }
  | { kind: "command" }
  | { kind: "literal-prompt" }
  | { kind: "picker-error"; message: string }

export function resolveSlashSubmit(input: SlashSubmitInput): SlashSubmitDecision {
  if (input.isComposing) return { kind: "composing" }
  if (input.viaKeyboardEnter && input.isTouch) return { kind: "ignore" }
  if (input.submitAllowed === false) return { kind: "ignore" }

  const parsed = parseSlashInput(input.draft)
  if (parsed) {
    if (!parsed.name.trim()) {
      return {
        kind: "picker-error",
        message: "Type a command name or clear the leading slash.",
      }
    }
    return { kind: "command" }
  }
  if (input.pickerOpen) {
    return {
      kind: "picker-error",
      message: "Choose a command or continue typing.",
    }
  }
  return { kind: "literal-prompt" }
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

/**
 * Rank a command for a query: 0 for an exact name or alias match, 1 for a
 * title/description match, 2 for any other match. Lower ranks sort first.
 */
export function rankSlashCommand(command: SlashCommand, query: string): number {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return 2
  if (
    command.name.toLowerCase() === normalized ||
    command.aliases.some((alias) => alias.toLowerCase() === normalized)
  ) {
    return 0
  }
  if (
    command.title.toLowerCase().includes(normalized) ||
    command.description.toLowerCase().includes(normalized)
  ) {
    return 1
  }
  return 2
}

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string
): SlashCommand[] {
  return commands
    .filter((command) => matchesSlashCommand(command, query))
    .toSorted((a, b) => {
      const rankA = rankSlashCommand(a, query)
      const rankB = rankSlashCommand(b, query)
      if (rankA !== rankB) return rankA - rankB
      if (a.source !== b.source) return a.source === "native" ? -1 : 1
      return `${a.category}/${a.name}`.localeCompare(
        `${b.category}/${b.name}`
      )
    })
}
