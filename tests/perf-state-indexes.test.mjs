import { expect, test } from "bun:test"
import { descendantSessionIDs } from "../src/lib/session-actions.ts"
import {
  agentModelDefaults,
  isAgentInCatalog,
  isModelInCatalog,
  isModelRefSelectable,
  modelKey,
} from "../src/lib/session-selection.ts"

const model = (providerID, id, variants = []) => ({
  providerID,
  id,
  enabled: true,
  variants: variants.map((variant) => ({ id: variant })),
})

test("descendant lookup follows the whole tree regardless of row order", () => {
  const sessions = [
    { id: "leaf", parentID: "child" },
    { id: "root" },
    { id: "unrelated" },
    { id: "child", parentID: "root" },
    { id: "grandchild", parentID: "child" },
  ]
  expect([...descendantSessionIDs(sessions, "root")].sort()).toEqual([
    "child",
    "grandchild",
    "leaf",
    "root",
  ])
  expect([...descendantSessionIDs(sessions, "leaf")]).toEqual(["leaf"])
})

test("catalog indexes keep model and agent lookups correct across catalogs", () => {
  const first = [model("p", "a", ["low"])]
  const second = [model("p", "b")]

  expect(isModelInCatalog({ providerID: "p", id: "a" }, first)).toBe(true)
  expect(isModelInCatalog({ providerID: "p", id: "b" }, first)).toBe(false)
  expect(isModelInCatalog({ providerID: "p", id: "b" }, second)).toBe(true)
  expect(modelKey(second[0])).toBe("p/b")

  expect(
    agentModelDefaults({
      id: "build",
      model: { providerID: "p", id: "a", variant: "low" },
    })
  ).toEqual({ providerID: "p", id: "a", variant: "low" })
  const unavailableRef = { providerID: "p", id: "b" }
  expect(
    agentModelDefaults({ id: "build", model: unavailableRef })
  ).toEqual(unavailableRef)
  expect(isModelRefSelectable(unavailableRef, first)).toBe(false)
  expect(isModelRefSelectable(unavailableRef, second)).toBe(true)

  expect(isAgentInCatalog("build", [{ id: "build" }])).toBe(true)
  expect(isAgentInCatalog("missing", [{ id: "build" }])).toBe(false)
})
