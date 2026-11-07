import { expect, test } from "bun:test"
import {
  isWorktreeParentDirectoryValid,
  normalizeWorktreeParentDirectory,
  worktreeDisplayName,
  worktreeParentDirectoryPrefill,
} from "../src/lib/worktree-defaults.ts"
import {
  createDefaultPreferences,
  preferencesStorageKey,
  readStoredPreferences,
  resetGlobalDefaults,
  updateGlobalDefaults,
  writeStoredPreferences,
} from "../src/lib/web-ui-preferences.ts"

const origin = "https://example.test"
const version = "2.1.4"

test("worktree parent directory accepts only absolute values", () => {
  expect(normalizeWorktreeParentDirectory(" /home/me/worktrees ")).toBe("/home/me/worktrees")
  expect(normalizeWorktreeParentDirectory("")).toBeNull()
  expect(normalizeWorktreeParentDirectory("   ")).toBeNull()
  expect(normalizeWorktreeParentDirectory("relative/path")).toBeNull()
  expect(normalizeWorktreeParentDirectory("~/worktrees")).toBeNull()
  expect(normalizeWorktreeParentDirectory("//server/share")).toBeNull()
  expect(normalizeWorktreeParentDirectory("/tmp\nbad")).toBeNull()
  expect(normalizeWorktreeParentDirectory(null)).toBeNull()
  expect(isWorktreeParentDirectoryValid("")).toBe(true)
  expect(isWorktreeParentDirectoryValid("/tmp/worktrees")).toBe(true)
  expect(isWorktreeParentDirectoryValid("relative/path")).toBe(false)
})

test("create form prefill favors a per-creation override", () => {
  expect(worktreeParentDirectoryPrefill("/saved/worktrees")).toBe("/saved/worktrees")
  expect(worktreeParentDirectoryPrefill("/saved/worktrees", "/tmp/one-off")).toBe("/tmp/one-off")
  expect(worktreeParentDirectoryPrefill("/saved/worktrees", "")).toBe("")
  expect(worktreeParentDirectoryPrefill(null)).toBe("")
  expect(worktreeParentDirectoryPrefill("relative/path")).toBe("")
})

test("worktree display names use the final non-empty directory segment", () => {
  expect(worktreeDisplayName("/home/me/worktrees/feature-x")).toBe("feature-x")
  expect(worktreeDisplayName("/home/me/worktrees/feature-x/")).toBe("feature-x")
  expect(worktreeDisplayName("/home/me/worktrees//feature-x///")).toBe("feature-x")
  expect(worktreeDisplayName("C:\\work\\feature-x\\")).toBe("feature-x")
  expect(worktreeDisplayName("/")).toBe("/")
})

test("worktree default persists as a global browser preference and sanitizes invalid values", () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
  const defaults = createDefaultPreferences(origin, version)
  expect(defaults.global.worktreeParentDirectory).toBeNull()

  const saved = updateGlobalDefaults(defaults, {
    worktreeParentDirectory: "/home/me/worktrees",
  })
  expect(writeStoredPreferences(storage, saved)).toBe(true)
  expect(
    readStoredPreferences(storage, origin, version).preferences.global
      .worktreeParentDirectory
  ).toBe("/home/me/worktrees")

  const record = JSON.parse(values.get(preferencesStorageKey(origin, version)))
  record.global.worktreeParentDirectory = "relative/path"
  values.set(preferencesStorageKey(origin, version), JSON.stringify(record))
  expect(
    readStoredPreferences(storage, origin, version).preferences.global
      .worktreeParentDirectory
  ).toBeNull()

  expect(resetGlobalDefaults(saved).global.worktreeParentDirectory).toBeNull()
})
