import {
  parseSessionShortcuts,
  type SessionShortcut,
  type SessionShortcuts,
} from "@/lib/session-shortcuts"

const ROUTE = "/api/ui/session-shortcuts"

function normalize(value: unknown): SessionShortcuts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return parseSessionShortcuts(null)
  }
  return parseSessionShortcuts(JSON.stringify(value))
}

/** Read pins and labels shared by every browser through the app server. */
export async function readSessionShortcuts(): Promise<SessionShortcuts> {
  const response = await fetch(ROUTE, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error("Could not load session pins and labels.")
  const body = (await response.json()) as { shortcuts?: unknown }
  return normalize(body.shortcuts)
}

/** Persist one pin/label change and return the authoritative shared state. */
export async function updateSessionShortcutOnServer(
  id: string,
  change: Partial<SessionShortcut>
): Promise<SessionShortcuts> {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ id, change }),
  })
  if (!response.ok) throw new Error("Could not save session pins and labels.")
  const body = (await response.json()) as { shortcuts?: unknown }
  return normalize(body.shortcuts)
}
