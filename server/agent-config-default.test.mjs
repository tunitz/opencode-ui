import { expect, test } from "bun:test"
import { removeJsoncAgent, updateDefaultAgent } from "../server/agent-config.ts"

test("updateDefaultAgent sets the key while preserving comments and unrelated keys", () => {
  const source = `{
  "$schema": "https://opencode.ai/config.json",
  // keep this comment
  "model": "openai/gpt-6.1-terra",
  "default_agent": "build",
}
`
  const result = updateDefaultAgent(source, "agents-orchestrator")
  expect(result).toContain('"default_agent": "agents-orchestrator"')
  expect(result).toContain('"model": "openai/gpt-6.1-terra"')
  expect(result).toContain("// keep this comment")
})

test("updateDefaultAgent adds the key when absent", () => {
  const source = `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
  const result = updateDefaultAgent(source, "plan")
  expect(result).toContain('"default_agent": "plan"')
  expect(result).toContain('"$schema"')
})

test("updateDefaultAgent replaces an existing default", () => {
  const source = `{\n  "default_agent": "build"\n}\n`
  const result = updateDefaultAgent(source, "plan")
  expect(result).toContain('"default_agent": "plan"')
  expect(result).not.toContain('"default_agent": "build"')
})

test("updateDefaultAgent rejects invalid JSONC", () => {
  expect(() => updateDefaultAgent("{ not valid", "build")).toThrow()
})

test("updateDefaultAgent rejects non-object roots", () => {
  expect(() => updateDefaultAgent("[1,2,3]", "build")).toThrow()
})

test("removeJsoncAgent drops only the requested entry", () => {
  const source = `{
  "agents": {
    "keep": { "model": "openai/gpt-6.1-terra" },
    "remove": { "model": "commandcode/deepseek/deepseek-v4.1-flash" },
  },
}
`
  const result = removeJsoncAgent(source, "remove")
  expect(result).not.toContain('"remove"')
  expect(result).toContain('"keep"')
})

test("removeJsoncAgent leaves unrelated configuration untouched", () => {
  const source = `{
  // keep this comment
  "model": "openai/gpt-6.1-terra",
  "agents": { "gone": { "mode": "subagent" } },
  "default_agent": "build",
}
`
  const result = removeJsoncAgent(source, "gone")
  expect(result).not.toContain('"gone"')
  expect(result).toContain('"default_agent": "build"')
  expect(result).toContain("// keep this comment")
})

test("removeJsoncAgent returns the text unchanged when the agent is absent", () => {
  const source = `{\n  "agents": { "keep": {} }\n}\n`
  expect(removeJsoncAgent(source, "missing")).toBe(source)
  expect(removeJsoncAgent(`{\n  "model": "x"\n}\n`, "missing")).toBe(`{\n  "model": "x"\n}\n`)
})
