import { useCallback, useEffect, useState } from "react"

import {
  ENGINE_CONNECTION_CHANGED,
  listConnections,
  type EngineProfileSummary,
} from "@/lib/connections"

export type EngineConnectionCheck =
  | { kind: "loading" | "configured" | "empty" }
  | { kind: "error"; message: string }

export function useEngineConnection() {
  const [check, setCheck] = useState<EngineConnectionCheck>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setCheck({ kind: "loading" })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    let ignore = false
    void listConnections().then(
      (next) => {
        if (!ignore) setCheck({ kind: next.active ? "configured" : "empty" })
      },
      (cause: Error) => {
        if (!ignore) setCheck({ kind: "error", message: cause.message })
      }
    )
    function onChange(event: Event) {
      ignore = true
      const active = (event as CustomEvent<EngineProfileSummary | null>).detail
      setCheck((previous) => {
        const kind = active ? "configured" : "empty"
        return previous.kind === kind ? previous : { kind }
      })
    }
    window.addEventListener(ENGINE_CONNECTION_CHANGED, onChange)
    return () => {
      ignore = true
      window.removeEventListener(ENGINE_CONNECTION_CHANGED, onChange)
    }
  }, [attempt])

  return { check, retry }
}
