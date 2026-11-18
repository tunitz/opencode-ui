import type { AgentInfo, ConfigEntry, ModelInfo, ModelRef } from "@/lib/opencode"
import { isVerifiedFreeModel } from "@/lib/free-model"

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
 * Agents a user may genuinely select. Mirrors the backend's `selectable` rule:
 * hidden internal agents and subagents are excluded from primary selection.
 */
export function selectableAgents(agents: AgentInfo[]): AgentInfo[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

function isSelectableAgent(agent: AgentInfo): boolean {
  return !agent.hidden && agent.mode !== "subagent"
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

  if (
    configured &&
    agents.some((agent) => agent.id === configured && isSelectableAgent(agent))
  ) {
    return configured
  }

  // The backend's Agent.list() puts its selected default first. Use that raw
  // order (not the alphabetically sorted option order) as the fallback.
  return agents.find(isSelectableAgent)?.id ?? null
}

/**
 * New-session default: the verified zero-cost model when it is present in the
 * live catalog, otherwise null so we never silently select a paid/unknown
 * model as a new session's default.
 */
export function defaultNewSessionModel(models: ModelInfo[]): ModelRef | null {
  const free = models.find((model) =>
    isVerifiedFreeModel({ providerID: model.providerID, id: model.id })
  )

  return free
    ? { providerID: free.providerID, id: free.id }
    : null
}

/**
 * The model an agent asks for, only when it is genuinely selectable in the
 * supplied catalog. An unavailable agent model is reported as absent rather
 * than silently replaced with another (possibly paid) model.
 */
export function agentModelDefaults(
  agent: AgentInfo | null | undefined,
  models: ModelInfo[]
): ModelRef | null {
  if (!agent?.model) return null
  const info = models.find(
    (candidate) =>
      candidate.providerID === agent.model!.providerID &&
      candidate.id === agent.model!.id
  )
  if (!info) return null
  const variant = agent.model.variant
  return variant && variantsForModel(info).includes(variant)
    ? { ...agent.model, variant }
    : buildModelRef(info)
}

/** True when a session's model exists in the loaded catalog (honest availability). */
export function isModelInCatalog(
  model: ModelRef | null | undefined,
  models: ModelInfo[]
): boolean {
  if (!model) {
    return true
  }

  return models.some(
    (candidate) =>
      candidate.providerID === model.providerID && candidate.id === model.id
  )
}

/** True when a session's agent exists in the loaded catalog (honest availability). */
export function isAgentInCatalog(
  agent: string | null | undefined,
  agents: AgentInfo[]
): boolean {
  if (!agent) {
    return true
  }

  return agents.some((candidate) => candidate.id === agent)
}
