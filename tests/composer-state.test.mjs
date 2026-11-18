import { expect, test } from "bun:test"
import { canSendPrompt, createSessionCompositionState, createSessionSubmissionLock } from "../src/lib/composer-state"

test("admissions block duplicates only in the same session", () => {
  const lock = createSessionSubmissionLock()
  expect(lock.acquire("A")).toBe(true)
  expect(lock.acquire("A")).toBe(false)
  expect(canSendPrompt({ hasSession: true, connected: true, modelReady: true, admissionPending: false, hasText: true })).toBe(true)
  expect(canSendPrompt({ hasSession: true, connected: true, modelReady: true, admissionPending: false, hasFiles: true })).toBe(true)
  expect(lock.acquire("B")).toBe(true)
  lock.release("A")
  expect(lock.acquire("B")).toBe(false)
  expect(lock.acquire("A")).toBe(true)
  lock.release("A")
  lock.release("B")
})

test("switching sessions resets composition and ignores late old-session events", () => {
  const composition = createSessionCompositionState()
  composition.switchTo("A")
  composition.start("A")
  expect(composition.isComposing("A")).toBe(true)
  composition.switchTo("B")
  expect(composition.isComposing("B")).toBe(false)
  composition.start("A")
  expect(composition.isComposing("B")).toBe(false)
  composition.start("B")
  composition.end("A")
  expect(composition.isComposing("B")).toBe(true)
  composition.end("B")
  expect(composition.isComposing("B")).toBe(false)
})
