import { expect, test } from "bun:test"
import { primaryAgents } from "../src/lib/agent-list.ts"

test("primaryAgents keeps only visible primary agents in catalog order", () => {
  const agents = [
    { id: "build", mode: "primary", hidden: false },
    { id: "worker", mode: "subagent", hidden: false },
    { id: "hidden-primary", mode: "primary", hidden: true },
    { id: "all", mode: "all", hidden: false },
  ]
  expect(primaryAgents(agents).map((agent) => agent.id)).toEqual(["build"])
})
