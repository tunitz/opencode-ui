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
  const settled = useRef(false)

  const accept = useCallback((next: string | null) => {
    settled.current = true
    setReady(true)
    setConnectionId((current) => (current === next ? current : next))
  }, [])

  useEffect(() => {
    let ignore = false
    void listConnections().then(
      (state) => {
        if (!ignore) accept(state.active?.id ?? null)
      },
      () => {
        if (!ignore) accept(null)
      }
    )
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<EngineProfileSummary | null>).detail
      accept(detail?.id ?? null)
    }
    window.addEventListener(ENGINE_CONNECTION_CHANGED, onChange)
    return () => {
      ignore = true
      window.removeEventListener(ENGINE_CONNECTION_CHANGED, onChange)
    }
  }, [accept])

  return { connectionId, ready }
}
