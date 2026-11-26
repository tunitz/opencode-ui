import { expect, test } from "bun:test"
import {
  agentModelDefaults,
  isModelRefSelectable,
  primaryCapableAgents,
  selectableAgents,
} from "../src/lib/session-selection"
import { resolveNewSessionDefaults } from "../src/lib/new-session-defaults"
import type {
  AgentInfo,
  ConfigEntry,
  ModelInfo,
} from "../src/lib/opencode"

const model = (id: string, variants: string[] = []) =>
  ({
    id,
    providerID: "provider",
    enabled: true,
    variants: variants.map((name) => ({ id: name })),
  }) as unknown as ModelInfo

const agent = (ref: unknown) =>
  ({ id: "build", model: ref }) as unknown as AgentInfo

test("agent model defaults keep the configured variant when it is supported", () => {
  expect(
    agentModelDefaults(
      agent({ providerID: "provider", id: "fast", variant: "high" })
    )
  ).toEqual({ providerID: "provider", id: "fast", variant: "high" })
})

test("agent model defaults preserve an unsupported variant verbatim for explicit display", () => {
  const models = [model("fast", ["low"])]
  const ref = { providerID: "provider", id: "fast", variant: "missing" }
  expect(agentModelDefaults(agent(ref))).toEqual(ref)
  expect(isModelRefSelectable(ref, models)).toBe(false)
})

test("agent model defaults never substitute an unavailable model", () => {
  const models = [model("free")]
  const ref = { providerID: "other", id: "paid" }
  expect(agentModelDefaults(agent(ref))).toEqual(ref)
  expect(isModelRefSelectable(ref, models)).toBe(false)
})

test("model reference availability rejects disabled and deprecated catalog entries", () => {
  const disabled = { ...model("fast"), enabled: false }
  const deprecated = { ...model("old"), status: "deprecated" as const }
  expect(
    isModelRefSelectable({ providerID: "provider", id: "fast" }, [disabled])
  ).toBe(false)
  expect(
    isModelRefSelectable({ providerID: "provider", id: "old" }, [deprecated])
  ).toBe(false)
  expect(
    isModelRefSelectable(
      { providerID: "provider", id: "fast" },
      [model("fast", ["low"])]
    )
  ).toBe(true)
})

test("agent model defaults are absent for an agent without a model", () => {
  expect(agentModelDefaults(null)).toBeNull()
  expect(agentModelDefaults(agent(null))).toBeNull()
})

test("the agent picker offers only non-hidden primary agents", () => {
  const catalog = [
    { id: "build", mode: "primary", hidden: false },
    { id: "coach", mode: "primary", hidden: false },
    { id: "draft", mode: "all", hidden: false },
    { id: "worker", mode: "subagent", hidden: false },
    { id: "secret", mode: "primary", hidden: true },
  ] as unknown as AgentInfo[]
  expect(selectableAgents(catalog).map((entry) => entry.id)).toEqual([
    "build",
    "coach",
  ])
})

test("primary-capable agents include visible all-mode agents but never subagents", () => {
  const catalog = [
    { id: "build", mode: "primary", hidden: false },
    { id: "draft", mode: "all", hidden: false },
    { id: "worker", mode: "subagent", hidden: false },
    { id: "secret", mode: "all", hidden: true },
  ] as unknown as AgentInfo[]
  expect(primaryCapableAgents(catalog).map((entry) => entry.id)).toEqual([
    "build",
    "draft",
  ])
})

function configWithDefaultAgent(id: string): ConfigEntry[] {
  return [{ type: "document", info: { default_agent: id } }] as ConfigEntry[]
}

test("new-session defaults prefer the configured agent model", () => {
  const agents = [
    { id: "default", mode: "primary", hidden: false, model: { providerID: "provider", id: "agent-model" } },
  ] as unknown as AgentInfo[]
  const result = resolveNewSessionDefaults({
    agents,
    models: [model("agent-model")],
    configEntries: configWithDefaultAgent("default"),
    defaultModel: model("engine-default"),
  })
  expect(result).toEqual({
    agentID: "default",
    model: { providerID: "provider", id: "agent-model" },
    modelSource: "agent",
    unavailable: false,
    error: null,
  })
})

test("new-session defaults use the engine API default only when the agent has no model", () => {
  const agents = [
    { id: "default", mode: "primary", hidden: false, model: undefined },
  ] as unknown as AgentInfo[]
  const result = resolveNewSessionDefaults({
    agents,
    models: [model("engine-default")],
    configEntries: configWithDefaultAgent("default"),
    defaultModel: model("engine-default"),
  })
  expect(result.modelSource).toBe("engine-default")
  expect(result.model).toEqual({ providerID: "provider", id: "engine-default" })
})

test("new-session defaults never invent a free model when the engine has none", () => {
  const result = resolveNewSessionDefaults({
    agents: [],
    models: [model("deepseek-v4.1-flash-free")],
    configEntries: [],
    defaultModel: null,
  })
  expect(result.model).toBeNull()
  expect(result.modelSource).toBe("none")
  expect(result.error).toContain("No model is configured")
})

test("new-session defaults flag an engine default missing from the destination catalog", () => {
  const result = resolveNewSessionDefaults({
    agents: [],
    models: [model("other")],
    configEntries: [],
    defaultModel: {
      providerID: "engine",
      id: "missing",
    } as unknown as ModelInfo,
  })
  expect(result.model).toEqual({ providerID: "engine", id: "missing" })
  expect(result.unavailable).toBe(true)
  expect(result.error).toContain("unavailable at this folder")
})

test("new-session defaults preserve an unsupported configured variant and block creation", () => {
  const agents = [
    {
      id: "default",
      mode: "primary",
      hidden: false,
      model: { providerID: "provider", id: "agent-model", variant: "missing" },
    },
  ] as unknown as AgentInfo[]
  const result = resolveNewSessionDefaults({
    agents,
    models: [model("agent-model", ["low"])],
    configEntries: configWithDefaultAgent("default"),
    defaultModel: model("engine-default"),
  })
  expect(result.model).toEqual({
    providerID: "provider",
    id: "agent-model",
    variant: "missing",
  })
  expect(result.unavailable).toBe(true)
  expect(result.error).toContain("unavailable at this folder")
})

test("new-session defaults do not fall back when the configured model is absent", () => {
  const agents = [
    {
      id: "default",
      mode: "primary",
      hidden: false,
      model: { providerID: "other", id: "missing-model" },
    },
  ] as unknown as AgentInfo[]
  const result = resolveNewSessionDefaults({
    agents,
    models: [model("engine-default")],
    configEntries: configWithDefaultAgent("default"),
    defaultModel: model("engine-default"),
  })
  expect(result.model).toEqual({ providerID: "other", id: "missing-model" })
  expect(result.unavailable).toBe(true)
  expect(result.error).toContain("unavailable at this folder")
})
