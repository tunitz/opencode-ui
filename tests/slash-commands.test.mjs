import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  filterSlashCommands,
  findSlashCommand,
  mergeSlashCommands,
  parseSlashInput,
  rankSlashCommand,
  resolveSlashSubmit,
  slashQuery,
} from "../src/lib/commands"

test("parseSlashInput matches native parseSlashHead for name-only input", () => {
  expect(parseSlashInput("/settings")).toEqual({ name: "settings", argumentsText: "" })
  expect(parseSlashInput("/q")).toEqual({ name: "q", argumentsText: "" })
  expect(parseSlashInput("settings")).toBeNull()
  expect(parseSlashInput("")).toBeNull()
})

test("parseSlashInput uses the first separator and preserves repeated whitespace", () => {
  expect(parseSlashInput("/rename  foo")).toEqual({ name: "rename", argumentsText: " foo" })
  expect(parseSlashInput("/rename \t  foo  bar ")).toEqual({
    name: "rename",
    argumentsText: "\t  foo  bar ",
  })
})

test("parseSlashInput accepts newline separators and keeps newline bytes", () => {
  expect(parseSlashInput("/rename\nfoo")).toEqual({ name: "rename", argumentsText: "foo" })
  expect(parseSlashInput("/btw first\nsecond")).toEqual({
    name: "btw",
    argumentsText: "first\nsecond",
  })
  expect(parseSlashInput("/btw\n\nsecond")).toEqual({ name: "btw", argumentsText: "\nsecond" })
})

test("parseSlashInput preserves CRLF bytes in arguments exactly", () => {
  expect(parseSlashInput("/rename  first\r\nsecond")).toEqual({
    name: "rename",
    argumentsText: " first\r\nsecond",
  })
  expect(parseSlashInput("/btw first\r\nsecond\r\n")).toEqual({
    name: "btw",
    argumentsText: "first\r\nsecond\r\n",
  })
})

test("slashQuery closes the picker on any whitespace, including newlines", () => {
  expect(slashQuery("/settings")).toBe("settings")
  expect(slashQuery("/rename foo")).toBeNull()
  expect(slashQuery("/rename\nfoo")).toBeNull()
  expect(slashQuery("settings")).toBeNull()
})

test("rankSlashCommand ranks exact names and aliases above fuzzy matches", () => {
  const commands = mergeSlashCommands([])
  const settings = findSlashCommand(commands, "settings")
  const models = findSlashCommand(commands, "models")
  const exit = findSlashCommand(commands, "q")
  expect(settings).not.toBeNull()
  expect(models).not.toBeNull()
  expect(exit).not.toBeNull()
  expect(rankSlashCommand(settings, "settings")).toBe(0)
  expect(rankSlashCommand(models, "settings")).toBe(1)
  expect(rankSlashCommand(exit, "q")).toBe(0)
})

test("filterSlashCommands puts exact name/alias matches first", () => {
  const commands = mergeSlashCommands([])
  for (const [query, expected] of [
    ["settings", "settings"],
    ["status", "status"],
    ["q", "exit"],
    ["help", "help"],
  ]) {
    expect(filterSlashCommands(commands, query)[0].name).toBe(expected)
  }
})

test("filterSlashCommands is deterministic and ranks both collision sources first", () => {
  const commands = mergeSlashCommands([
    { name: "status", description: "Project status command" },
  ])
  const first = filterSlashCommands(commands, "status")
  expect(first.map((command) => command.id)).toEqual(
    filterSlashCommands(commands, "status").map((command) => command.id)
  )
  expect(first.slice(0, 2).map((command) => command.source)).toEqual(["native", "server"])
  expect(first.slice(0, 2).every((command) => command.name === "status")).toBe(true)
  const firstFuzzy = first.findIndex((command) => command.name !== "status")
  expect(first.slice(firstFuzzy).every((command) => command.name !== "status")).toBe(true)
})

const baseSubmit = {
  isComposing: false,
  isTouch: false,
  pickerOpen: false,
}

test("resolveSlashSubmit routes prompts and commands", () => {
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "hello" })).toEqual({ kind: "literal-prompt" })
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "/settings" })).toEqual({ kind: "command" })
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "/rename some title" })).toEqual({ kind: "command" })
})

test("resolveSlashSubmit blocks leading-slash drafts with no command name", () => {
  for (const draft of ["/", "/   ", "/\t", "/\r", "/  help"]) {
    expect(resolveSlashSubmit({ ...baseSubmit, draft })).toEqual({
      kind: "picker-error",
      message: "Type a command name or clear the leading slash.",
    })
  }
})

test("resolveSlashSubmit preserves IME, touch and modified-Enter behavior", () => {
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "hello", isComposing: true })).toEqual({ kind: "composing" })
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "hello", viaKeyboardEnter: true, isTouch: true })).toEqual({ kind: "ignore" })
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "hello", viaKeyboardEnter: true, submitAllowed: false })).toEqual({ kind: "ignore" })
  // The Send button is not keyboard Enter, so touch users can still submit.
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "hello", isTouch: true })).toEqual({ kind: "literal-prompt" })
})

test("resolveSlashSubmit keeps the open-picker guard", () => {
  expect(resolveSlashSubmit({ ...baseSubmit, draft: "", pickerOpen: true })).toEqual({
    kind: "picker-error",
    message: "Choose a command or continue typing.",
  })
})

test("composer routes explicit submits through the shared decision helper", async () => {
  const composer = await readFile(new URL("../src/components/composer.tsx", import.meta.url), "utf8")
  expect(composer).toContain("resolveSlashSubmit(")
  expect(composer).toContain("applySubmitDecision(")
  expect(composer).toContain("event.key === \"Enter\" || event.key === \"Tab\"")
})

test("command execution passes skills and queues behind an active run", async () => {
  const controller = await readFile(new URL("../src/lib/use-opencode.ts", import.meta.url), "utf8")
  expect(controller).toContain("skills: skills.map((skill) => ({ id: skill.id }))")
  expect(controller).toContain('...(running ? { delivery: "queue" as const } : {})')
})
