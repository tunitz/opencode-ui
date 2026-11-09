import type { LiveRun } from "@/lib/session-events"

type Listener = () => void

/**
 * Session-keyed live-run store.
 *
 * The SSE stream can deliver many text deltas per second. Keeping those runs in
 * the controller's React state re-rendered the whole app shell (header, session
 * sidebar, composer) once per delta even though only the conversation consumes
 * the token text. This store lets the conversation subscribe to a single
 * session's run while the shell stays untouched, and it notifies only the
 * listeners whose own session actually changed.
 */
export type LiveRunStore = {
  getRuns(): Record<string, LiveRun>
  getRun(sessionID: string | null | undefined): LiveRun | null
  /**
   * Apply a pure updater. Returning the same map is a no-op; otherwise only
   * sessions whose run reference changed are notified.
   */
  update(
    updater: (current: Record<string, LiveRun>) => Record<string, LiveRun>
  ): void
  subscribe(sessionID: string, listener: Listener): () => void
}

export function createLiveRunStore(): LiveRunStore {
  let runs: Record<string, LiveRun> = {}
  const listenersBySession = new Map<string, Set<Listener>>()
  const dirtySessions = new Set<string>()
  let notifyHandle: number | null = null

  const flush = () => {
    notifyHandle = null
    const sessions = [...dirtySessions]
    dirtySessions.clear()

    for (const sessionID of sessions) {
      const listeners = listenersBySession.get(sessionID)

      if (!listeners) {
        continue
      }

      // Copy so a listener that unsubscribes during notification cannot skip
      // another listener in the same pass.
      for (const listener of [...listeners]) {
        listener()
      }
    }
  }

  // Coalesce notifications to one per frame. A burst of stream frames must
  // not force one synchronous React commit per frame; commits are bounded by
  // the display refresh rate while the latest run is always in `runs`.
  const scheduleNotify = () => {
    if (notifyHandle !== null) {
      return
    }

    const visible =
      typeof document === "undefined" || document.visibilityState !== "hidden"

    if (visible && typeof requestAnimationFrame === "function") {
      notifyHandle = requestAnimationFrame(flush)
    } else {
      notifyHandle = setTimeout(flush, 16) as unknown as number
    }
  }

  return {
    getRuns() {
      return runs
    },
    getRun(sessionID) {
      return sessionID ? (runs[sessionID] ?? null) : null
    },
    update(updater) {
      const previous = runs
      const next = updater(previous)

      if (next === previous) {
        return
      }

      runs = next

      for (const sessionID of Object.keys(next)) {
        if (previous[sessionID] !== next[sessionID]) {
          dirtySessions.add(sessionID)
        }
      }

      for (const sessionID of Object.keys(previous)) {
        if (!(sessionID in next)) {
          dirtySessions.add(sessionID)
        }
      }

      if (dirtySessions.size > 0) {
        scheduleNotify()
      }
    },
    subscribe(sessionID, listener) {
      let listeners = listenersBySession.get(sessionID)

      if (!listeners) {
        listeners = new Set()
        listenersBySession.set(sessionID, listeners)
      }

      listeners.add(listener)

      return () => {
        listeners.delete(listener)

        if (listeners.size === 0) {
          listenersBySession.delete(sessionID)
        }
      }
    },
  }
}

/** App-wide live-run store; the stream writer and the conversation share it. */
export const liveRunStore = createLiveRunStore()
