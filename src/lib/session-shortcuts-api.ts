import {
  parseSessionShortcuts,
  type SessionShortcut,
  type SessionShortcuts,
  type ShortcutState,
} from "@/lib/session-shortcuts"

const ROUTE = "/api/ui/session-shortcuts"

function normalize(value: unknown): SessionShortcuts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return parseSessionShortcuts(null)
  }
  return parseSessionShortcuts(JSON.stringify(value))
}

function normalizeState(body: { shortcuts?: unknown; legacyCount?: unknown }): ShortcutState {
  return {
    shortcuts: normalize(body.shortcuts),
    legacyCount:
      typeof body.legacyCount === "number" && Number.isFinite(body.legacyCount)
        ? body.legacyCount
        : 0,
  }
}

function query(connectionId: string | null): string {
  return connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ""
}

/** Read pins and labels for one connection through the app server. */
export async function readSessionShortcuts(
  connectionId: string | null
): Promise<ShortcutState> {
  const response = await fetch(`${ROUTE}${query(connectionId)}`, {
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error("Could not load session pins and labels.")
  return normalizeState((await response.json()) as { shortcuts?: unknown; legacyCount?: unknown })
}

/** Persist one pin/label change and return the authoritative connection state. */
export async function updateSessionShortcutOnServer(
  connectionId: string | null,
  id: string,
  change: Partial<SessionShortcut>
): Promise<ShortcutState> {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ connectionId, id, change }),
  })
  if (!response.ok) throw new Error("Could not save session pins and labels.")
  return normalizeState((await response.json()) as { shortcuts?: unknown; legacyCount?: unknown })
}

/** Move preserved v1 pins/labels into the given connection. */
export async function assignLegacyShortcuts(
  connectionId: string
): Promise<ShortcutState> {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ action: "assignLegacy", connectionId }),
  })
  if (!response.ok) throw new Error("Could not save session pins and labels.")
  return normalizeState((await response.json()) as { shortcuts?: unknown; legacyCount?: unknown })
}
