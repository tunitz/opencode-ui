import { useEffect, useMemo, useRef, useState } from "react"

import { createAsyncCache } from "@/lib/async-cache"
import {
  errorMessage,
  openCode,
  type AgentInfo,
  type ModelInfo,
} from "@/lib/opencode"

export type TargetCatalogStatus = "idle" | "loading" | "ready" | "error"

export type TargetCatalog = {
  agents: AgentInfo[]
  models: ModelInfo[]
  status: TargetCatalogStatus
  error: string | null
}

type CatalogState = TargetCatalog & { directory: string | null }

const emptyCatalog: CatalogState = {
  directory: null,
  agents: [],
  models: [],
  status: "idle",
  error: null,
}

export const agentCatalogCache = createAsyncCache<AgentInfo[]>()
export const modelCatalogCache = createAsyncCache<ModelInfo[]>()

/** Warm the per-directory catalogs without blocking the caller. */
export function prefetchTargetCatalog(directory: string | null): void {
  if (!directory) return
  const location = { location: { directory } }
  void agentCatalogCache
    .get(directory, () =>
      openCode.agent.list(location).then((response) => response.data)
    )
    .catch(() => {})
  void modelCatalogCache
    .get(directory, () =>
      openCode.model.list(location).then((response) => response.data)
    )
    .catch(() => {})
}

/**
 * Native Agent/Model catalog for the target project directory.
 *
 * The returned catalog is always tied to the requested directory. A previous
 * project's catalog is never exposed while the next project is loading, so a
 * new-session preview cannot resolve against the wrong project's models.
 */
export function useTargetCatalog(directory: string | null): TargetCatalog {
  const [state, setState] = useState<CatalogState>(emptyCatalog)
  const request = useRef(0)

  useEffect(() => {
    const id = ++request.current

    if (!directory) {
      void Promise.resolve().then(() => {
        if (id !== request.current) return
        setState(emptyCatalog)
      })
      return
    }

    void Promise.resolve().then(async () => {
      if (id !== request.current) return
      setState({
        directory,
        agents: [],
        models: [],
        status: "loading",
        error: null,
      })
      const [agentResult, modelResult] = await Promise.allSettled([
        agentCatalogCache.get(directory, () =>
          openCode
            .agent.list({ location: { directory } })
            .then((response) => response.data)
        ),
        modelCatalogCache.get(directory, () =>
          openCode
            .model.list({ location: { directory } })
            .then((response) => response.data)
        ),
      ])
      if (id !== request.current) return

      let agents: AgentInfo[] = []
      let models: ModelInfo[] = []
      let error: string | null = null
      if (agentResult.status === "fulfilled") {
        agents = agentResult.value
      } else {
        error = errorMessage(agentResult.reason)
      }
      if (modelResult.status === "fulfilled") {
        models = modelResult.value
      } else {
        error = error ?? errorMessage(modelResult.reason)
      }
      setState({
        directory,
        agents,
        models,
        status:
          agentResult.status === "fulfilled" &&
          modelResult.status === "fulfilled"
            ? "ready"
            : "error",
        error,
      })
    })
    return () => {
      request.current += 1
    }
  }, [directory])

  // The render after a directory change still sees the previous state until
  // the effect runs. Treat that state as loading for the new directory.
  // Memoized so unrelated re-renders of the host (e.g. a favorite toggle) reuse
  // the same catalog object and don't rebuild every downstream option list.
  return useMemo(() => {
    if (state.directory !== directory) {
      return {
        agents: [],
        models: [],
        status: directory ? "loading" : "idle",
        error: null,
      }
    }

    return {
      agents: state.agents,
      models: state.models,
      status: state.status,
      error: state.error,
    }
  }, [state, directory])
}
