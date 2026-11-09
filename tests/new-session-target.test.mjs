import { expect, test } from "bun:test"

import { newSessionProjectError } from "../src/lib/new-session-target.ts"

test("worktree sessions stay bound to the project that owns the worktree", () => {
  expect(newSessionProjectError("project", "project")).toBeNull()
  expect(newSessionProjectError("other", "project")).toBe(
    "The selected worktree folder no longer belongs to this project."
  )
})

test("project validation does not invent an error before the folder resolves", () => {
  expect(newSessionProjectError(null, "project")).toBeNull()
  expect(newSessionProjectError("project")).toBeNull()
})
