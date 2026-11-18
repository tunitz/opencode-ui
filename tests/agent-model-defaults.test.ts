import { expect, test } from "bun:test"
import {
  agentModelDefaults,
  selectableAgents,
} from "../src/lib/session-selection"
import type { AgentInfo, ModelInfo } from "../src/lib/opencode"

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
  const models = [model("fast", ["low", "high"])]
  expect(
    agentModelDefaults(
      agent({ providerID: "provider", id: "fast", variant: "high" }),
      models
    )
  ).toEqual({ providerID: "provider", id: "fast", variant: "high" })
})

test("agent model defaults drop an unsupported variant instead of inventing one", () => {
  const models = [model("fast", ["low"])]
  expect(
    agentModelDefaults(
      agent({ providerID: "provider", id: "fast", variant: "missing" }),
      models
    )
  ).toEqual({ providerID: "provider", id: "fast" })
})

test("agent model defaults never substitute an unavailable model", () => {
  const models = [model("free")]
  expect(
    agentModelDefaults(agent({ providerID: "other", id: "paid" }), models)
  ).toBeNull()
})

test("agent model defaults are absent for an agent without a model", () => {
  expect(agentModelDefaults(null, [model("free")])).toBeNull()
  expect(agentModelDefaults(agent(null), [model("free")])).toBeNull()
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
