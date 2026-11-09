import { useEffect, useMemo, useRef, useState } from "react"
import { MetricIndicatorInline } from "@openuidev/react-ui/MetricIndicator"
import { Tag } from "@openuidev/react-ui/Tag"
import "@openuidev/react-ui/styles/metricIndicator.css"
import "@openuidev/react-ui/styles/tag.css"
import "./openui-selective.css"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react"

import { ConnectDialog } from "@/components/connect-dialog"
import { StatsTokenChart } from "@/components/stats-token-chart"
import {
  CommandDialogShell,
  ErrorNotice,
} from "@/components/session-command-dialogs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  errorMessage,
  openCode,
  type McpResourceCatalog,
  type McpServer,
  type PluginInfo,
  type SessionStatsInfo,
  type WorktreeDirectory,
} from "@/lib/opencode"
import { isAbsoluteDirectory } from "@/lib/session-commands"
import {
  sanitizedClientDiagnostics,
} from "@/lib/integration-status"
import { mcpVisibleStatusError } from "@/lib/mcp-config"
import { buildStatsTokenChart } from "@/lib/stats-chart"
import { createWorktreeSession } from "@/lib/worktree-session"
import type { OpenCodeController } from "@/lib/use-opencode"
import {
  worktreeDisplayName,
} from "@/lib/worktree-defaults"

export type IntegrationCommandDialogKind =
  | "mcps"
  | "connect"
  | "worktrees"
  | "plugins"
  | "stats"
  | "reload"
  | "debug"

type Props = {
  nav: OpenCodeController
  kind: IntegrationCommandDialogKind
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
  worktreeProjectID?: string
  onSessionCreated?: () => void
}

function statusLabel(status: McpServer["status"]) {
  switch (status.status) {
    case "connected":
      return "Connected"
    case "pending":
      return "Pending"
    case "disabled":
      return "Disabled"
    case "failed":
      return "Failed"
    case "needs_auth":
      return "Sign in required"
  }
}

