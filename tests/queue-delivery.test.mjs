import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  canSteerInboxItem,
  inboxDeliveryLabel,
  promptDelivery,
} from "../src/lib/queue"
import { mergeRestoredDraft } from "../src/lib/composer-state"

test("queue is explicit during an active response and idle sends stay ordinary", () => {
  expect(promptDelivery(true, "queue")).toBe("queue")
  expect(promptDelivery(true, null)).toBe("steer")
  expect(promptDelivery(false, "queue")).toBeNull()
})

test("composer keeps queue in the plus menu without a separate button", async () => {
  const composer = await readFile(new URL("../src/components/composer.tsx", import.meta.url), "utf8")
  expect(composer).toContain('onClick={() => void submit("queue")}')
  expect(composer).toContain("Queue message")
  expect(composer).not.toContain('aria-label="Queue message"')
})

test("inbox delivery copy distinguishes waiting to steer from ordinary queue", () => {
  expect(inboxDeliveryLabel("queue")).toBe("Queued")
  expect(inboxDeliveryLabel("steer")).toBe("Waiting to steer")
})

test("steer action is offered only for the first, ordinarily queued user prompt", () => {
  const user = (delivery) => ({ type: "user", delivery })
  expect(canSteerInboxItem(user("queue"), 0)).toBe(true)
  expect(canSteerInboxItem(user("steer"), 0)).toBe(false)
  expect(canSteerInboxItem(user("queue"), 1)).toBe(false)
  expect(canSteerInboxItem({ type: "synthetic", delivery: "queue" }, 0)).toBe(false)
})

test("returning a queued prompt preserves both drafts and exact text", () => {
  expect(mergeRestoredDraft("", "  restored  ")).toBe("  restored  ")
  expect(mergeRestoredDraft("my note", "queued text")).toBe("my note\n\nqueued text")
  expect(mergeRestoredDraft("my note\n", "queued text")).toBe("my note\nqueued text")
  expect(mergeRestoredDraft("my note\n\n", "\nqueued text")).toBe("my note\n\n\nqueued text")
  expect(mergeRestoredDraft("my note", "")).toBe("my note")
})
