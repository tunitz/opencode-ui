import { useEffect, useMemo, useRef, useState } from "react"

import { createAsyncCache } from "@/lib/async-cache"
import {
  errorMessage,
  openCode,
  type AgentInfo,
  type ConfigEntry,
  type ModelInfo,
} from "@/lib/opencode"
import { useActiveConnection } from "@/lib/use-active-connection"

export type TargetCatalogStatus = "idle" | "loading" | "ready" | "error"

export type TargetCatalog = {
  /** Directory the catalog belongs to; null before a destination is resolved. */
  directory: string | null
  /** Active engine profile the catalog was read from. */
  connection: string | null | undefined
  agents: AgentInfo[]
  configEntries: ConfigEntry[]
  models: ModelInfo[]
  /**
   * Engine-resolved default model for this location. It is the API default,
   * not a hardcoded model, and may carry a cost.
   */
  defaultModel: ModelInfo | null
  status: TargetCatalogStatus
  error: string | null
}

const ALL_PROJECTS_KEY = "__all_projects__"

const emptyCatalog: TargetCatalog = {
  directory: null,
  connection: undefined,
  agents: [],
  configEntries: [],
  models: [],
  defaultModel: null,
  status: "idle",
  error: null,
}

export const agentCatalogCache = createAsyncCache<AgentInfo[]>()
export const modelCatalogCache = createAsyncCache<ModelInfo[]>()
export const configCatalogCache = createAsyncCache<ConfigEntry[]>()
export const modelDefaultCache = createAsyncCache<ModelInfo | null>()

let activeConnection: string | null | undefined = undefined

/**
 * Namespace every catalog read by the active engine profile. Two connections
 * can expose the very same directory with different agents/models; entries
 * from one profile must never be served to another.
 */
export function catalogCacheKey(directory: string | null | undefined): string {
  const connection =
    activeConnection === undefined ? "pending" : activeConnection ?? "local"
  return `${connection}::${directory ?? ALL_PROJECTS_KEY}`
}

/** Switch the catalog namespace and drop every in-flight/stale entry. */
export function setCatalogConnection(
  connectionId: string | null | undefined
): void {
  if (activeConnection === connectionId) return
  activeConnection = connectionId
  agentCatalogCache.invalidate()
  modelCatalogCache.invalidate()
  configCatalogCache.invalidate()
  modelDefaultCache.invalidate()
}

function locationArg(directory: string) {
  return { location: { directory } }
}

/** Warm the destination catalogs without blocking the caller. */
export function prefetchTargetCatalog(directory: string | null): void {
  if (!directory) return
  const key = catalogCacheKey(directory)
  const arg = locationArg(directory)
  void agentCatalogCache
    .get(key, () => openCode.agent.list(arg).then((response) => response.data))
    .catch(() => {})
  void modelCatalogCache
    .get(key, () => openCode.model.list(arg).then((response) => response.data))
    .catch(() => {})
  void configCatalogCache
    .get(key, () => openCode.config.get(arg))
    .catch(() => {})
  void modelDefaultCache
    .get(key, () => openCode.model.default(arg).then((response) => response.data))
    .catch(() => {})
}

/**
 * Native Agent/Model/Config/Default catalog for the target project directory.
 *
 * Returns a catalog always tied to the requested directory and the active
 * connection. A previous project's (or profile's) catalog is never exposed
 * while the next one loads, so a new-session preview cannot resolve against
 * the wrong engine or folder.
 */
export function useTargetCatalog(directory: string | null): TargetCatalog {
  const { connectionId, ready: connectionReady } = useActiveConnection()
  // An unresolved profile lookup must not be treated as the local engine.
  const scopeConnection = connectionReady ? connectionId : undefined
  const [state, setState] = useState<TargetCatalog>(emptyCatalog)
  const request = useRef(0)

  // Keep the shared cache namespace in sync with the active profile. This runs
  // before the fetch effect below, so its cache keys use the new scope.
  useEffect(() => {
    setCatalogConnection(scopeConnection)
  }, [scopeConnection])

  useEffect(() => {
    const id = ++request.current

    if (!directory) {
      void Promise.resolve().then(() => {
        if (id !== request.current) return
        setState(emptyCatalog)
      })
      return
    }

    const key = catalogCacheKey(directory)
    const arg = locationArg(directory)
    void Promise.resolve().then(async () => {
      if (id !== request.current) return
      setState({
        directory,
        connection: scopeConnection,
        agents: [],
        configEntries: [],
        models: [],
        defaultModel: null,
        status: "loading",
        error: null,
      })

      const [agents, models, config, defaultModel] = await Promise.allSettled([
        agentCatalogCache.get(key, () =>
          openCode.agent.list(arg).then((response) => response.data)
        ),
        modelCatalogCache.get(key, () =>
          openCode.model.list(arg).then((response) => response.data)
        ),
        configCatalogCache.get(key, () => openCode.config.get(arg)),
        modelDefaultCache.get(key, () =>
          openCode.model.default(arg).then((response) => response.data)
        ),
      ])
      if (id !== request.current) return

      let error: string | null = null
      if (agents.status === "rejected") error = errorMessage(agents.reason)
      if (models.status === "rejected") error = error ?? errorMessage(models.reason)

      const ready =
        agents.status === "fulfilled" && models.status === "fulfilled"
      setState({
        directory,
        connection: scopeConnection,
        agents: agents.status === "fulfilled" ? agents.value : [],
        // Config and the engine default are advisory: a failed read falls back
        // to the raw agent order and to "no default model", never to a
        // hardcoded model.
        configEntries: config.status === "fulfilled" ? config.value : [],
        models: models.status === "fulfilled" ? models.value : [],
        defaultModel:
          defaultModel.status === "fulfilled" ? defaultModel.value : null,
        status: ready ? "ready" : "error",
        error,
      })
    })

    return () => {
      request.current += 1
    }
  }, [directory, scopeConnection])

  // The render after a directory/profile change still sees the previous state
  // until the effect runs. Treat that state as loading for the new target.
  return useMemo(() => {
    if (state.directory !== directory || state.connection !== scopeConnection) {
      return {
        ...emptyCatalog,
        status: directory ? "loading" : "idle",
      }
    }
    return state
  }, [state, directory, scopeConnection])
}
