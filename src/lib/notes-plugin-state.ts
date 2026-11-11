/**
 * Registry state for the Notes plugin.
 *
 * `GET /api/ui/plugins` is the source of truth: `registered === true` means the
 * Notes plugin is enabled. The notes API itself is served by this UI server,
 * independently of engine registration, so this module is deliberately
 * optimistic. `registered === false` is the only definitive "hide Notes"
 * signal. A transport or HTTP failure, a malformed response, or a registry that
 * omits the Notes entry yields `registered: null` (unknown), and consumers keep
 * the Notes surfaces visible rather than hiding them on a transient failure.
 *
 * One module-level store backs every consumer, so a single registry read serves
 * all mounted Notes surfaces. Reads are coalesced while one is in flight, and
 * the store re-reads on `opencode-ui:plugins-changed`.
 */
import { useSyncExternalStore } from "react"

export type NotesPluginState = {
  /** true: enabled. false: definitively disabled. null: unknown. */
  registered: boolean | null
  /** A definitive registry answer was read and parsed. */
  available: boolean
}

/** Dispatched by Settings after a plugin enable or disable succeeds. */
export const NOTES_PLUGINS_CHANGED = "opencode-ui:plugins-changed"

const UNKNOWN: NotesPluginState = { registered: null, available: false }

const subscribers = new Set<() => void>()
let state: NotesPluginState = UNKNOWN
let generation = 0
let inFlight: Promise<NotesPluginState> | null = null
let listening = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function getNotesPluginState(): NotesPluginState {
  return state
}

function publish(next: NotesPluginState) {
  if (
    state.registered === next.registered &&
    state.available === next.available
  )
    return
  state = next
  for (const subscriber of subscribers) subscriber()
}

/**
 * Read the registry once. A non-OK response is treated the same as a transport
 * failure: honest "unknown", never a reason to hide the Notes surfaces.
 */
export async function fetchNotesPluginState(): Promise<NotesPluginState> {
  try {
    const response = await fetch("/api/ui/plugins", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
    if (!response.ok) return UNKNOWN
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body.plugins)) return UNKNOWN
    const notes = body.plugins.find(
      (plugin) => isRecord(plugin) && plugin.id === "notes"
    )
    // A registry without a Notes entry does not prove the plugin is disabled.
    if (!isRecord(notes)) return UNKNOWN
    return { registered: notes.registered === true, available: true }
  } catch {
    return UNKNOWN
  }
}

/** Re-read the registry, sharing one request across concurrent callers. */
export function refreshNotesPluginState(): Promise<NotesPluginState> {
  if (inFlight) return inFlight
  const token = generation
  const request = fetchNotesPluginState()
    .then((next) => {
      if (token === generation) publish(next)
      return next
    })
    .finally(() => {
      if (token === generation) inFlight = null
    })
  inFlight = request
  return request
}

function onPluginsChanged() {
  void refreshNotesPluginState()
}

function attachWindowListener() {
  if (
    listening ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  )
    return
  listening = true
  window.addEventListener(NOTES_PLUGINS_CHANGED, onPluginsChanged)
}

function detachWindowListener() {
  if (!listening) return
  listening = false
  if (
    typeof window !== "undefined" &&
    typeof window.removeEventListener === "function"
  )
    window.removeEventListener(NOTES_PLUGINS_CHANGED, onPluginsChanged)
}

/**
 * Subscribe to the shared registry state. The first subscriber starts the read
 * and the plugins-changed listener; the last one drops the cached answer so a
 * later mount starts from "unknown" rather than a stale read.
 */
export function subscribeNotesPluginState(subscriber: () => void): () => void {
  subscribers.add(subscriber)
  if (subscribers.size === 1) {
    attachWindowListener()
    void refreshNotesPluginState()
  }
  return () => {
    if (!subscribers.delete(subscriber)) return
    if (subscribers.size > 0) return
    detachWindowListener()
    generation += 1
    inFlight = null
    state = UNKNOWN
  }
}

export function useNotesPluginState(): NotesPluginState {
  return useSyncExternalStore(
    subscribeNotesPluginState,
    getNotesPluginState,
    () => UNKNOWN
  )
}
