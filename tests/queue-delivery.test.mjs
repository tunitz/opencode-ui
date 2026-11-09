import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { promptDelivery } from "../src/lib/queue"

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