function McpsDialog({ nav, onClose }: Props) {
  const directory = nav.activeSession?.location.directory ?? nav.directory ?? null
  const [servers, setServers] = useState<McpServer[]>([])
  const [resources, setResources] = useState<McpResourceCatalog>({
    resources: [],
    templates: [],
  })
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    if (!directory) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      setResourceError(null)
      const [list, catalog] = await Promise.allSettled([
        openCode.mcp.list({ location: { directory } }),
        openCode.mcp.resource.catalog({ location: { directory } }),
      ])
      if (token !== request.current) return
      if (list.status === "fulfilled") {
        setServers(
          list.value.data.toSorted((left, right) =>
            left.name.localeCompare(right.name)
          )
        )
        setStatus("ready")
      } else {
        setError(
          "MCP status failed to load. Native details are hidden because MCP configuration can contain secret values."
        )
        setStatus("error")
      }
      if (catalog.status === "fulfilled") {
        setResources(catalog.value.data)
      } else {
        setResources({ resources: [], templates: [] })
        setResourceError(
          "The MCP resource catalog failed. Native details are hidden because MCP configuration can contain secret values."
        )
      }
    })
    return () => {
      request.current += 1
    }
  }, [directory, reloadKey])

  if (!directory) return null

  const resourceCount = resources.resources.length + resources.templates.length

  return (
    <CommandDialogShell
      title="MCP servers"
      description="Read-only native MCP status and resources for this project. This view does not add, remove, connect, or disconnect servers."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            onClick={() => setReloadKey((current) => current + 1)}
            disabled={status === "loading"}
          >
            {status === "loading" ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon aria-hidden="true" className="size-4" />
            )}
            Refresh
          </Button>
        </>
      }
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Loading MCP status…
        </p>
      ) : null}
      {status === "error" ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error}</p>
          <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
      {status === "ready" ? (
        <div className="space-y-4">
          <ul className="space-y-1.5" aria-label="MCP servers">
            {servers.map((server) => (
              <li key={server.name} className="rounded-lg border border-border p-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{server.name}</p>
                    <Tag className="app-openui-status" size="sm" variant={server.status.status === "connected" ? "success" : server.status.status === "failed" || server.status.status === "needs_auth" ? "danger" : "neutral"} text={statusLabel(server.status)} />
                    {server.status.status === "failed" || server.status.status === "needs_auth" ? (
                      <p className="text-[11px] text-muted-foreground">{mcpVisibleStatusError(server.status.status)}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
            {servers.length === 0 ? (
              <li className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
                No MCP servers configured for this project.
              </li>
            ) : null}
          </ul>
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-medium">Resources</h3>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {resourceCount}
              </span>
            </div>
            {resourceError ? (
              <p role="alert" className="mt-1 text-[11px] text-destructive">
                {resourceError}
              </p>
            ) : null}
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
              {resources.resources.map((resource) => (
                <li key={`resource:${resource.server}:${resource.uri}`} className="rounded-md px-2 py-1.5 text-[11px]">
                  <p className="font-medium">{resource.name}</p>
                  <p dir="ltr" className="truncate font-mono text-[10px] text-muted-foreground">
                    {resource.server} · {resource.uri}
                  </p>
                  {resource.description ? (
                    <p className="text-muted-foreground">{resource.description}</p>
                  ) : null}
                </li>
              ))}
              {resources.templates.map((template) => (
                <li key={`template:${template.server}:${template.uriTemplate}`} className="rounded-md px-2 py-1.5 text-[11px]">
                  <p className="font-medium">{template.name}</p>
                  <p dir="ltr" className="truncate font-mono text-[10px] text-muted-foreground">
                    {template.server} · {template.uriTemplate}
                  </p>
                </li>
              ))}
              {resourceCount === 0 ? (
                <li className="px-2 py-2 text-[11px] text-muted-foreground">
                  No resources or templates reported by connected servers.
                </li>
              ) : null}
            </ul>
            <p className="mt-1 text-[10px] text-muted-foreground">
              This 2.1.4 status API exposes server status and resources/templates; it does not
              enumerate MCP tools. Tool availability remains backend/runtime state.
            </p>
          </div>
        </div>
      ) : null}
    </CommandDialogShell>
  )
}

function WorktreesDialog({ nav, onClose, onResult, worktreeProjectID, onSessionCreated }: Props) {
  const projectID = worktreeProjectID ?? nav.activeSession?.projectID ?? nav.location?.project.id ?? null
  const [entries, setEntries] = useState<WorktreeDirectory[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [mode, setMode] = useState<"list" | "create">("list")
  const [name, setName] = useState("")
  const [branch, setBranch] = useState("")
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorktreeDirectory | null>(null)
  const [sessionDirectory, setSessionDirectory] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionCreateFailed, setSessionCreateFailed] = useState(false)
  const sessionPending = useRef(false)
  const [force, setForce] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const request = useRef(0)

  useEffect(() => {
    if (!projectID) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const list = await openCode.worktree.list({ projectID })
        if (token !== request.current) return
        setEntries(list)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [projectID, reloadKey])

  if (!projectID) return null
  const directory = directoryDraft ?? ""
  const invalidDirectory = directory.trim().length > 0 && !isAbsoluteDirectory(directory)

  function openCreate() {
    setDirectoryDraft(null)
    setMode("create")
  }

  async function create() {
    if (!projectID || creating || invalidDirectory) return
    setCreating(true)
    setError(null)
    try {
      await openCode.worktree.create({
        projectID,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(directory.trim() ? { directory: directory.trim() } : {}),
      })
      setName("")
      setBranch("")
      setDirectoryDraft(null)
      setMode("list")
      setReloadKey((current) => current + 1)
      onResult("Worktree created by the native backend.")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setCreating(false)
    }
  }

  async function refresh() {
    if (!projectID || refreshBusy) return
    setRefreshBusy(true)
    setError(null)
    try {
      await openCode.worktree.refresh({ projectID })
      setReloadKey((current) => current + 1)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setRefreshBusy(false)
    }
  }

  async function remove() {
    if (!projectID || !deleteTarget || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await openCode.worktree.remove({
        projectID,
        directory: deleteTarget.directory,
        force,
      })
      setDeleteTarget(null)
      setForce(false)
      setReloadKey((current) => current + 1)
      onResult("Worktree removed by the native backend.")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setDeleting(false)
    }
  }

  async function startSession(entry: WorktreeDirectory) {
    if (!projectID || sessionPending.current || nav.creating || nav.connection !== "connected") return
    sessionPending.current = true
    setSessionDirectory(entry.directory)
    setSessionError(null)
    setSessionCreateFailed(false)
    try {
      const result = await createWorktreeSession(entry.directory, projectID, nav.agents, nav.configEntries, nav.createSession, openCode.location)
      if (!result.created) {
        setSessionError(result.error)
        setSessionCreateFailed(result.error === "Session creation failed.")
        return
      }
      onSessionCreated?.()
      onResult("Session created in the worktree.")
      onClose()
    } catch (failure) {
      setSessionError(`Could not prepare session: ${errorMessage(failure)}`)
    } finally {
      sessionPending.current = false
      setSessionDirectory(null)
    }
  }

  return (
    <>
        <CommandDialogShell
          title="Worktrees"
          description="Manage worktrees for this project."
          pending={creating || refreshBusy || Boolean(sessionDirectory)}
          onClose={onClose}
          footer={
            <>
              <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose} disabled={creating || refreshBusy || Boolean(sessionDirectory)}>
                Close
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={() => void refresh()}
                disabled={refreshBusy || creating || Boolean(sessionDirectory)}
                aria-busy={refreshBusy}
              >
                {refreshBusy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCwIcon aria-hidden="true" className="size-4" />}
                Refresh
              </Button>
              {mode === "list" ? (
                <Button type="button" className="h-11 px-4" onClick={openCreate} disabled={creating || Boolean(sessionDirectory)}>
                  Create worktree
                </Button>
              ) : null}
            </>
          }
        >
          {mode === "create" ? (
            <div className="space-y-3 text-[12px]">
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-muted-foreground">
                Creating a worktree may run the project&apos;s setup script. Review the generated path before using it.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="worktree-name">Name</Label>
                <Input id="worktree-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional worktree name" className="h-11" disabled={creating} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="worktree-branch">Branch</Label>
                <Input id="worktree-branch" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Optional branch/ref" className="h-11 font-mono text-[12px]" dir="ltr" disabled={creating} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="worktree-directory">Parent directory</Label>
                <Input id="worktree-directory" value={directory} onChange={(event) => setDirectoryDraft(event.target.value)} placeholder="Optional absolute parent directory" className="h-11 font-mono text-[12px]" dir="ltr" disabled={creating} aria-invalid={invalidDirectory} />
                {invalidDirectory ? <p className="text-xs text-destructive">Use an absolute directory or leave this blank.</p> : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setMode("list")} disabled={creating}>Cancel</Button>
                <Button type="button" className="h-11 px-4" onClick={() => void create()} disabled={creating || invalidDirectory} aria-busy={creating}>
                  {creating ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <WrenchIcon aria-hidden="true" className="size-4" />}
                  Create
                </Button>
              </div>
              <ErrorNotice error={error} />
            </div>
          ) : (
            <div className="space-y-3">
              {status === "loading" ? (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                  Loading worktrees…
                </p>
              ) : null}
              {status === "error" ? (
                <div role="alert" className="space-y-2 text-xs text-destructive">
                  <p>{error}</p>
                  <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>Retry</Button>
                </div>
              ) : null}
              {status === "ready" ? (
                <ul className="space-y-1" aria-label="Project worktrees">
                  {entries.map((entry) => (
                    <li key={entry.directory} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border p-2">
                      <div className="min-w-0">
                        <p className="text-[12px] leading-5 font-medium break-words">
                          {worktreeDisplayName(entry.directory)}
                        </p>
                        <p dir="ltr" className="mt-0.5 font-mono text-[11px] leading-4 break-all text-muted-foreground">{entry.directory}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          className="size-11"
                          aria-label={`New session in ${entry.directory}`}
                          disabled={Boolean(sessionDirectory) || nav.creating || nav.connection !== "connected"}
                          aria-busy={sessionDirectory === entry.directory}
                          onClick={() => void startSession(entry)}
                        >
                          {sessionDirectory === entry.directory ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <PlusIcon aria-hidden="true" className="size-4" />}
                        </Button>
                        <Button type="button" variant="destructive" size="icon-lg" className="size-11 shrink-0" aria-label={`Remove ${entry.directory}`} disabled={Boolean(sessionDirectory)} onClick={() => { setForce(false); setDeleteTarget(entry) }}>
                          <Trash2Icon aria-hidden="true" className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                  {entries.length === 0 ? (
                    <li className="rounded-lg border border-border p-3 text-xs text-muted-foreground">No saved worktrees.</li>
                  ) : null}
                </ul>
              ) : null}
              <ErrorNotice error={mode === "list" ? error : null} />
              {sessionDirectory ? <p role="status" className="text-xs text-muted-foreground">Creating session…</p> : null}
              {!sessionDirectory && nav.connection !== "connected" ? <p role="status" className="text-xs text-muted-foreground">Reconnect to create a session.</p> : null}
              {sessionError ? <p role="alert" className="text-xs break-words text-destructive">{sessionCreateFailed ? nav.createError ?? sessionError : sessionError}</p> : null}
            </div>
          )}
        </CommandDialogShell>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove worktree?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the worktree{deleteTarget ? ` at ${deleteTarget.directory}` : ""}? This can remove its files. Sessions are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 rounded-lg border border-border p-2.5">
            <Checkbox id="worktree-force" checked={force} onCheckedChange={(checked) => setForce(checked === true)} disabled={deleting} />
            <Label htmlFor="worktree-force" className="text-[12px] font-normal leading-5">
              Force removal
              <span className="block text-[11px] text-muted-foreground">May discard uncommitted changes. Use only when intended.</span>
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} aria-busy={deleting} onClick={() => void remove()}>
              {deleting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
              Remove worktree
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PluginsDialog({ nav, onClose }: Props) {
  const directory = nav.activeSession?.location.directory ?? nav.directory ?? null
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    if (!directory) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const response = await openCode.plugin.list({ location: { directory } })
        if (token !== request.current) return
        setPlugins(response.data)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [directory, reloadKey])

  if (!directory) return null

  return (
    <CommandDialogShell
      title="Plugins"
      description="Read-only native plugin metadata for this project. This view does not install, update, or remove plugins."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)} disabled={status === "loading"}>
            {status === "loading" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCwIcon aria-hidden="true" className="size-4" />}
            Refresh
          </Button>
        </>
      }
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Loading plugin metadata…
        </p>
      ) : null}
      {status === "error" ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error}</p>
          <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>Retry</Button>
        </div>
      ) : null}
      {status === "ready" ? (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Plugin code can execute in the server. This view shows installed plugin metadata only;
            it does not change plugin packages or configuration.
          </p>
          <ul className="space-y-1" aria-label="Plugins">
            {plugins.map((plugin, index) => (
              <li key={plugin.id ?? `${plugin.source.type}:${index}`} className="rounded-lg border border-border p-2.5 text-[11px]">
                <div className="flex items-start gap-2">
                  {plugin.state.status === "active" ? (
                    <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-diff-added" />
                  ) : (
                    <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-diff-removed" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{plugin.id ?? plugin.source.type}</p>
                    <p dir="ltr" className="break-all font-mono text-[10px] text-muted-foreground">
                      {plugin.source.type === "package"
                        ? `${plugin.source.target}${plugin.source.version ? ` · ${plugin.source.version}` : ""}${plugin.source.outdated ? " · update available" : ""}`
                        : plugin.source.type === "local"
                          ? plugin.source.path
                          : plugin.source.type}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {plugin.state.status === "active" ? "Active" : `Failed: ${plugin.state.error}`}
                      {" · "}
                      {Object.entries(plugin.features)
                        .filter(([, enabled]) => enabled)
                        .map(([feature]) => feature)
                        .join(", ") || "no features"}
                    </p>
                  </div>
                </div>
              </li>
            ))}
            {plugins.length === 0 ? (
              <li className="rounded-lg border border-border p-3 text-xs text-muted-foreground">No plugins.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </CommandDialogShell>
  )
}

function number(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function StatsDialog({ onClose }: Props) {
  const [stats, setStats] = useState<SessionStatsInfo | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)
  const from = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), 0, 1).getTime()
  }, [])

  useEffect(() => {
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const value = await openCode.session.stats({
          from,
          to: Date.now(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          tools: "summary",
        })
        if (token !== request.current) return
        setStats(value)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [from, reloadKey])

  if (!stats) {
    return (
      <CommandDialogShell
        title="Usage statistics"
        description="Read-only native usage statistics for the current year."
        onClose={onClose}
        footer={<Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>}
      >
        {status === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Gathering native statistics…
          </p>
        ) : null}
        {status === "error" ? (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>{error}</p>
            <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>Retry</Button>
          </div>
        ) : null}
      </CommandDialogShell>
    )
  }

  const tools = stats.tools.mode === "summary" ? stats.tools.totals : null
  const tokenChart = buildStatsTokenChart(stats)
  return (
    <CommandDialogShell
      title="Usage statistics"
      description="Native usage totals for January 1 through now. Reported zero cost is not asserted to mean free."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)}>
            <RefreshCwIcon aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Sessions</dt><dd className="tabular-nums">{stats.sessions}</dd>
          <dt className="text-muted-foreground">Subagents</dt><dd className="tabular-nums">{stats.subagents}</dd>
          <dt className="text-muted-foreground">Prompts</dt><dd className="tabular-nums">{stats.prompts}</dd>
          <dt className="text-muted-foreground">Steps</dt><dd className="tabular-nums">{stats.steps}</dd>
          <dt className="text-muted-foreground">Active days</dt><dd className="tabular-nums">{stats.activeDays}</dd>
          <dt className="text-muted-foreground">Streak</dt><dd className="tabular-nums">{stats.streak} days</dd>
          <dt className="text-muted-foreground">Reported cost</dt><dd><MetricIndicatorInline className="app-openui-metric" value={`$${stats.cost.toFixed(2)} USD`} /></dd>
        </dl>
        <section>
          <h3 className="text-[12px] font-medium">Tokens</h3>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">Input</dt><dd className="tabular-nums">{number(stats.tokens.input)}</dd>
            <dt className="text-muted-foreground">Output</dt><dd className="tabular-nums">{number(stats.tokens.output)}</dd>
            <dt className="text-muted-foreground">Reasoning</dt><dd className="tabular-nums">{number(stats.tokens.reasoning)}</dd>
            <dt className="text-muted-foreground">Cache read</dt><dd className="tabular-nums">{number(stats.tokens.cache.read)}</dd>
            <dt className="text-muted-foreground">Cache write</dt><dd className="tabular-nums">{number(stats.tokens.cache.write)}</dd>
          </dl>
        </section>
        <section>
          <h3 className="text-[12px] font-medium">Tokens by model</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Native input and output token counts. Cost is not plotted; a
            reported zero cost can mean unavailable pricing, not free.
          </p>
          {tokenChart.chartRows.length > 0 ? (
            <div className="mt-2">
              <StatsTokenChart rows={tokenChart.chartRows} height={300} />
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
              No nonzero model token usage to chart. Native model totals remain
              listed below.
            </p>
          )}
          {tokenChart.invalidValues > 0 ? (
            <p role="alert" className="mt-2 text-[11px] text-destructive">
              Some native token values were invalid or missing and are shown as
              zero; the chart does not estimate them.
            </p>
          ) : null}
        </section>
        {tools ? (
          <section>
            <h3 className="text-[12px] font-medium">Tools</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {tools.calls} calls · {tools.succeeded} succeeded · {tools.failed} failed ·{" "}
              {tools.unfinished} unfinished
            </p>
          </section>
        ) : null}
        <section>
          <h3 className="text-[12px] font-medium">Models</h3>
          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {stats.models.map((entry) => (
              <li key={`${entry.model.providerID}/${entry.model.id}/${entry.model.variant ?? ""}`} className="rounded-md px-2 py-1.5 text-[11px]">
                <p dir="ltr" className="truncate font-mono">{entry.model.providerID}/{entry.model.id}{entry.model.variant ? ` · ${entry.model.variant}` : ""}</p>
                <p className="text-[10px] text-muted-foreground">
                  {entry.steps} steps · {number(entry.tokens.input)} input ·{" "}
                  {number(entry.tokens.output)} output · ${entry.cost.toFixed(2)} reported
                </p>
              </li>
            ))}
            {stats.models.length === 0 ? (
              <li className="px-2 py-2 text-[11px] text-muted-foreground">No model usage.</li>
            ) : null}
          </ul>
        </section>
        <p className="text-[10px] text-muted-foreground">
          Cost is the native reported value. Zero can mean no billable usage or unavailable pricing;
          it is not asserted to be free. Tokens are not fabricated or estimated.
        </p>
      </div>
    </CommandDialogShell>
  )
}

function ReloadDialog({ nav, onClose, onResult }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(null)
    const failure = await nav.reloadConfiguration()
    setPending(false)
    if (failure) {
      setError(failure)
      return
    }
    onResult("Configuration reloaded; project catalogs were refreshed.")
    onClose()
  }

  return (
    <CommandDialogShell
      title="Reload configuration"
      description="Rebuild every loaded OpenCode location. This is not an OS service restart."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" className="h-11 px-4" onClick={() => void confirm()} disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
            Reload configuration
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[12px]">
        <p>All loaded locations are shut down and rebuilt.</p>
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-muted-foreground">
          Pending permissions and forms are cancelled. Running sessions continue with fresh
          services at the next step boundary. The event stream may reconnect; catalogs are
          refreshed after success.
        </p>
        <ErrorNotice error={error} />
      </div>
    </CommandDialogShell>
  )
}

