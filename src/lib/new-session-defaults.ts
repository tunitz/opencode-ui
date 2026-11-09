import type { AgentInfo, ConfigEntry, ModelInfo, ModelRef } from "@/lib/opencode"
import { defaultNewSessionModel, effectiveDefaultAgent } from "@/lib/session-selection"

/**
 * New-session resolution against the target project's engine catalog. Agent
 * configuration is the single source of truth: the session uses the engine's
 * effective default agent and that agent's configured model (including its
 * variant). Only when the default agent has no model do we fall back to the
 * verified zero-cost model so creation never blocks on a paid/unknown choice.
 */
export type NewSessionResolution = {
  agentID: string | null
  model: ModelRef | null
  modelSource: "agent" | "fallback"
  error: string | null
}

export function resolveNewSessionDefaults({
  agents,
  models,
  configEntries,
}: {
  agents: AgentInfo[]
  models: ModelInfo[]
  configEntries: ConfigEntry[]
}): NewSessionResolution {
  const defaultAgentID = effectiveDefaultAgent(agents, configEntries)
  const agent = defaultAgentID
    ? (agents.find((candidate) => candidate.id === defaultAgentID) ?? null)
    : null

  if (!agent) {
    const fallback = defaultNewSessionModel(models)
    return {
      agentID: null,
      model: fallback,
      modelSource: "fallback",
      error: fallback ? null : "No model is available for new sessions.",
    }
  }

  if (agent.model) {
    return {
      agentID: agent.id,
      model: agent.model,
      modelSource: "agent",
      error: null,
    }
  }

  const fallback = defaultNewSessionModel(models)
  return {
    agentID: agent.id,
    model: fallback,
    modelSource: "fallback",
    error: fallback ? null : "No model is available for new sessions.",
  }
}
