import { expect, test } from "bun:test"
import { agentGroup, agentModelLabel, groupedAgents } from "../src/lib/agent-list.ts"

function entry(id, overrides = {}) {
  return {
    id,
    name: id,
    effective: { model: null, description: null, mode: "subagent", hidden: false, steps: null, disabled: null },
    source: null,
    ...overrides,
  }
}

test("groups agents into primary, subagents, and hidden in stable order", () => {
  const entries = [
    entry("zeta", { effective: { mode: "subagent", hidden: false } }),
    entry("alpha", { effective: { mode: "primary", hidden: false } }),
    entry("hidden-one", { effective: { mode: "primary", hidden: true } }),
  ]
  const groups = groupedAgents(entries)
  expect(groups.map((group) => group.group)).toEqual(["primary", "subagents", "hidden"])
  expect(groups[0].agents.map((agent) => agent.id)).toEqual(["alpha"])
  expect(groups[1].agents.map((agent) => agent.id)).toEqual(["zeta"])
  expect(groups[2].agents.map((agent) => agent.id)).toEqual(["hidden-one"])
})

test("each group is sorted by id", () => {
  const entries = [
    entry("b", { effective: { mode: "primary" } }),
    entry("a", { effective: { mode: "primary" } }),
    entry("c", { effective: { mode: "primary" } }),
  ]
  expect(groupedAgents(entries)[0].agents.map((agent) => agent.id)).toEqual(["a", "b", "c"])
})

test("agentGroup falls back to source values and defaults subagents", () => {
  expect(agentGroup(entry("x", { effective: null, source: { values: { hidden: true } } }))).toBe("hidden")
  expect(agentGroup(entry("x", { effective: null, source: { values: { mode: "subagent" } } }))).toBe("subagents")
  expect(agentGroup(entry("x", { effective: null, source: null }))).toBe("subagents")
  expect(agentGroup(entry("x", { effective: null, source: { values: { mode: "all" } } }))).toBe("primary")
})

test("agentModelLabel renders provider/model#variant or the inherit label", () => {
  expect(agentModelLabel({ providerID: "openai", id: "gpt-6.1-terra", variant: "high" })).toBe("openai/gpt-6.1-terra#high")
  expect(agentModelLabel({ providerID: "commandcode", id: "deepseek/deepseek-v4.1-flash" })).toBe("commandcode/deepseek/deepseek-v4.1-flash")
  expect(agentModelLabel(null)).toBe("Inherits session model")
})
