import {
  agentConfigModelKey,
  type AgentConfigEntry,
  type AgentConfigModel,
} from "@/lib/agent-config-types"

export type AgentGroup = "primary" | "subagents" | "hidden"

export const AGENT_GROUP_ORDER: readonly AgentGroup[] = [
  "primary",
  "subagents",
  "hidden",
] as const

export function agentGroup(entry: AgentConfigEntry): AgentGroup {
  const hidden =
    entry.effective?.hidden ?? entry.source?.values.hidden ?? false
  if (hidden) return "hidden"
  const mode = entry.effective?.mode ?? entry.source?.values.mode ?? "subagent"
  return mode === "subagent" ? "subagents" : "primary"
}

/** Agents grouped in stable order, each group sorted by id. */
export function groupedAgents(
  entries: AgentConfigEntry[]
): { group: AgentGroup; agents: AgentConfigEntry[] }[] {
  const buckets: Record<AgentGroup, AgentConfigEntry[]> = {
    primary: [],
    subagents: [],
    hidden: [],
  }
  for (const entry of entries) {
    buckets[agentGroup(entry)].push(entry)
  }
  return AGENT_GROUP_ORDER.map((group) => ({
    group,
    agents: buckets[group].sort((a, b) => a.id.localeCompare(b.id)),
  }))
}

export function agentModelLabel(model: AgentConfigModel | null): string {
  return model ? agentConfigModelKey(model) : "Inherits session model"
}
