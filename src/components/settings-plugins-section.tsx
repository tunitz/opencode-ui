/**
 * Settings > Plugins.
 *
 * Lists the engine plugins the UI server knows how to manage and registers or
 * removes them through the UI server (never by writing engine config).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { PlugIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NOTES_PLUGINS_CHANGED } from "@/lib/notes-plugin-state"

type PluginStatus = {
  id: string
  name: string
  description: string
  registered: boolean
  connected: boolean
  restartRequired: boolean
}

type PluginsState = {
  engineAvailable: boolean
  plugins: PluginStatus[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizePlugin(value: unknown): PluginStatus | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null
  const registered = value.registered === true
  const connected = value.connected === true
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name ? value.name : value.id,
    description: typeof value.description === "string" ? value.description : "",
    registered,
    connected,
    restartRequired: value.restartRequired === true && registered && !connected,
  }
}

function errorMessage(body: unknown, status: number): string {
  const error = isRecord(body) ? body.error : null
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : null
  if (code === "engine_unavailable")
    return "The OpenCode engine is unreachable. Start it, then refresh."
  if (code === "engine_rejected")
    return "The OpenCode engine rejected the plugin change."
  if (code === "auth_required" || code === "setup_required")
    return "Your session expired. Sign in again."
  if (isRecord(error) && typeof error.message === "string" && error.message)
    return error.message
  return status === 502
    ? "The OpenCode engine request failed. Try again."
    : "The plugin request failed. Try again."
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "The plugin request failed."
}

function StateChip({ plugin }: { plugin: PluginStatus }) {
  const label = plugin.connected
    ? "Connected"
    : plugin.registered
      ? "Registered"
      : "Not registered"
  const tone = plugin.connected
    ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
    : plugin.registered
      ? "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400"
      : "border-border text-muted-foreground"
  return (
    <span
      data-plugin-state={
        plugin.connected
          ? "connected"
          : plugin.registered
            ? "registered"
            : "not-registered"
      }
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  )
}

export function SettingsPluginsSection() {
  const [state, setState] = useState<PluginsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const request = useRef(0)
  // Distinguishes this section's own event from one raised elsewhere, so an
  // action re-reads once instead of twice.
  const selfChange = useRef(false)

  const load = useCallback(async () => {
    const token = ++request.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/ui/plugins", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(errorMessage(body, response.status))
      if (token !== request.current) return
      const record = isRecord(body) ? body : {}
      const plugins = Array.isArray(record.plugins)
        ? record.plugins
            .map((item) => normalizePlugin(item))
            .filter((item): item is PluginStatus => item !== null)
        : []
      setState({
        engineAvailable: record.engineAvailable !== false,
        plugins,
      })
    } catch (failure) {
      if (token !== request.current) return
      setState(null)
      setError(failureMessage(failure))
    } finally {
      if (token === request.current) setLoading(false)
    }
  }, [])

  const notifyChanged = useCallback(() => {
    if (
      typeof window === "undefined" ||
      typeof window.dispatchEvent !== "function"
    )
      return
    selfChange.current = true
    try {
      window.dispatchEvent(new Event(NOTES_PLUGINS_CHANGED))
    } finally {
      selfChange.current = false
    }
  }, [])

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function"
    )
      return
    const onChange = () => {
      if (selfChange.current) return
      void load()
    }
    window.addEventListener(NOTES_PLUGINS_CHANGED, onChange)
    return () => {
      if (typeof window.removeEventListener === "function")
        window.removeEventListener(NOTES_PLUGINS_CHANGED, onChange)
    }
  }, [load])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) void load()
    })
    return () => {
      active = false
    }
  }, [load])

  const toggle = useCallback(
    async (plugin: PluginStatus, enable: boolean) => {
      setBusyId(plugin.id)
      setActionError(null)
      let succeeded = false
      try {
        const response = await fetch(
          `/api/ui/plugins/${encodeURIComponent(plugin.id)}/${enable ? "enable" : "disable"}`,
          {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { accept: "application/json" },
          }
        )
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(errorMessage(body, response.status))
        succeeded = true
      } catch (failure) {
        setActionError(failureMessage(failure))
      } finally {
        setBusyId(null)
        // Let open Notes surfaces react before the engine state is re-read.
        if (succeeded) notifyChanged()
        // Always re-read: the engine is the source of truth after a change.
        await load()
      }
    },
    [load, notifyChanged]
  )

  const engineAvailable = state?.engineAvailable !== false
  const plugins = state?.plugins ?? []

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          Plugins run inside the OpenCode engine. Registering one here does not
          change the engine configuration files.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="size-11"
          disabled={loading || busyId !== null}
          aria-label={loading ? "Refreshing plugins" : "Refresh plugins"}
          title="Refresh plugins"
          onClick={() => void load()}
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="grid gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          <p>{error}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit"
            onClick={() => void load()}
          >
            Retry
          </Button>
        </div>
      )}

      {!loading && state && !engineAvailable && (
        <p
          role="status"
          className="rounded-lg border p-3 text-sm text-muted-foreground"
        >
          The OpenCode engine is unreachable, so plugin state cannot be read or
          changed. Start the engine, then refresh.
        </p>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

      {loading && !state ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading plugins…
        </p>
      ) : plugins.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No plugins available.</p>
      ) : (
        <ul aria-label="Plugins" className="divide-y rounded-lg border">
          {plugins.map((plugin) => {
            const busy = busyId === plugin.id
            const enable = !plugin.registered
            return (
              <li
                key={plugin.id}
                className="flex flex-wrap items-start justify-between gap-3 p-3"
              >
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlugIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="font-medium">{plugin.name}</span>
                    <StateChip plugin={plugin} />
                  </div>
                  {plugin.description && (
                    <p className="text-sm text-muted-foreground">
                      {plugin.description}
                    </p>
                  )}
                  {plugin.restartRequired && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Restart the OpenCode engine to apply.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant={enable ? "default" : "outline"}
                  className="h-11"
                  disabled={busy || loading || !engineAvailable}
                  aria-label={`${enable ? "Enable" : "Disable"} ${plugin.name}`}
                  onClick={() => void toggle(plugin, enable)}
                >
                  {busy
                    ? enable
                      ? "Enabling…"
                      : "Disabling…"
                    : enable
                      ? "Enable"
                      : "Disable"}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
