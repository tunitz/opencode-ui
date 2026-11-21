import { describe, expect, test } from "bun:test"

import {
  isStaleServerCommand,
  mergeSlashCommands,
} from "../src/lib/commands"

// use-opencode transitively imports opencode.ts, which reads window at module
// load. Stub the minimum origin before the dynamic import (same pattern as the
// other controller-related tests); no live service or model call is made.
globalThis.window = { location: { origin: "http://localhost" } } as Window &
  typeof globalThis
const { isUnknownCommandError } = await import("../src/lib/use-opencode")

const serverCommand = (name: string) =>
  ({ name, description: `${name} command` }) as never

describe("catalog epoch stamping", () => {
  test("mergeSlashCommands stamps server entries with the current epoch", () => {
    const commands = mergeSlashCommands([serverCommand("deploy")], 9)
    const server = commands.find((command) => command.source === "server")
    expect(server?.catalogEpoch).toBe(9)

    const native = commands.filter((command) => command.source === "native")
    expect(native.length).toBeGreaterThan(0)
    expect(native.every((command) => command.catalogEpoch === 0)).toBe(true)
  })

  test("mergeSlashCommands defaults the epoch to zero for compatibility", () => {
    const commands = mergeSlashCommands([serverCommand("deploy")])
    expect(commands.find((command) => command.source === "server")?.catalogEpoch).toBe(0)
  })
})

describe("stale server command guard", () => {
  const fresh = {
    commandsStatus: "ready",
    commandsDirectory: "/work/project",
    catalogEpoch: 7,
    commands: [{ name: "deploy" }, { name: "review" }],
    commandName: "deploy",
    capturedEpoch: 7,
    directory: "/work/project",
  }

  test("accepts a command captured from the current, ready catalog", () => {
    expect(isStaleServerCommand(fresh)).toBe(false)
  })

  test("blocks a stale captured epoch", () => {
    expect(isStaleServerCommand({ ...fresh, capturedEpoch: 6 })).toBe(true)
  })

  test("blocks when the catalog is not ready", () => {
    for (const commandsStatus of ["idle", "loading", "error"]) {
      expect(isStaleServerCommand({ ...fresh, commandsStatus })).toBe(true)
    }
  })

  test("blocks when the catalog directory differs from the session directory", () => {
    expect(isStaleServerCommand({ ...fresh, commandsDirectory: "/other" })).toBe(true)
    expect(isStaleServerCommand({ ...fresh, directory: "/other" })).toBe(true)
  })

  test("blocks when the command name is missing from the catalog", () => {
    expect(isStaleServerCommand({ ...fresh, commandName: "removed" })).toBe(true)
  })
})

describe("unknown command error mapping", () => {
  test("isUnknownCommandError matches CommandNotFoundError tags", () => {
    expect(isUnknownCommandError({ _tag: "CommandNotFoundError" })).toBe(true)
    expect(isUnknownCommandError({ name: "CommandNotFoundError" })).toBe(true)
    expect(
      isUnknownCommandError(
        Object.assign(new Error("missing"), { _tag: "CommandNotFoundError" })
      )
    ).toBe(true)
    const named = new Error("missing")
    named.name = "CommandNotFoundError"
    expect(isUnknownCommandError(named)).toBe(true)
  })

  test("isUnknownCommandError rejects other errors", () => {
    expect(isUnknownCommandError({ _tag: "OtherError" })).toBe(false)
    expect(isUnknownCommandError(new Error("missing"))).toBe(false)
    expect(isUnknownCommandError("CommandNotFoundError")).toBe(false)
    expect(isUnknownCommandError(null)).toBe(false)
    expect(isUnknownCommandError(undefined)).toBe(false)
    expect(isUnknownCommandError({})).toBe(false)
  })
})

const controllerSource = await Bun.file(
  new URL("../src/lib/use-opencode.ts", import.meta.url)
).text()
const composerSource = await Bun.file(
  new URL("../src/components/composer.tsx", import.meta.url)
).text()

describe("catalog epoch lifecycle wiring", () => {
  test("exposes catalogEpoch on controller state", () => {
    expect(controllerSource).toContain("catalogEpoch: number")
    expect(controllerSource).toContain("const [catalogEpoch, setCatalogEpoch] = useState(0)")
  })

  test("increments the epoch on a successful command catalog fetch", () => {
    expect(controllerSource).toMatch(
      /setCommands\(response\.data\)[\s\S]{0,120}setCommandsStatus\("ready"\)[\s\S]{0,60}setCatalogEpoch\(\(current\) => current \+ 1\)/
    )
  })

  test("increments the epoch when clearing the catalog on directory change or disconnect", () => {
    expect(controllerSource).toMatch(
      /setCommandsDirectory\(targetDirectory\)[\s\S]{0,120}setCommandsStatus\("loading"\)[\s\S]{0,160}setCatalogEpoch\(\(current\) => current \+ 1\)/
    )
    expect(controllerSource).toMatch(
      /setCommandsDirectory\(null\)[\s\S]{0,320}setCatalogEpoch\(\(current\) => current \+ 1\)/
    )
  })

  test("increments the epoch on command.updated/config.updated and reloadConfiguration", () => {
    expect(controllerSource).toMatch(
      /event\.type === "command\.updated"[\s\S]{0,260}setCommandsReloadKey\(\(current\) => current \+ 1\)[\s\S]{0,80}setCatalogEpoch\(\(current\) => current \+ 1\)/
    )
    expect(controllerSource).toMatch(
      /await openCode\.location\.reload\(\)[\s\S]{0,160}setCatalogEpoch\(\(current\) => current \+ 1\)/
    )
  })

  test("executeCommand refreshes the catalog on an unknown command without retrying the POST", () => {
    expect(controllerSource).toContain("isUnknownCommandError(error)")
    expect(controllerSource).toContain(
      "The command is no longer available. The catalog was refreshed; choose the command again."
    )
    // The single session.command POST sits before the catch; the catch only
    // reloads the catalog and returns the error (no second POST).
    const postCount = controllerSource.match(/openCode\.session\.command\(/g) ?? []
    expect(postCount).toHaveLength(1)
  })
})

describe("composer guard wiring", () => {
  test("guards server submissions with the live catalog epoch and captured epoch", () => {
    expect(composerSource).toContain("mergeSlashCommands(nav.commands, nav.catalogEpoch)")
    expect(composerSource).toContain("isStaleServerCommand({")
    expect(composerSource).toContain("catalogEpoch: nav.catalogEpoch,")
    expect(composerSource).toContain("capturedEpoch,")
  })

  test("a blocked command reloads the catalog, clears the override and does not POST", () => {
    const blocked = composerSource.slice(
      composerSource.indexOf("isStaleServerCommand({"),
      composerSource.indexOf("const submitted = draft")
    )
    expect(blocked).toContain("nav.reloadCommands()")
    expect(blocked).toContain("serverCommandOverrideRef.current = null")
    expect(blocked).toContain("serverCommandEpochRef.current = null")
    expect(blocked).toContain("return")
    expect(blocked).not.toContain("nav.executeCommand(")
  })

  test("captures the epoch when activating a server command and passes it at submit", () => {
    expect(composerSource).toContain(
      "serverCommandEpochRef.current =\n        command.source === \"server\" ? command.catalogEpoch : null"
    )
    expect(composerSource).toContain(
      "await executeServerCommand(command, argumentsText, capturedEpoch)"
    )
  })
})
