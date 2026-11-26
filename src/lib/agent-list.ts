import type { AgentInfo } from "@/lib/opencode"

/**
 * Agents that can own a top-level session. The native `all` mode can also be
 * selected as a primary agent, but New Session deliberately exposes only
 * `primary` agents and never hidden entries.
 */
export function primaryAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.filter((agent) => agent.mode === "primary" && !agent.hidden)
}
