import type { AgentInfo, ConfigEntry, ModelInfo, ModelRef } from "@/lib/opencode"
import { resolveNewSessionDefaults } from "@/lib/new-session-defaults"

/**
 * Minimal engine surface used to start a session in a worktree. Every read is
 * scoped to the destination directory, never to the source project currently
 * shown in the sidebar.
 */
export type WorktreeEngine = {
  location: {
    get: (arg: {
      location: { directory: string }
    }) => Promise<{ project: { id: string } }>
  }
  agent: {
    list: (arg: {
      location: { directory: string }
    }) => Promise<{ data: AgentInfo[] }>
  }
  config: {
    get: (arg: { location: { directory: string } }) => Promise<ConfigEntry[]>
  }
  model: {
    list: (arg: {
      location: { directory: string }
    }) => Promise<{ data: ModelInfo[] }>
    default: (arg: {
      location: { directory: string }
    }) => Promise<{ data: ModelInfo | null }>
  }
}

export type WorktreeSelection = {
  agentID: string | null
  model: ModelRef
  modelSource: "agent" | "engine-default" | "none"
}

export type WorktreeSessionResult = {
  created: boolean
  error: string | null
  model: ModelRef | null
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve the selection at the exact worktree directory without creating a
 * session. Used to show the engine choice (including possible cost) before the
 * user confirms the action.
 */
export async function resolveWorktreeSelection(
  directory: string,
  projectID: string,
  engine: WorktreeEngine
): Promise<{ selection: WorktreeSelection | null; error: string | null }> {
  try {
    const resolved = await engine.location.get({ location: { directory } })
    if (resolved.project.id !== projectID) {
      return {
        selection: null,
        error: "This worktree no longer belongs to the selected project.",
      }
    }

    const location = { location: { directory } }
    const [agents, configEntries, models, defaultModel] = await Promise.all([
      engine.agent.list(location).then((response) => response.data),
      engine.config.get(location),
      engine.model.list(location).then((response) => response.data),
      engine.model.default(location).then((response) => response.data),
    ])

    const resolution = resolveNewSessionDefaults({
      agents,
      models,
      configEntries,
      defaultModel,
    })
    if (!resolution.model || resolution.unavailable) {
      return {
        selection: null,
        error: resolution.error ?? "No model is available for this worktree.",
      }
    }
    return {
      selection: {
        agentID: resolution.agentID,
        model: resolution.model,
        modelSource: resolution.modelSource,
      },
      error: null,
    }
  } catch (error) {
    return { selection: null, error: describeError(error) }
  }
}

/** Create one session with the destination folder and the confirmed choices. */
export async function createWorktreeSession(
  directory: string,
  projectID: string,
  createSession: (
    projectID: string,
    selection: { agentID: string | null; model: ModelRef },
    directory?: string
  ) => Promise<boolean>,
  engine: WorktreeEngine,
  preselected?: WorktreeSelection
): Promise<WorktreeSessionResult> {
  try {
    let selection = preselected
    if (!selection) {
      const preview = await resolveWorktreeSelection(directory, projectID, engine)
      if (!preview.selection) {
        return { created: false, error: preview.error, model: null }
      }
      selection = preview.selection
    } else {
      // The destination can change between preview and confirmation.
      const resolved = await engine.location.get({ location: { directory } })
      if (resolved.project.id !== projectID) {
        return {
          created: false,
          error: "This worktree no longer belongs to the selected project.",
          model: null,
        }
      }
    }

    const created = await createSession(
      projectID,
      { agentID: selection.agentID, model: selection.model },
      directory
    )
    return {
      created,
      error: created ? null : "Session creation failed.",
      model: selection.model,
    }
  } catch (error) {
    return { created: false, error: describeError(error), model: null }
  }
}
