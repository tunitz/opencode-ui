/** Browser-only session organization; no native session data is changed. */
export type SessionShortcut = { pinned: boolean; label: string }
export type SessionShortcuts = Record<string, SessionShortcut>
const MAX_ENTRIES = 500

export function shortcutStorageKey(origin: string, version: string) {
  return `opencode-ui:session-shortcuts:v1:${encodeURIComponent(origin)}:${encodeURIComponent(version)}`
}

export function parseSessionShortcuts(raw: string | null): SessionShortcuts {
  const result: SessionShortcuts = Object.create(null)
  if (!raw) return result
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) return result
    for (const [id, entry] of Object.entries(value).slice(0, MAX_ENTRIES)) {
      if (!id || id.length > 256 || ["__proto__", "constructor", "prototype"].includes(id)) continue
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const candidate = entry as Record<string, unknown>
      const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 60) : ""
      const pinned = candidate.pinned === true
      if (pinned || label) result[id] = { pinned, label }
    }
  } catch { /* Malformed or unavailable storage is treated as empty. */ }
  return result
}

export function updateSessionShortcut(state: SessionShortcuts, id: string, update: Partial<SessionShortcut>): SessionShortcuts {
  if (!id || id.length > 256 || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Invalid session ID")
  const next = { ...state }
  const previous = state[id] ?? { pinned: false, label: "" }
  const value = { ...previous, ...update, label: (update.label ?? previous.label).trim().slice(0, 60) }
  if (value.pinned || value.label) {
    if (!Object.hasOwn(state, id) && Object.keys(state).length >= MAX_ENTRIES) throw new Error("Session shortcut limit reached")
    next[id] = value
  }
  else delete next[id]
  return parseSessionShortcuts(JSON.stringify(next))
}

export const SHORTCUT_GROUPS = ["Needs attention (current session)", "Pinned", "Running", "New activity"] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

/** Priority avoids duplicate shortcuts; unread does not mean a permission is pending. */
export function groupSessionShortcuts<T extends { id: string }>(sessions: readonly T[], shortcuts: SessionShortcuts, running: Record<string, true>, unread: Record<string, true>, attentionSessionID: string | null = null): Record<ShortcutGroup, T[]> {
  const groups: Record<ShortcutGroup, T[]> = { "Needs attention (current session)": [], Pinned: [], Running: [], "New activity": [] }
  for (const session of sessions) {
    if (session.id === attentionSessionID) groups["Needs attention (current session)"].push(session)
    else if (shortcuts[session.id]?.pinned) groups.Pinned.push(session)
    else if (running[session.id]) groups.Running.push(session)
    else if (unread[session.id]) groups["New activity"].push(session)
  }
  return groups
}

/** Group entire loaded trees by their highest-priority member, never splitting a parent and child. */
export function groupSessionTreesByStatus<T extends { session: { id: string }; children: T[] }>(rows: readonly T[], shortcuts: SessionShortcuts, running: Record<string, true>, unread: Record<string, true>, attentionSessionID: string | null): Record<ShortcutGroup | "Other", T[]> {
  const result: Record<ShortcutGroup | "Other", T[]> = { "Needs attention (current session)": [], Pinned: [], Running: [], "New activity": [], Other: [] }
  function priority(row: T): number {
    const id = row.session.id
    let rank = id === attentionSessionID ? 0 : shortcuts[id]?.pinned ? 1 : running[id] ? 2 : unread[id] ? 3 : 4
    for (const child of row.children) rank = Math.min(rank, priority(child))
    return rank
  }
  const names = [...SHORTCUT_GROUPS, "Other"] as const
  for (const row of rows) result[names[priority(row)]].push(row)
  return result
}
