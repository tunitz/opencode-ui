import { useCallback, useEffect, useRef, useState } from "react"

import {
  ENGINE_CONNECTION_CHANGED,
  listConnections,
  type EngineProfileSummary,
} from "@/lib/connections"

export type ActiveConnection = {
  /** Saved profile id, or null when no engine is active / not yet resolved. */
  connectionId: string | null
  /** True once the initial connection lookup has settled. */
  ready: boolean
  /**
   * Increments on every real connection-change event. Unlike the slash-command
   * catalog epoch, unrelated catalog loads never change it, and A→B→A remains
   * distinguishable from staying on A.
   */
  generation: number
}

/**
 * The stable identity of the active OpenCode connection.
 *
 * Session pins and Notes are scoped to this id. It is deliberately a tiny,
 * dependency-free hook so both surfaces can consume the same value without a
 * provider that isolated fixtures and tests would have to mount.
 */
export function useActiveConnection(): ActiveConnection {
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [generation, setGeneration] = useState(0)
  // An explicit connection-changed event outranks the initial lookup: that
  // lookup can settle later and must never roll back to the previous profile.
  const eventReceived = useRef(false)

  const accept = useCallback((next: string | null, fromEvent = false) => {
    setReady(true)
    setConnectionId((current) => (current === next ? current : next))
    if (fromEvent) setGeneration((current) => current + 1)
  }, [])

  useEffect(() => {
    let ignore = false
    void listConnections().then(
      (state) => {
        if (!ignore && !eventReceived.current) {
          accept(state.active?.id ?? null)
        }
      },
      () => {
        if (!ignore && !eventReceived.current) accept(null)
      }
    )
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<EngineProfileSummary | null>).detail
      eventReceived.current = true
      accept(detail?.id ?? null, true)
    }
    window.addEventListener(ENGINE_CONNECTION_CHANGED, onChange)
    return () => {
      ignore = true
      window.removeEventListener(ENGINE_CONNECTION_CHANGED, onChange)
    }
  }, [accept])

  return { connectionId, ready, generation }
}
