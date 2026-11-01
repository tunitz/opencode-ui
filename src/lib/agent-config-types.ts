/**
 * Shared types for the app-layer agent configuration editor.
 *
 * These types intentionally describe only the narrow, non-secret subset of
 * OpenCode agent configuration that the UI may edit. They are imported by both
 * the browser module and the Vite server middleware; keep this file free of
 * Node and DOM APIs.
 */

export type AgentConfigScope = "global" | "project"

export type AgentConfigMode = "primary" | "subagent" | "all"

export type AgentConfigSourceKind = "jsonc" | "markdown"

export type AgentConfigModel = {
  providerID: string
  id: string
  variant?: string
}

export type AgentConfigPermissionEffect = "allow" | "deny" | "ask"

/** One OpenCode agent permission rule. Order is significant. */
export type AgentConfigPermissionRule = {
  action: string
  resource: string
  effect: AgentConfigPermissionEffect
}

/** Editable values as they appear in a source file. Missing keys are absent. */
export type AgentConfigValues = {
  model?: AgentConfigModel | null
  description?: string | null
  mode?: AgentConfigMode | null
  hidden?: boolean | null
  steps?: number | null
  disabled?: boolean | null
  permissions?: AgentConfigPermissionRule[] | null
}

/** Effective values reported by the native agent catalog. */
export type AgentConfigEffective = {
  model: AgentConfigModel | null
  description: string | null
  mode: AgentConfigMode
  hidden: boolean
  steps: number | null
  disabled: boolean | null
}

export type AgentConfigSource = {
  kind: AgentConfigSourceKind
  /** Path relative to the scope root; never an absolute path. */
  relativePath: string
  /** Short human label such as "Project .opencode/agents/build.md". */
  label: string
  exists: boolean
  /** SHA-256 of the exact bytes read, or null for a file that must be created. */
  hash: string | null
  values: AgentConfigValues
}

export type AgentConfigEntry = {
  id: string
  name: string
  effective: AgentConfigEffective | null
  /** Highest-precedence source in this scope, if one exists. */
  source: AgentConfigSource | null
  /** Where a save would go. Null when the source is read-only. */
  target: AgentConfigSource | null
  readonly: boolean
  /** True when permission rules exist but cannot be safely round-tripped. */
  permissionsReadOnly: boolean
  warnings: string[]
}

export type AgentConfigCatalog = {
  scope: AgentConfigScope
  project: { id: string; name: string } | null
  sourceLabel: string
  agents: AgentConfigEntry[]
  warnings: string[]
}

/**
 * Patch values. `null` removes an override; omitted fields are not changed.
 * The server rejects unknown fields.
 */
export type AgentConfigPatch = AgentConfigValues

export type AgentConfigUpdateRequest = {
  scope: AgentConfigScope
  projectID: string | null
  agentID: string
  target: {
    kind: AgentConfigSourceKind
    relativePath: string
  }
  expectedHash: string | null
  patch: AgentConfigPatch
}

export type AgentConfigUpdateResult = {
  source: {
    kind: AgentConfigSourceKind
    relativePath: string
    label: string
  }
  hash: string
  unchanged: boolean
  warnings: string[]
}

export type AgentConfigErrorBody = {
  error: {
    code: string
    message: string
  }
}

export const AGENT_CONFIG_MODES: readonly AgentConfigMode[] = [
  "primary",
  "subagent",
  "all",
] as const

export const AGENT_CONFIG_FIELDS = [
  "model",
  "description",
  "mode",
  "hidden",
  "steps",
  "disabled",
  "permissions",
] as const

export type AgentConfigField = (typeof AGENT_CONFIG_FIELDS)[number]

export function isAgentConfigMode(value: unknown): value is AgentConfigMode {
  return (
    value === "primary" || value === "subagent" || value === "all"
  )
}

export function isAgentConfigField(value: unknown): value is AgentConfigField {
  return (AGENT_CONFIG_FIELDS as readonly unknown[]).includes(value)
}

export const AGENT_CONFIG_PERMISSION_EFFECTS: readonly AgentConfigPermissionEffect[] = [
  "ask",
  "allow",
  "deny",
] as const

/** Common built-in actions offered only as input suggestions. */
export const AGENT_CONFIG_PERMISSION_ACTIONS = [
  "shell",
  "edit",
  "read",
  "grep",
  "glob",
  "webfetch",
  "websearch",
  "external_directory",
  "subagent",
  "question",
  "execute",
] as const

export function isAgentConfigPermissionEffect(
  value: unknown
): value is AgentConfigPermissionEffect {
  return value === "allow" || value === "deny" || value === "ask"
}

export function agentConfigModelKey(
  model: AgentConfigModel | null | undefined
): string {
  if (!model) return ""
  return `${model.providerID}/${model.id}${
    model.variant ? `#${model.variant}` : ""
  }`
}
