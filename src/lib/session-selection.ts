import type { AgentInfo, ConfigEntry, ModelInfo, ModelRef } from "@/lib/opencode"

/**
 * Pure helpers for agent/model/variant selection. The backend contract is the
 * source of truth: `POST /api/session/{id}/agent` takes `{agent}` and
 * `POST /api/session/{id}/model` takes `{model: {id, providerID, variant?}}`,
 * both returning 204. A session's authoritative values are `SessionInfo.agent`
 * (an agent id) and `SessionInfo.model` (a `ModelRef`).
 */

/** Stable identity for a model: provider + id (unique across the catalog). */
export function modelKey(model: { providerID: string; id: string }): string {
  return `${model.providerID}/${model.id}`
}

/**
 * Catalog lookups used to scan the whole array with `.find`/`.some` on every
 * render (and once per row in some lists). These indexes are keyed by the
 * catalog array identity, so a stable catalog is indexed once and every later
 * lookup is O(1). Catalogs are replaced, never mutated in place, so an index
 * never outlives the data it describes.
 */
const modelIndexByCatalog = new WeakMap<
  readonly ModelInfo[],
  Map<string, ModelInfo>
>()
function modelIndex(models: readonly ModelInfo[]): Map<string, ModelInfo> {
  let index = modelIndexByCatalog.get(models)
  if (!index) {
    index = new Map<string, ModelInfo>()
    for (const model of models) index.set(modelKey(model), model)
    modelIndexByCatalog.set(models, index)
  }
  return index
}

const agentIndexByCatalog = new WeakMap<
  readonly AgentInfo[],
  Map<string, AgentInfo>
>()
function agentIndex(agents: readonly AgentInfo[]): Map<string, AgentInfo> {
  let index = agentIndexByCatalog.get(agents)
  if (!index) {
    index = new Map<string, AgentInfo>()
    for (const agent of agents) index.set(agent.id, agent)
    agentIndexByCatalog.set(agents, index)
  }
  return index
}

export function modelRefKey(model: ModelRef | null | undefined): string {
  return model ? modelKey(model) : ""
}

/** Variant value used by the selector; "" is the implicit default variant. */
export function variantValue(model: ModelRef | null | undefined): string {
  return model?.variant ?? ""
}

/** Build a `ModelRef` from a catalog model, optionally pinning a variant. */
export function buildModelRef(
  model: Pick<ModelInfo, "providerID" | "id">,
  variant?: string | null
): ModelRef {
  return variant
    ? { providerID: model.providerID, id: model.id, variant }
    : { providerID: model.providerID, id: model.id }
}

/** Variant ids the selected model actually supports; empty when it has none. */
export function variantsForModel(
  model: ModelInfo | null | undefined
): string[] {
  return model?.variants.map((variant) => variant.id) ?? []
}

/** Models a user may genuinely select: enabled and not deprecated. */
export function selectableModels(models: ModelInfo[]): ModelInfo[] {
  return models
    .filter((model) => model.enabled !== false && model.status !== "deprecated")
    .toSorted((a, b) =>
      `${a.providerID}/${a.id}`.localeCompare(`${b.providerID}/${b.id}`)
    )
}

/**
 * Agents offered in the primary agent picker. Only `primary` agents qualify:
 * `subagent` agents are internal, and `all` agents are not primary selections
 * even though the backend allows them as an explicit session agent.
 */
export function selectableAgents(agents: AgentInfo[]): AgentInfo[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode === "primary")
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

function isPrimaryCapable(agent: AgentInfo): boolean {
  return !agent.hidden && agent.mode !== "subagent"
}

/**
 * Agents that can own a top-level session: primary and `all` agents that are
 * visible. Subagents are internal and hidden entries must never be chosen.
 */
export function primaryCapableAgents(
  agents: readonly AgentInfo[]
): AgentInfo[] {
  return agents.filter(isPrimaryCapable)
}

/**
 * The agent the engine will actually use when a session has no explicit
 * `SessionInfo.agent`.
 *
 * Source of truth:
 * - `GET /api/config` returns config documents from lowest to highest priority;
 *   the backend selects the last defined `default_agent` (`Config.latest`), then
 *   validates that it is a primary/non-hidden agent.
 * - If that value is absent or not selectable, the backend falls back and
 *   `GET /api/agent` returns the selected default first; the raw (unsorted)
 *   catalog order is therefore the only API signal for that implicit fallback.
 *
 * This is display/default resolution only. It never writes session.agent; an
 * explicit session agent always wins, and an unknown explicit id stays unknown.
 */
export function effectiveDefaultAgent(
  agents: AgentInfo[],
  configEntries: readonly ConfigEntry[]
): string | null {
  const configured = configEntries
    .filter((entry) => entry.type === "document")
    .findLast((entry) => {
      const value = entry.info.default_agent
      return typeof value === "string" && value.trim().length > 0
    })?.info.default_agent

  if (configured) {
    const match = agentIndex(agents).get(configured)
    if (match && isPrimaryCapable(match)) return configured
  }

  // The backend's Agent.list() puts its selected default first. Use that raw
  // order (not the alphabetically sorted option order) as the fallback.
  return primaryCapableAgents(agents)[0]?.id ?? null
}

/**
 * The model an agent configured, copied verbatim including its variant.
 *
 * Availability is deliberately not decided here: an unsupported variant or a
 * model missing from this location must stay visible so the UI can flag it as
 * unavailable, instead of being silently swapped for a different model.
 */
export function agentModelDefaults(
  agent: AgentInfo | null | undefined
): ModelRef | null {
  return agent?.model ? { ...agent.model } : null
}

/**
 * True when a model reference can actually be selected at this location:
 * present in the catalog, enabled, not deprecated, and with a supported
 * variant when one is configured.
 */
export function isModelRefSelectable(
  model: ModelRef | null | undefined,
  models: readonly ModelInfo[]
): boolean {
  if (!model) return false
  const info = modelIndex(models).get(modelKey(model))
  if (!info || info.enabled === false || info.status === "deprecated") {
    return false
  }
  return !model.variant || variantsForModel(info).includes(model.variant)
}

/** True when a session's model exists in the loaded catalog (honest availability). */
export function isModelInCatalog(
  model: ModelRef | null | undefined,
  models: ModelInfo[]
): boolean {
  if (!model) {
    return true
  }

  return modelIndex(models).has(modelKey(model))
}

/** True when a session's agent exists in the loaded catalog (honest availability). */
export function isAgentInCatalog(
  agent: string | null | undefined,
  agents: AgentInfo[]
): boolean {
  if (!agent) {
    return true
  }

  return agentIndex(agents).has(agent)
}
