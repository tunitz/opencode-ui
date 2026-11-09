/**
 * Conversation tool visibility: which tool calls (and, in Zen, which interim
 * assistant text) the conversation shows. Pure and storage-injected so it can
 * be tested without a browser and reused by any caller that owns a store.
 */

export const TOOL_VISIBILITY_MODES = ["all", "hide-successful", "hide-all", "zen"] as const

export type ToolVisibilityMode = (typeof TOOL_VISIBILITY_MODES)[number]

export const TOOL_VISIBILITY_STORAGE_PREFIX = "opencode-ui:tool-visibility:v1"

const DEFAULT_MODE: ToolVisibilityMode = "all"

type StorageReader = { getItem(key: string): string | null }
type StorageWriter = { setItem(key: string, value: string): void }

const LABELS: Record<ToolVisibilityMode, string> = {
  all: "All tools",
  "hide-successful": "Hide successful",
  "hide-all": "Hide all tools",
  zen: "Zen",
}

function isToolVisibilityMode(value: unknown): value is ToolVisibilityMode {
  return typeof value === "string" && (TOOL_VISIBILITY_MODES as readonly string[]).includes(value)
}

/** Coerce persisted or user-supplied input; anything unrecognized is "all". */
export function normalizeToolVisibility(value: string | null | undefined): ToolVisibilityMode {
  return isToolVisibilityMode(value) ? value : DEFAULT_MODE
}

export function toolVisibilityStorageKey(origin: string, backendVersion: string): string {
  return `${TOOL_VISIBILITY_STORAGE_PREFIX}:${encodeURIComponent(origin)}:${encodeURIComponent(backendVersion)}`
}

/** Read the mode for one origin/backend pair; missing, corrupt, or denied storage means "all". */
export function readToolVisibility(
  storage: StorageReader | null,
  origin: string,
  backendVersion: string
): ToolVisibilityMode {
  if (!storage) return DEFAULT_MODE
  try {
    return normalizeToolVisibility(storage.getItem(toolVisibilityStorageKey(origin, backendVersion)))
  } catch {
    return DEFAULT_MODE
  }
}

/** Persist the mode; false when storage is absent or the write throws (quota/denied). */
export function writeToolVisibility(
  storage: StorageWriter | null,
  origin: string,
  backendVersion: string,
  mode: ToolVisibilityMode
): boolean {
  if (!storage) return false
  try {
    storage.setItem(toolVisibilityStorageKey(origin, backendVersion), mode)
    return true
  } catch {
    return false
  }
}

export function toolVisibilityLabel(mode: ToolVisibilityMode): string {
  return LABELS[mode] ?? LABELS.all
}

export type ToolRunState = "running" | "completed" | "error"

/**
 * Whether one tool row is shown. Zen hides tools entirely while the turn runs;
 * the caller reveals them for Find or terminal states rather than bypassing
 * this predicate.
 */
export function shouldShowTool(mode: ToolVisibilityMode, state: ToolRunState): boolean {
  switch (mode) {
    case "all":
      return true
    case "hide-successful":
      return state !== "completed"
    case "hide-all":
    case "zen":
      return false
  }
}

/**
 * Zen also collapses interim assistant narration. Only hide while the run is
 * active and this is neither the final answer nor an explicit Find view.
 */
export function shouldHideIntermediateText(
  mode: ToolVisibilityMode,
  context: { runActive: boolean; isFinalAnswer: boolean; findOpen: boolean }
): boolean {
  if (mode !== "zen") return false
  return context.runActive && !context.isFinalAnswer && !context.findOpen
}

export type ToolGroup<T> = {
  key: string
  tools: T[]
  states: { running: number; completed: number; error: number }
}

/**
 * Group a contiguous run of tools. Callers pass only the tool parts of one run
 * (non-tool parts split the run before this call), so a non-empty input is a
 * single group keyed by its first tool.
 */
export function groupTools<T extends { id: string; status: ToolRunState }>(
  tools: readonly T[]
): ToolGroup<T>[] {
  const first = tools[0]
  if (!first) return []

  const states = { running: 0, completed: 0, error: 0 }
  for (const tool of tools) {
    switch (tool.status) {
      case "running":
        states.running += 1
        break
      case "completed":
        states.completed += 1
        break
      case "error":
        states.error += 1
        break
    }
  }

  return [{ key: `tools:${first.id}`, tools: [...tools], states }]
}

/** Filter in display order, keeping the original objects. */
export function visibleTools<T extends { status: ToolRunState }>(
  mode: ToolVisibilityMode,
  tools: readonly T[]
): T[] {
  return tools.filter((tool) => shouldShowTool(mode, tool.status))
}

export type ConversationToolLike = { status: ToolRunState }

/**
 * Conversation-level filter: errors stay visible in every mode, and Zen only
 * hides tools while a turn is actively running and Find is closed.
 */
export function visibleConversationTools<T extends ConversationToolLike>(
  tools: readonly T[],
  mode: ToolVisibilityMode,
  runActive: boolean,
  findOpen: boolean
): T[] {
  if (mode === "all") return [...tools]
  if (mode === "zen" && (!runActive || findOpen)) return [...tools]
  if (mode === "hide-successful") {
    return tools.filter((tool) => tool.status !== "completed")
  }
  return tools.filter((tool) => tool.status === "error")
}
