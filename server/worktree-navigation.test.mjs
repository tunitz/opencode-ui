import { expect, test } from "bun:test"
import { worktreeNavigationProject } from "../src/lib/worktree-navigation.ts"

test("project navigation targets the selected project rather than a different active session", () => {
  expect(worktreeNavigationProject("project", "selected", "active")).toBe("selected")
  expect(worktreeNavigationProject("all", "selected", "active")).toBe("active")
  expect(worktreeNavigationProject("project", null, "active")).toBeNull()
  expect(worktreeNavigationProject("all", "selected", null)).toBeNull()
})
