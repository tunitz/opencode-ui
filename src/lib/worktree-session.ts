import type { AgentInfo, ConfigEntry, ModelRef } from "@/lib/opencode"
import { effectiveDefaultAgent } from "@/lib/session-selection"

/** Resolve everything against the clicked worktree, never a previously loaded catalog. */
export async function createWorktreeSession(
  directory: string,
  projectID: string,
  agents: AgentInfo[],
  configEntries: ConfigEntry[],
  createSession: (
    projectID: string,
    selection: { agentID: string | null; model: ModelRef },
    directory?: string
  ) => Promise<boolean>,
  location: { get: (arg: { location: { directory: string } }) => Promise<{ project: { id: string } }> }
): Promise<{ created: boolean; error: string | null }> {
  const resolved = await location.get({ location: { directory } })
  if (resolved.project.id !== projectID) {
    return {
      created: false,
      error: "This worktree no longer belongs to the selected project.",
    }
  }
  const defaultAgentID = effectiveDefaultAgent(agents, configEntries)
  const agent = defaultAgentID
    ? (agents.find((candidate) => candidate.id === defaultAgentID) ?? null)
    : null
  const model = agent?.model ?? null
  if (!model) {
    return { created: false, error: "No model is configured for the default agent." }
  }
  const created = await createSession(
    projectID,
    { agentID: agent?.id ?? null, model },
    directory
  )
  return { created, error: created ? null : "Session creation failed." }
}
