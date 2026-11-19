import { expect, test } from "bun:test"

import {
  compareRegistries,
  parseLocalRegistry,
  parseSlashDefinitions,
} from "../scripts/audit-slash-commands"

test("parses the local native slash registry including aliases", () => {
  const source = `
export const NATIVE_SLASH_COMMANDS: NativeSlashCommand[] = [
  { name: "help", aliases: [], action: "help" },
  { name: "sessions", aliases: ["resume", "continue"], action: "sessions" },
  { name: "exit", aliases: ["quit", "q"], action: "unsupported" },
]
`
  const registry = parseLocalRegistry(source)
  expect([...registry.names]).toEqual(["help", "sessions", "exit"])
  expect([...registry.aliases]).toEqual(["resume", "continue", "quit", "q"])
})

test("parses upstream slash registrations from TUI source", () => {
  const source = `
const commands = [
  { name: "session.list", slash: { name: "sessions", aliases: ["resume", "continue"] } },
  { name: "session.new", slash: { name: "new" } },
  { name: "prompt.editor", slash: { name: "editor" } },
]
`
  const registry = parseSlashDefinitions(source)
  expect([...registry.names].sort()).toEqual(["editor", "new", "sessions"])
  expect([...registry.aliases].sort()).toEqual(["continue", "resume"])
})

test("audit ignores excluded commands and reports forward-compatible extras", () => {
  const local = parseLocalRegistry(`
export const NATIVE_SLASH_COMMANDS = [
  { name: "help", aliases: [] },
  { name: "new", aliases: [] },
  { name: "usage", aliases: [] },
  { name: "exit", aliases: ["quit", "q"] },
]
`)
  const upstream = parseSlashDefinitions(`
slash: { name: "help" },
slash: { name: "new" },
slash: { name: "sessions", aliases: ["resume"] },
slash: { name: "editor" },
slash: { name: "exit", aliases: ["quit", "q"] },
`)
  const result = compareRegistries(local, upstream, "v2.3.2")

  expect(result.missingNames).toEqual(["sessions"])
  expect(result.missingAliases).toEqual(["resume"])
  expect(result.extraNames).toEqual(["usage"])
  // A newer command that this browser handles honestly does not fail an older
  // release audit; only missing upstream names/aliases do.
  expect(result.ok).toBe(false)
})

test("forward-compatible extras do not fail an otherwise complete audit", () => {
  const local = parseLocalRegistry(`
export const NATIVE_SLASH_COMMANDS = [
  { name: "help", aliases: [] },
  { name: "usage", aliases: [] },
  { name: "exit", aliases: ["quit", "q"] },
]
`)
  const upstream = parseSlashDefinitions(`slash: { name: "help" }`)
  const result = compareRegistries(local, upstream, "v2.1.4")
  expect(result.extraNames).toEqual(["usage"])
  expect(result.ok).toBe(true)
})
