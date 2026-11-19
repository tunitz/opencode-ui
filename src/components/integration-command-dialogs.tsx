import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import {
  HighlightsDialog,
  PairDialog,
  safeServerUrl,
  StatusDialog,
  UsageDialog,
} from "@/components/system-command-dialogs"
import {
  canonicalDirectory,
  DirectoryBrowser,
} from "@/components/directory-browser"
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
import { worktreeCache } from "@/lib/worktree-cache"
import { copyText } from "@/lib/clipboard"
import { projectBasename } from "@/lib/notes-types"
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
  | "status"
  | "pair"
  | "highlights"
  | "usage"

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

function parseAssignments(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }
  return result
}

/** Never echo raw native error/config bodies; redact entered values and bound length. */
function sanitizedNativeError(failure: unknown, secrets: readonly string[] = []): string {
  let message = errorMessage(failure)
  for (const secret of secrets) {
    if (secret.trim().length >= 3) message = message.split(secret).join("[redacted]")
  }
  message = message.replace(/\{[\s\S]{0,4000}?\}/g, "[details hidden]")
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

function McpsDialog({ nav, onClose, onResult }: Props) {
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
  const [mode, setMode] = useState<"list" | "add">("list")
  const [form, setForm] = useState({
    name: "",
    type: "local" as "local" | "remote",
    command: "",
    cwd: "",
    environment: "",
    url: "",
    headers: "",
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
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
  const busy = adding || removing || actionBusy !== null

  function resetForm() {
    setForm({
      name: "",
      type: "local",
      command: "",
      cwd: "",
      environment: "",
      url: "",
      headers: "",
    })
    setFormError(null)
  }

  async function addServer() {
    if (adding || !directory) return
    const name = form.name.trim()
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      setFormError("Use a server name of letters, digits, dots, dashes, or underscores.")
      return
    }
    const secrets = [form.command, form.cwd, form.environment, form.url, form.headers]
    let config:
      | {
          type: "local"
          command: string[]
          cwd?: string
          environment?: Record<string, string>
        }
      | { type: "remote"; url: string; headers?: Record<string, string> }
    if (form.type === "local") {
      const command = form.command.trim().split(/\s+/).filter(Boolean)
      if (command.length === 0) {
        setFormError("Enter the command (and arguments) to start the local server.")
        return
      }
      const environment = parseAssignments(form.environment)
      config = {
        type: "local",
        command,
        ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
        ...(Object.keys(environment).length > 0 ? { environment } : {}),
      }
    } else {
      const url = safeServerUrl(form.url.trim())
      if (!url) {
        setFormError("Enter a credential-free http(s) URL for the remote server.")
        return
      }
      const headers = parseAssignments(form.headers)
      config = {
        type: "remote",
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }
    }
    setAdding(true)
    setFormError(null)
    setError(null)
    try {
      await openCode.mcp.add({ server: name, location: { directory }, config })
      resetForm()
      setMode("list")
      setReloadKey((current) => current + 1)
      onResult(`MCP server ${name} added by the native backend.`)
    } catch (failure) {
      setFormError(sanitizedNativeError(failure, secrets))
    } finally {
      setAdding(false)
    }
  }

  async function act(server: string, kind: "connect" | "disconnect") {
    const key = `${kind}:${server}`
    if (actionBusy || !directory) return
    setActionBusy(key)
    setError(null)
    try {
      if (kind === "connect") {
        await openCode.mcp.connect({ server, location: { directory } })
      } else {
        await openCode.mcp.disconnect({ server, location: { directory } })
      }
      setReloadKey((current) => current + 1)
      onResult(`MCP server ${server} ${kind === "connect" ? "connected" : "disconnected"}.`)
    } catch (failure) {
      setError(sanitizedNativeError(failure, [server]))
    } finally {
      setActionBusy(null)
    }
  }

  async function removeServer() {
    if (!removeTarget || removing || !directory) return
    const server = removeTarget
    setRemoving(true)
    setError(null)
    try {
      await openCode.mcp.remove({ server, location: { directory } })
      setRemoveTarget(null)
      setReloadKey((current) => current + 1)
      onResult(`MCP server ${server} removed by the native backend.`)
    } catch (failure) {
      setError(sanitizedNativeError(failure, [server]))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <CommandDialogShell
        title="MCP servers"
        description="Native MCP status, resources, and bounded server management for this project."
        pending={busy}
        onClose={onClose}
        footer={
          <>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)} disabled={status === "loading" || busy}>
              {status === "loading" ? (
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon aria-hidden="true" className="size-4" />
              )}
              Refresh
            </Button>
            {mode === "list" ? (
              <Button type="button" className="h-11 px-4" onClick={() => { resetForm(); setMode("add") }} disabled={busy}>
                <PlusIcon aria-hidden="true" className="size-4" />
                Add server
              </Button>
            ) : null}
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
        {mode === "add" ? (
          <div className="space-y-3 text-[12px]">
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-muted-foreground">
              The server runs with the native backend&apos;s privileges. Values are sent once to the native add API and are not shown again.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name">Server name</Label>
              <Input id="mcp-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-11 font-mono text-[12px]" disabled={adding} />
            </div>
            <div className="flex gap-2">
              {(["local", "remote"] as const).map((type) => (
                <Button key={type} type="button" variant={form.type === type ? "secondary" : "outline"} className="h-11 px-4" onClick={() => setForm({ ...form, type })} disabled={adding} aria-pressed={form.type === type}>
                  {type === "local" ? "Local command" : "Remote URL"}
                </Button>
              ))}
            </div>
            {form.type === "local" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-command">Command and arguments</Label>
                  <Input id="mcp-command" value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} placeholder="npx -y some-mcp-server" className="h-11 font-mono text-[12px]" dir="ltr" disabled={adding} />
                  <p className="text-[10px] text-muted-foreground">Arguments are separated by whitespace.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-cwd">Working directory (optional)</Label>
                  <Input id="mcp-cwd" value={form.cwd} onChange={(event) => setForm({ ...form, cwd: event.target.value })} className="h-11 font-mono text-[12px]" dir="ltr" disabled={adding} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-environment">Environment (optional)</Label>
                  <Input id="mcp-environment" value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })} placeholder="KEY=value per line" className="h-11 font-mono text-[12px]" disabled={adding} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-url">Server URL</Label>
                  <Input id="mcp-url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://mcp.example.test/sse" className="h-11 font-mono text-[12px]" dir="ltr" disabled={adding} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-headers">Headers (optional)</Label>
                  <Input id="mcp-headers" value={form.headers} onChange={(event) => setForm({ ...form, headers: event.target.value })} placeholder="Header=value per line" className="h-11 font-mono text-[12px]" disabled={adding} />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-11 px-4" onClick={() => { resetForm(); setMode("list") }} disabled={adding}>Cancel</Button>
              <Button type="button" className="h-11 px-4" onClick={() => void addServer()} disabled={adding || !form.name.trim()} aria-busy={adding}>
                {adding ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
                Add server
              </Button>
            </div>
            <ErrorNotice error={formError} />
          </div>
        ) : status === "ready" ? (
          <div className="space-y-4">
            <ul className="space-y-1.5" aria-label="MCP servers">
              {servers.map((server) => (
                <li key={server.name} className="rounded-lg border border-border p-2.5">
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium">{server.name}</p>
                      <Tag className="app-openui-status" size="sm" variant={server.status.status === "connected" ? "success" : server.status.status === "failed" || server.status.status === "needs_auth" ? "danger" : "neutral"} text={statusLabel(server.status)} />
                      {server.status.status === "failed" || server.status.status === "needs_auth" ? (
                        <p className="text-[11px] text-muted-foreground">{mcpVisibleStatusError(server.status.status)}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => void act(server.name, server.status.status === "connected" ? "disconnect" : "connect")} disabled={busy} aria-busy={actionBusy === `connect:${server.name}` || actionBusy === `disconnect:${server.name}`}>
                        {server.status.status === "connected" ? "Disconnect" : "Connect"}
                      </Button>
                      <Button type="button" variant="destructive" className="h-11 px-3 text-xs" onClick={() => setRemoveTarget(server.name)} disabled={busy}>
                        <Trash2Icon aria-hidden="true" className="size-4" />
                        Remove
                      </Button>
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
            <ErrorNotice error={error} />
          </div>
        ) : null}
      </CommandDialogShell>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          if (!removing) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove MCP server?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {removeTarget ? `“${removeTarget}”` : "this server"} from this project&apos;s MCP configuration? Connected sessions lose its tools.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={removing} aria-busy={removing} onClick={() => void removeServer()}>
              {removing ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
              Remove server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type KnownProject = { id: string; directory: string; name: string }

/** Longest known project that contains this directory, if any. */
function resolveNearestProject(
  projects: KnownProject[],
  directory: string
): KnownProject | null {
  if (!directory.startsWith("/")) return null
  return (
    projects
      .filter(
        (project) =>
          project.directory === "/" ||
          directory === project.directory ||
          directory.startsWith(`${project.directory}/`)
      )
      .toSorted((left, right) => right.directory.length - left.directory.length)[0] ??
    null
  )
}

type WorktreeRowData = { directory: string; name: string }

const WORKTREE_INITIAL_LIMIT = 30

/** One worktree row; memoized so typing a directory path re-renders only the row whose selection changed. */
const WorktreeRow = memo(function WorktreeRow({
  row,
  projectID,
  disabled,
  removeDisabled,
  selected,
  onSelect,
  onRemove,
}: {
  row: WorktreeRowData
  projectID: string
  disabled: boolean
  removeDisabled: boolean
  selected: boolean
  onSelect: (directory: string, projectID: string) => void
  onRemove: (directory: string, projectID: string) => void
}) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center">
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-start font-normal whitespace-normal aria-pressed:bg-muted"
        disabled={disabled}
        aria-pressed={selected}
        data-worktree-worktree={row.directory}
        onClick={() => onSelect(row.directory, projectID)}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium" dir="auto">
            {row.name}
          </span>
          <span className="truncate text-xs text-muted-foreground" dir="auto" title={row.directory}>
            {row.directory}
          </span>
        </span>
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="icon-lg"
        className="size-11 shrink-0"
        aria-label={`Remove ${row.directory}`}
        disabled={removeDisabled}
        onClick={() => onRemove(row.directory, projectID)}
      >
        <Trash2Icon aria-hidden="true" className="size-4" />
      </Button>
    </li>
  )
})

function WorktreesDialog({ nav, onClose, onResult, worktreeProjectID, onSessionCreated }: Props) {
  // The sessions list already groups by project, so its canonical directories
  // are the authoritative known-project list here. A failed project load leaves
  // this empty and the browser says so instead of guessing.
  const projects = useMemo<KnownProject[]>(() => {
    const seen = new Set<string>()
    const rows: KnownProject[] = []
    for (const project of nav.projects) {
      const directory = canonicalDirectory(project.canonical)
      if (!directory || seen.has(directory)) continue
      seen.add(directory)
      rows.push({ id: project.id, directory, name: projectBasename(directory) })
    }
    return rows.toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.directory.localeCompare(right.directory)
    )
  }, [nav.projects])
  const preferredProjectID =
    worktreeProjectID ?? nav.activeSession?.projectID ?? nav.location?.project.id ?? null
  const preferredProject =
    projects.find((project) => project.id === preferredProjectID) ?? null

  const [directoryValue, setDirectoryValue] = useState(
    () => preferredProject?.directory ?? ""
  )
  const [browse, setBrowse] = useState(() => preferredProject?.directory ?? "/")
  const [entries, setEntries] = useState<WorktreeDirectory[]>([])
  const [entriesProjectID, setEntriesProjectID] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    preferredProject ? "loading" : "idle"
  )
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [mode, setMode] = useState<"list" | "create">("list")
  const [name, setName] = useState("")
  const [branch, setBranch] = useState("")
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    directory: string
    projectID: string
  } | null>(null)
  const [sessionDirectory, setSessionDirectory] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionCreateFailed, setSessionCreateFailed] = useState(false)
  const sessionPending = useRef(false)
  const [force, setForce] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showAllWorktrees, setShowAllWorktrees] = useState(false)
  const request = useRef(0)
  const [sourceProjectID, setSourceProjectID] = useState<string | null>(
    preferredProject?.id ?? null
  )

  const trimmed = directoryValue.trim()
  const typedDirectory = canonicalDirectory(directoryValue)
  const absolute = trimmed.length > 0 && isAbsoluteDirectory(trimmed)
  const invalidAbsolute = trimmed.length > 0 && !isAbsoluteDirectory(trimmed)

  // The contextual list follows whichever project the input resolves to; a
  // selected worktree keeps its project when the path sits outside that prefix.
  const resolvedProject = useMemo(
    () => resolveNearestProject(projects, typedDirectory),
    [projects, typedDirectory]
  )
  // One active project drives the worktree list, Create/Refresh and the
  // "New session here" target. sourceProjectID is only a fallback while the
  // input is empty or outside every known project.
  const activeProject = absolute ? resolvedProject : null
  const activeSourceProjectID = activeProject?.id ?? sourceProjectID

  useEffect(() => {
    if (!activeSourceProjectID) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const list = (await worktreeCache.get(activeSourceProjectID, () =>
          openCode.worktree.list({ projectID: activeSourceProjectID })
        )) as Awaited<ReturnType<typeof openCode.worktree.list>>
        if (token !== request.current) return
        setEntries(list)
        setEntriesProjectID(activeSourceProjectID)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setEntries([])
        setEntriesProjectID(activeSourceProjectID)
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [activeSourceProjectID, reloadKey])

  const sourceProject =
    projects.find((project) => project.id === activeSourceProjectID) ?? null
  // Entries from a previous project must never be shown for the current one.
  const entriesMatch =
    activeSourceProjectID !== null && entriesProjectID === activeSourceProjectID
  const worktreeStatus =
    activeSourceProjectID && !entriesMatch ? "loading" : status

  // The base directory is rendered by the browser, and duplicate API rows are
  // dropped so the list never repeats a path.
  const worktreeRows = useMemo(() => {
    if (!sourceProject || !entriesMatch) return []
    const seen = new Set<string>()
    const rows: { directory: string; name: string }[] = []
    for (const entry of entries) {
      if (!entry.directory) continue
      const canonical = canonicalDirectory(entry.directory)
      if (canonical === sourceProject.directory) continue
      if (seen.has(canonical)) continue
      seen.add(canonical)
      rows.push({
        directory: entry.directory,
        name: worktreeDisplayName(entry.directory),
      })
    }
    return rows
  }, [entries, entriesMatch, sourceProject])

  const handleWorktreeSelect = useCallback((directory: string, projectID: string) => {
    setSourceProjectID(projectID)
    setDirectoryValue(directory)
    setBrowse(canonicalDirectory(directory))
  }, [])
  const handleWorktreeRemove = useCallback((directory: string, projectID: string) => {
    setForce(false)
    setDeleteTarget({ directory, projectID })
  }, [])
  const visibleWorktreeRows = showAllWorktrees
    ? worktreeRows
    : worktreeRows.slice(0, WORKTREE_INITIAL_LIMIT)
  const hiddenWorktreeCount = worktreeRows.length - visibleWorktreeRows.length

  // createWorktreeSession resolves a directory to its own project and rejects a
  // mismatch, so a custom path is bound to the nearest known project prefix.
  const target = useMemo(
    () =>
      activeProject
        ? { projectID: activeProject.id, directory: typedDirectory }
        : null,
    [activeProject, typedDirectory]
  )

  const unbrowsedTarget =
    absolute && !target ? "No project matches this path." : null

  function openCreate() {
    if (!activeProject) return
    setDirectoryDraft(null)
    setMode("create")
  }

  async function create() {
    if (!activeProject || creating || invalidDirectory) return
    setCreating(true)
    setError(null)
    try {
      await openCode.worktree.create({
        projectID: activeProject.id,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(directory.trim() ? { directory: directory.trim() } : {}),
      })
      setName("")
      setBranch("")
      setDirectoryDraft(null)
      setMode("list")
      worktreeCache.invalidate(activeProject.id)
      setReloadKey((current) => current + 1)
      onResult("Worktree created by the native backend.")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setCreating(false)
    }
  }

  async function refresh() {
    if (!activeProject || refreshBusy) return
    setRefreshBusy(true)
    setError(null)
    try {
      await openCode.worktree.refresh({ projectID: activeProject.id })
      worktreeCache.invalidate(activeProject.id)
      setReloadKey((current) => current + 1)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setRefreshBusy(false)
    }
  }

  async function remove() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await openCode.worktree.remove({
        projectID: deleteTarget.projectID,
        directory: deleteTarget.directory,
        force,
      })
      setDeleteTarget(null)
      setForce(false)
      worktreeCache.invalidate(deleteTarget.projectID)
      setReloadKey((current) => current + 1)
      onResult("Worktree removed by the native backend.")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setDeleting(false)
    }
  }

  async function startSession() {
    if (!target || sessionPending.current || nav.creating || nav.connection !== "connected") return
    sessionPending.current = true
    setSessionDirectory(target.directory)
    setSessionError(null)
    setSessionCreateFailed(false)
    try {
      const result = await createWorktreeSession(
        target.directory,
        target.projectID,
        nav.agents,
        nav.configEntries,
        nav.createSession,
        openCode.location
      )
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

  const directory = directoryDraft ?? ""
  const invalidDirectory = directory.trim().length > 0 && !isAbsoluteDirectory(directory)
  const busy = creating || refreshBusy || Boolean(sessionDirectory)

  return (
    <>
      <CommandDialogShell
        title="Worktrees"
        description="Choose a project directory, then browse, manage, and start a session in its worktrees."
        pending={busy}
        onClose={onClose}
        initialFocusContent
        footer={
          <>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose} disabled={busy}>
              Close
            </Button>
            {mode === "list" ? (
              <Button
                type="button"
                className="h-11 px-4"
                onClick={() => void startSession()}
                disabled={!target || creating || Boolean(sessionDirectory) || nav.creating || nav.connection !== "connected"}
                aria-busy={sessionDirectory !== null}
              >
                {sessionDirectory ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <PlusIcon aria-hidden="true" className="size-4" />}
                New session here
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
          <div className="space-y-4">
            <DirectoryBrowser
              id="worktree-browser-directory"
              label="Project or worktree directory"
              value={directoryValue}
              onChange={setDirectoryValue}
              initialBrowse={browse}
              browse={browse}
              onBrowseChange={setBrowse}
              placeholder="Search or type an absolute path"
              disabled={creating || Boolean(sessionDirectory)}
              error={
                invalidAbsolute
                  ? "Use an absolute path starting with /."
                  : null
              }
              hint={unbrowsedTarget ?? undefined}
              optionsLabel="Directories"
            />

            <section className="space-y-2" aria-label="Worktrees">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[12px] font-medium">Worktrees</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-3 text-xs"
                    onClick={() => void refresh()}
                    disabled={!activeProject || refreshBusy || creating || Boolean(sessionDirectory)}
                    aria-busy={refreshBusy}
                  >
                    {refreshBusy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCwIcon aria-hidden="true" className="size-4" />}
                    Refresh
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-3 text-xs"
                    onClick={openCreate}
                    disabled={!activeProject || creating || Boolean(sessionDirectory)}
                  >
                    Create worktree
                  </Button>
                </div>
              </div>

              {!activeProject ? (
                <p className="text-xs text-muted-foreground">
                  No worktrees for this directory.
                </p>
              ) : worktreeStatus === "loading" ? (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                  Loading worktrees…
                </p>
              ) : worktreeStatus === "error" ? (
                <div role="alert" className="space-y-2 text-xs text-destructive">
                  <p className="break-words">{error}</p>
                  <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>
                    Retry
                  </Button>
                </div>
              ) : worktreeRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No saved worktrees.</p>
              ) : (
                <>
                  <ul aria-label="Project worktrees" className="min-w-0 divide-y divide-border rounded-lg border border-border">
                    {visibleWorktreeRows.map((row) => (
                      <WorktreeRow
                        key={row.directory}
                        row={row}
                        projectID={activeProject.id}
                        disabled={creating || Boolean(sessionDirectory)}
                        removeDisabled={Boolean(sessionDirectory) || deleting}
                        selected={typedDirectory === canonicalDirectory(row.directory)}
                        onSelect={handleWorktreeSelect}
                        onRemove={handleWorktreeRemove}
                      />
                    ))}
                  </ul>
                  {hiddenWorktreeCount > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p role="status" className="text-[11px] text-muted-foreground">
                        Showing {visibleWorktreeRows.length} of {worktreeRows.length} worktrees.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 px-3 text-xs"
                        onClick={() => setShowAllWorktrees(true)}
                      >
                        Show all {worktreeRows.length} worktrees
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {sessionDirectory ? <p role="status" className="text-xs text-muted-foreground">Creating session…</p> : null}
            {!sessionDirectory && nav.connection !== "connected" ? <p role="status" className="text-xs text-muted-foreground">Reconnect to create a session.</p> : null}
            {sessionError ? <p role="alert" className="text-xs break-words text-destructive">{sessionCreateFailed ? nav.createError ?? sessionError : sessionError}</p> : null}
            <ErrorNotice error={mode === "list" ? error : null} />
          </div>
        )}
      </CommandDialogShell>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          if (!deleting) setDeleteTarget(null)
        }}
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

function PluginsDialog({ nav, onClose, onResult }: Props) {
  const directory = nav.activeSession?.location.directory ?? nav.directory ?? null
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updateTarget, setUpdateTarget] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    if (!directory) return
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      setChecked(false)
      try {
        const response = await openCode.plugin.list({ location: { directory } })
        if (token !== request.current) return
        setPlugins(response.data)
        setStatus("ready")
      } catch (failure) {
        if (token !== request.current) return
        setError(sanitizedNativeError(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [directory, reloadKey])

  if (!directory) return null

  const busy = checking || updating

  async function checkForUpdates() {
    if (busy || !directory) return
    setChecking(true)
    setError(null)
    try {
      const response = await openCode.plugin.check({ location: { directory } })
      setPlugins(response.data)
      setChecked(true)
      const outdated = response.data.filter(
        (plugin) => plugin.source.type === "package" && plugin.source.outdated
      ).length
      onResult(
        outdated > 0
          ? `Update check complete: ${outdated} plugin${outdated === 1 ? "" : "s"} with updates available.`
          : "Update check complete: no plugin updates available."
      )
    } catch (failure) {
      setError(sanitizedNativeError(failure))
    } finally {
      setChecking(false)
    }
  }

  async function applyUpdate() {
    if (!updateTarget || updating || !directory) return
    const target = updateTarget
    setUpdating(true)
    setError(null)
    try {
      await openCode.plugin.update({ location: { directory }, targets: [target] })
      setUpdateTarget(null)
      const response = await openCode.plugin.list({ location: { directory } })
      setPlugins(response.data)
      onResult(`Updated ${target} through the native plugin API.`)
    } catch (failure) {
      setError(sanitizedNativeError(failure, [target]))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
      <CommandDialogShell
        title="Plugins"
        description="Native plugin metadata and confirmed updates for this project."
        pending={busy}
        onClose={onClose}
        footer={
          <>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose} disabled={busy}>Close</Button>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)} disabled={status === "loading" || busy}>
              {status === "loading" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCwIcon aria-hidden="true" className="size-4" />}
              Refresh
            </Button>
            <Button type="button" className="h-11 px-4" onClick={() => void checkForUpdates()} disabled={status !== "ready" || busy} aria-busy={checking}>
              {checking ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
              Check for updates
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
              Plugin code can execute in the server. Updates are applied by the native backend after confirmation.
            </p>
            {checked ? (
              <p role="status" className="text-[11px] text-muted-foreground">
                Update check finished for server {nav.serverVersion ?? "version unknown"}. Only confirmed outdated plugins offer an update action.
              </p>
            ) : null}
            <ul className="space-y-1" aria-label="Plugins">
              {plugins.map((plugin, index) => {
                const packageSource = plugin.source.type === "package" ? plugin.source : null
                const canUpdate = Boolean(packageSource?.outdated)
                const target = packageSource?.target ?? plugin.id ?? null
                return (
                  <li key={plugin.id ?? `${plugin.source.type}:${index}`} className="rounded-lg border border-border p-2.5 text-[11px]">
                    <div className="flex min-w-0 flex-wrap items-start gap-2">
                      {plugin.state.status === "active" ? (
                        <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-diff-added" />
                      ) : (
                        <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-diff-removed" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{plugin.id ?? plugin.source.type}</p>
                        <p dir="ltr" className="break-all font-mono text-[10px] text-muted-foreground">
                          {packageSource
                            ? `${packageSource.target}${packageSource.version ? ` · ${packageSource.version}` : ""}${packageSource.outdated ? " · update available" : ""}`
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
                      {canUpdate && target ? (
                        <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setUpdateTarget(target)} disabled={busy}>
                          Update
                        </Button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
              {plugins.length === 0 ? (
                <li className="rounded-lg border border-border p-3 text-xs text-muted-foreground">No plugins.</li>
              ) : null}
            </ul>
            <p className="text-[10px] text-muted-foreground">
              The {nav.serverVersion ?? "running"} plugin protocol exposes check and update only; install and remove are not available in this client.
            </p>
            <ErrorNotice error={error} />
          </div>
        ) : null}
      </CommandDialogShell>

      <AlertDialog
        open={updateTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          if (!updating) setUpdateTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update plugin?</AlertDialogTitle>
            <AlertDialogDescription>
              Update {updateTarget ? `“${updateTarget}”` : "this plugin"} through the native plugin API? Plugin code runs in the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updating}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={updating} aria-busy={updating} onClick={() => void applyUpdate()}>
              {updating ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
              Update plugin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const [info, setInfo] = useState<Awaited<ReturnType<typeof openCode.server.info>> | null>(null)
  const [infoStatus, setInfoStatus] = useState<"loading" | "ready" | "error">("loading")
  const request = useRef(0)

  useEffect(() => {
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setInfoStatus("loading")
      try {
        const value = await openCode.server.info()
        if (token !== request.current) return
        setInfo(value)
        setInfoStatus("ready")
      } catch {
        if (token !== request.current) return
        setInfo(null)
        setInfoStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [])

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

  const native = useMemo(() => {
    if (!info) return null
    return {
      nativeVersion: info.version,
      nativePid: info.pid,
      nativeUrls:
        info.urls.map(safeServerUrl).filter((value): value is string => Boolean(value)).join(", ") || "none",
      persistentPty:
        info.capabilities?.persistentPty === undefined
          ? "unreported"
          : String(info.capabilities.persistentPty),
    }
  }, [info])

  const rows = { ...diagnostics, ...(native ?? {}) }

  async function copy() {
    try {
      await copyText(JSON.stringify(rows, null, 2))
      setCopied(true)
      onResult("Sanitized client and native diagnostics copied.")
    } catch (failure) {
      onResult(errorMessage(failure), false)
    }
  }

  return (
    <CommandDialogShell
      title="Client diagnostics"
      description="Sanitized client state and allowlisted native server info. No config, environment, prompts, or heap dump."
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
      {infoStatus === "loading" ? (
        <p role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Reading allowlisted native server info…
        </p>
      ) : null}
      {infoStatus === "error" ? (
        <p role="alert" className="mb-2 text-xs text-destructive">
          Native server info is unavailable; showing sanitized client state only.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {Object.entries(rows).map(([key, value]) => (
          <div key={key} className="col-span-2 grid grid-cols-[auto_1fr] gap-3">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 truncate font-mono text-[11px]">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Heap dumps and native debug bodies are never exposed through this browser client.
      </p>
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
    case "status":
      return <StatusDialog {...props} />
    case "pair":
      return <PairDialog {...props} />
    case "highlights":
      return <HighlightsDialog {...props} />
    case "usage":
      return <UsageDialog {...props} />
  }
}
