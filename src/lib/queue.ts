import type { SessionInboxInfo } from "@/lib/opencode"

export type PromptDelivery = "steer" | "queue"

/**
 * Delivery attached to a prompt. An idle/terminal run is always an ordinary
 * admission with no delivery field, even if a stale UI mode says queue/steer.
 * An active run defaults to explicit steer unless the user deliberately chose
 * queue.
 */
export function promptDelivery(
  activeRun: boolean,
  selected: PromptDelivery | null | undefined
): PromptDelivery | null {
  if (!activeRun) {
    return null
  }

  return selected ?? "steer"
}

export function nextInboxDelivery(
  current: PromptDelivery
): PromptDelivery {
  return current === "queue" ? "steer" : "queue"
}

export function inboxSummary(item: SessionInboxInfo): string {
  if (item.type === "user") {
    const text = item.payload.text.trim()
    return text || "Empty user message"
  }

  if (item.type === "synthetic") {
    return item.payload.description ?? item.payload.text ?? "Synthetic input"
  }

  return `Pending ${item.type} input`
}

export function inboxDeliveryLabel(delivery: PromptDelivery): string {
  return delivery === "queue" ? "Queued" : "Waiting to steer"
}

/**
 * Native delivery is a PATCH of the `delivery` field: it changes how the next
 * opportunity is handled and never reorders the queue. Offer the explicit
 * steer action only for the first, ordinarily queued user prompt; other items
 * keep their native place without a disabled action that implies reordering.
 */
export function canSteerInboxItem(
  item: SessionInboxInfo,
  index: number
): boolean {
  return index === 0 && item.type === "user" && item.delivery === "queue"
}
