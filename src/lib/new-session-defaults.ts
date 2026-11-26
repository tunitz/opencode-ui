import type { AgentInfo, ConfigEntry, ModelInfo, ModelRef } from "@/lib/opencode"
import {
  agentModelDefaults,
  buildModelRef,
  effectiveDefaultAgent,
  isModelRefSelectable,
} from "@/lib/session-selection"

/**
 * New-session resolution against the destination folder's engine catalog.
 *
 * The agent comes from `config.get`'s effective `default_agent` plus the raw
 * agent-list order. The model comes from that agent's configured model first,
 * then the engine's `model.default` API result. References are preserved
 * verbatim (including variants): an unavailable default is surfaced and blocks
 * creation until the user chooses a valid model. There is deliberately no
 * silent fallback to another model or to a hardcoded/free choice.
 */
export type NewSessionModelSource = "agent" | "engine-default" | "none"

export type NewSessionResolution = {
  agentID: string | null
  model: ModelRef | null
  modelSource: NewSessionModelSource
  /** The resolved reference is present but not selectable at this location. */
  unavailable: boolean
  error: string | null
}

export function resolveNewSessionDefaults({
  agents,
  models,
  configEntries,
  defaultModel,
}: {
  agents: AgentInfo[]
  models: ModelInfo[]
  configEntries: ConfigEntry[]
  defaultModel: ModelInfo | null
}): NewSessionResolution {
  const defaultAgentID = effectiveDefaultAgent(agents, configEntries)
  const agent = defaultAgentID
    ? (agents.find((candidate) => candidate.id === defaultAgentID) ?? null)
    : null

  const agentModel = agentModelDefaults(agent)
  if (agentModel) {
    const available = isModelRefSelectable(agentModel, models)
    return {
      agentID: agent?.id ?? null,
      model: agentModel,
      modelSource: "agent",
      unavailable: !available,
      error: available
        ? null
        : "The default agent's model or thinking level is unavailable at this folder. Choose an available model.",
    }
  }

  // `model.default` is the pinned engine API's own default. Keep the reference
  // exactly as returned; only the availability flag reacts to the catalog.
  const engineDefault = defaultModel ? buildModelRef(defaultModel) : null
  if (engineDefault) {
    const available = isModelRefSelectable(engineDefault, models)
    return {
      agentID: agent?.id ?? null,
      model: engineDefault,
      modelSource: "engine-default",
      unavailable: !available,
      error: available
        ? null
        : "The engine default model is unavailable at this folder. Choose an available model.",
    }
  }

  return {
    agentID: agent?.id ?? null,
    model: null,
    modelSource: "none",
    unavailable: false,
    error: "No model is configured for this folder. Choose an available model.",
  }
}
