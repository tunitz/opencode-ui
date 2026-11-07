import { newSessionProjectError } from "@/lib/new-session-target"
import { resolveNewSessionDefaults } from "@/lib/new-session-defaults"
import type { openCode } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"
import type { WebUiPreferences } from "@/lib/web-ui-preferences"

/** Resolve everything against the clicked worktree, never a previously loaded catalog. */
export async function createWorktreeSession(
  directory: string,
  projectID: string,
  preferences: WebUiPreferences,
  createSession: OpenCodeController["createSession"],
  client: Pick<typeof openCode, "location" | "agent" | "model">
): Promise<{ created: boolean; error: string | null }> {
  const location = { location: { directory } }
  const resolved = await client.location.get(location)
  const projectError = newSessionProjectError(resolved.project.id, projectID)
  if (projectError) return { created: false, error: projectError }
  const [agents, models] = await Promise.all([
    client.agent.list(location),
    client.model.list(location),
  ])
  const defaults = resolveNewSessionDefaults({
    preferences, projectID, agents: agents.data, models: models.data,
  })
  if (defaults.error || !defaults.model) {
    return { created: false, error: defaults.error ?? "No model is available for this worktree." }
  }
  const created = await createSession(projectID, { agentID: defaults.agentID, model: defaults.model }, directory)
  return { created, error: created ? null : "Session creation failed." }
}
