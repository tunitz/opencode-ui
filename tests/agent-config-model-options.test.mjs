import { expect, test } from "bun:test"

import { orderAgentModelOptions } from "../src/components/agent-config-settings.tsx"

function entries(...keys) {
  return keys.map((key) => ({
    key,
    option: { value: key, label: key.split("/")[1], detail: key },
  }))
}

const INHERIT = { value: "__inherit__", label: "Inherit / remove model override" }
const UNAVAILABLE = {
  value: "gone/model",
  label: "gone/model (unavailable)",
}

test("favorites rank first after the fixed Inherit/unavailable entries", () => {
  const stable = entries(
    "alpha/model",
    "beta/model",
    "gamma/model",
    "delta/model"
  )
  const ordered = orderAgentModelOptions(
    stable,
    new Set(["beta/model", "delta/model"]),
    [INHERIT, UNAVAILABLE]
  )

  expect(ordered.map((option) => option.value)).toEqual([
    "__inherit__",
    "gone/model",
    "beta/model",
    "delta/model",
    "alpha/model",
    "gamma/model",
  ])
})

test("ordering is stable within the favorite and non-favorite groups", () => {
  const stable = entries(
    "a/model",
    "b/model",
    "c/model",
    "d/model",
    "e/model"
  )
  const favorites = new Set(["b/model", "d/model"])

  const ordered = orderAgentModelOptions(stable, favorites)
  expect(ordered.map((option) => option.value)).toEqual([
    "b/model",
    "d/model",
    "a/model",
    "c/model",
    "e/model",
  ])
})

test("a favorite toggle only reorders reused option objects", () => {
  const stable = entries(
    "alpha/model",
    "beta/model",
    "gamma/model"
  )
  const byValue = new Map(stable.map(({ key, option }) => [key, option]))
  const sourceOrder = stable.map(({ key }) => key)

  const before = orderAgentModelOptions(stable, new Set(["gamma/model"]))
  const after = orderAgentModelOptions(stable, new Set(["beta/model"]))

  expect(before.map((option) => option.value)).toEqual([
    "gamma/model",
    "alpha/model",
    "beta/model",
  ])
  expect(after.map((option) => option.value)).toEqual([
    "beta/model",
    "alpha/model",
    "gamma/model",
  ])
  // Same object identity for each model across a toggle, just a new order.
  for (const option of [...before, ...after]) {
    expect(option).toBe(byValue.get(option.value))
  }
  // The input array is never reordered in place.
  expect(stable.map(({ key }) => key)).toEqual(sourceOrder)
})

test("no favorites keeps the original model order and prepends fixed entries", () => {
  const stable = entries("z/model", "a/model")
  expect(
    orderAgentModelOptions(stable, new Set(), [INHERIT]).map(
      (option) => option.value
    )
  ).toEqual(["__inherit__", "z/model", "a/model"])
})