function DebugDialog({ nav, onClose, onResult }: Props) {
  const [copied, setCopied] = useState(false)
  const diagnostics = useMemo(
    () =>
      sanitizedClientDiagnostics({
        serverVersion: nav.serverVersion,
        connection: nav.connection,
        stream: nav.streamStatus,
        scope: nav.scope,
        online: typeof navigator === "undefined" ? null : navigator.onLine,
        projectsLoaded: nav.projects.length,
        sessionsLoaded: nav.sessions.length,
        hasActiveSession: Boolean(nav.activeSessionID),
        messagesLoaded: nav.messages.length,
        pendingPermissions: nav.pendingPermissions.length,
        pendingForms: nav.pendingForms.length,
        projectCommandsLoaded: nav.commands.length,
        terminalOpen: false,
      }),
    [
      nav.activeSessionID,
      nav.commands.length,
      nav.connection,
      nav.messages.length,
      nav.pendingForms.length,
      nav.pendingPermissions.length,
      nav.projects.length,
      nav.scope,
      nav.serverVersion,
      nav.sessions.length,
      nav.streamStatus,
    ]
  )

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable.")
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setCopied(true)
      onResult("Sanitized client diagnostics copied.")
    } catch (failure) {
      onResult(errorMessage(failure), false)
    }
  }

  return (
    <CommandDialogShell
      title="Client diagnostics"
      description="Sanitized client/network/state counts. No config, environment, prompts, or server heap dump."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>
          <Button type="button" className="h-11 px-4" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {Object.entries(diagnostics).map(([key, value]) => (
          <div key={key} className="col-span-2 grid grid-cols-[auto_1fr] gap-3">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 truncate font-mono text-[11px]">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </CommandDialogShell>
  )
}

export function IntegrationCommandDialogs({
  kind,
  nav,
  onClose,
  onResult,
  worktreeProjectID,
  onSessionCreated,
}: {
  kind: IntegrationCommandDialogKind | null
  nav: OpenCodeController
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
  worktreeProjectID?: string
  onSessionCreated?: () => void
}) {
  if (!kind) return null
  const props = { kind, nav, onClose, onResult, worktreeProjectID, onSessionCreated }
  switch (kind) {
    case "mcps":
      return <McpsDialog {...props} />
    case "connect":
      return <ConnectDialog {...props} />
    case "worktrees":
      return <WorktreesDialog {...props} />
    case "plugins":
      return <PluginsDialog {...props} />
    case "stats":
      return <StatsDialog {...props} />
    case "reload":
      return <ReloadDialog {...props} />
    case "debug":
      return <DebugDialog {...props} />
  }
}
