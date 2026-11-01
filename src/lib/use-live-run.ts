import { useCallback, useSyncExternalStore } from "react"

import { liveRunStore } from "@/lib/live-run-store"
import type { LiveRun, LiveRunStatus } from "@/lib/session-events"

const noopUnsubscribe = () => {}

/** Subscribe to one session's live run. Null sessions never subscribe. */
export function useLiveRun(sessionID: string | null): LiveRun | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      sessionID
        ? liveRunStore.subscribe(sessionID, onStoreChange)
        : noopUnsubscribe,
    [sessionID]
  )

  return useSyncExternalStore(subscribe, () => liveRunStore.getRun(sessionID))
}

/**
 * Status-only subscription. Text deltas keep the same status, so a component
 * that only needs `running`/`submitting` does not re-render per token.
 */
export function useLiveRunStatus(
  sessionID: string | null
): LiveRunStatus | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      sessionID
        ? liveRunStore.subscribe(sessionID, onStoreChange)
        : noopUnsubscribe,
    [sessionID]
  )

  return useSyncExternalStore(
    subscribe,
    () => liveRunStore.getRun(sessionID)?.status ?? null
  )
}
