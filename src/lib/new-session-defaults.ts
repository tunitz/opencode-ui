import type {
  AgentInfo,
  ModelInfo,
  ModelRef,
} from "@/lib/opencode"
import {
  defaultNewSessionModel,
  selectableAgents,
  selectableModels,
  variantsForModel,
} from "@/lib/session-selection"
import {
  modelPreferenceToRef,
  type ModelPreference,
  type PreferenceOverride,
  type WebUiPreferences,
} from "@/lib/web-ui-preferences"

export type EffectiveDefault<T> = {
  source: "project" | "global"
  value: T
}

function pick<T>(
  override: PreferenceOverride<T> | undefined,
  global: T
): EffectiveDefault<T> {
  return override?.mode === "set"
    ? { source: "project", value: override.value }
    : { source: "global", value: global }
}

export function effectiveAgentPreference(
  preferences: WebUiPreferences,
  projectID: string
): EffectiveDefault<string | null> {
  return pick(preferences.projectOverrides[projectID]?.agent, preferences.global.agentID)
}

export function effectiveModelPreference(
  preferences: WebUiPreferences,
  projectID: string
): EffectiveDefault<ModelPreference | null> {
  return pick(preferences.projectOverrides[projectID]?.model, preferences.global.model)
}

export function effectiveThinkingPreference(
  preferences: WebUiPreferences,
  projectID: string
): EffectiveDefault<string | null> {
  return pick(
    preferences.projectOverrides[projectID]?.thinkingLevel,
    preferences.global.thinkingLevel
  )
}

export type NewSessionResolution = {
  agentID: string | null
  model: ModelRef | null
  thinkingLevel: string | null
  agentSource: "project" | "global" | "backend"
  modelSource: "project" | "global" | "fallback"
  thinkingSource: "project" | "global" | "default"
  error: string | null
}

/**
 * Resolve saved defaults against the target project's native catalog. Explicit
 * but unavailable values block creation; they never silently fall back. A null
 * model resolves to the existing safe free-model fallback, and a null agent is
 * left implicit so the backend chooses its configured default.
 */
export function resolveNewSessionDefaults({
  preferences,
  projectID,
  agents,
  models,
}: {
  preferences: WebUiPreferences
  projectID: string
  agents: AgentInfo[]
  models: ModelInfo[]
}): NewSessionResolution {
  const agentPreference = effectiveAgentPreference(preferences, projectID)
  const modelPreference = effectiveModelPreference(preferences, projectID)
  const thinkingPreference = effectiveThinkingPreference(preferences, projectID)

  const availableAgents = selectableAgents(agents)
  const explicitAgent = agentPreference.value
  let agentID: string | null = null
  if (explicitAgent) {
    if (!availableAgents.some((agent) => agent.id === explicitAgent)) {
      return {
        agentID: null,
        model: null,
        thinkingLevel: null,
        agentSource: agentPreference.source,
        modelSource: "fallback",
        thinkingSource: "default",
        error: `Saved Agent “${explicitAgent}” is unavailable for this project.`,
      }
    }
    agentID = explicitAgent
  }

  const availableModels = selectableModels(models)
  let modelInfo: ModelInfo
  let modelSource: "project" | "global" | "fallback" = modelPreference.source
  if (modelPreference.value) {
    const found =
      availableModels.find(
        (candidate) =>
          candidate.providerID === modelPreference.value?.providerID &&
          candidate.id === modelPreference.value?.modelID
      ) ?? null
    if (!found) {
      return {
        agentID,
        model: null,
        thinkingLevel: null,
        agentSource: explicitAgent ? agentPreference.source : "backend",
        modelSource: modelPreference.source,
        thinkingSource: "default",
        error: "Saved default Model is unavailable for this project.",
      }
    }
    modelInfo = found
  } else {
    const fallback = defaultNewSessionModel(models)
    const found = fallback
      ? (availableModels.find(
          (candidate) =>
            candidate.providerID === fallback.providerID &&
            candidate.id === fallback.id
        ) ?? null)
      : null
    modelSource = "fallback"
    if (!found) {
      return {
        agentID,
        model: null,
        thinkingLevel: null,
        agentSource: explicitAgent ? agentPreference.source : "backend",
        modelSource,
        thinkingSource: "default",
        error: "No safe fallback model is available for new sessions.",
      }
    }
    modelInfo = found
  }

  const thinkingLevel = thinkingPreference.value
  let thinkingSource: "project" | "global" | "default" =
    thinkingPreference.source
  if (!thinkingLevel) {
    thinkingSource = "default"
  } else if (!variantsForModel(modelInfo).includes(thinkingLevel)) {
    return {
      agentID,
      model: modelPreferenceToRef(
        { providerID: modelInfo.providerID, modelID: modelInfo.id },
        null
      ),
      thinkingLevel: null,
      agentSource: explicitAgent ? agentPreference.source : "backend",
      modelSource,
      thinkingSource,
      error: `Saved Thinking Level “${thinkingLevel}” is unavailable for this model.`,
    }
  }

  return {
    agentID,
    model: modelPreferenceToRef(
      { providerID: modelInfo.providerID, modelID: modelInfo.id },
      thinkingLevel
    ),
    thinkingLevel,
    agentSource: explicitAgent ? agentPreference.source : "backend",
    modelSource,
    thinkingSource,
    error: null,
  }
}
