import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  GlobeIcon,
  LaptopIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react"

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
import { ConnectionDataMigration } from "@/components/connection-data-migration"
import { EngineConnectionForm, TestFeedback } from "@/components/engine-connection-form"
import { Switch } from "@/components/ui/switch"
import {
  ConnectionApiError,
  activateConnection,
  createConnection,
  deleteConnection,
  listConnections,
  notifyEngineConnectionChanged,
  testConnection,
  updateConnection,
  type ConnectionsState,
  type ConnectionDraftInput,
  type EngineProfileSummary,
  type EngineTestResult,
} from "@/lib/connections"
import type { OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"

type FormMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; profile: EngineProfileSummary }

function messageFor(error: unknown): string {
  if (error instanceof ConnectionApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return "The connection request failed."
}

function LiveStatusChip({ nav }: { nav: OpenCodeController }) {
  const tone =
    nav.connection === "connected"
      ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
      : nav.connection === "connecting"
        ? "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400"
        : "border-destructive/40 bg-destructive/10 text-destructive"
  const label =
    nav.connection === "connected"
      ? nav.serverVersion
        ? `Connected · v${nav.serverVersion}`
        : "Connected"
      : nav.connection === "connecting"
        ? "Connecting…"
        : "Unreachable"
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone
      )}
    >
      {label}
    </span>
  )
}

/**
 * Settings > Connections: inspect the active OpenCode engine, save local or
 * remote instance profiles on the UI server, test connectivity, and switch
 * instances live without restarting opencode-ui.
 */
export function SettingsConnectionSection({ nav }: { nav: OpenCodeController }) {
  const [state, setState] = useState<ConnectionsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, EngineTestResult>>({})

  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" })

  const [deleteTarget, setDeleteTarget] = useState<EngineProfileSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const token = ++requestRef.current
    try {
      const next = await listConnections()
      if (token !== requestRef.current) return
      setState(next)
      setLoadError(null)
    } catch (error) {
      if (token !== requestRef.current) return
      setLoadError(messageFor(error))
    } finally {
      if (token === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const retry = useCallback(() => {
    setLoadError(null)
    setLoading(true)
    void load()
  }, [load])

  const openCreateForm = () => {
    setActionError(null)
    setNotice(null)
    setFormMode({ kind: "create" })
  }

  const openEditForm = (profile: EngineProfileSummary) => {
    setActionError(null)
    setNotice(null)
    setFormMode({ kind: "edit", profile })
  }

  const closeForm = () => setFormMode({ kind: "closed" })

  const applySwitch = useCallback(
    (next: ConnectionsState, label: string) => {
      setState(next)
      notifyEngineConnectionChanged(next.active)
      if (state?.active) nav.resetForEngineSwitch?.()
      setNotice(`Switched active engine to ${label}.`)
    },
    [nav, state?.active]
  )

  const handleActivate = useCallback(
    async (profile: EngineProfileSummary) => {
      if (busyId) return
      setBusyId(profile.id)
      setActionError(null)
      setNotice(null)
      try {
        const next = await activateConnection(profile.id)
        applySwitch(next, profile.name)
      } catch (error) {
        setActionError(messageFor(error))
      } finally {
        setBusyId(null)
      }
    },
    [applySwitch, busyId]
  )

  const handleTestSaved = useCallback(
    async (profile: EngineProfileSummary) => {
      if (testingId) return
      setTestingId(profile.id)
      setActionError(null)
      try {
        const result = await testConnection({ profileId: profile.id })
        setTestResults((previous) => ({ ...previous, [profile.id]: result }))
      } catch (error) {
        setTestResults((previous) => ({
          ...previous,
          [profile.id]: {
            ok: false,
            reachable: false,
            authenticated: false,
            status: null,
            version: null,
            latencyMs: 0,
            unencryptedRemote: profile.unencryptedRemote,
            error: messageFor(error),
          },
        }))
      } finally {
        setTestingId(null)
      }
    },
    [testingId]
  )

  async function saveForm(draft: ConnectionDraftInput, activate: boolean) {
    setActionError(null)
    setNotice(null)

    if (formMode.kind === "create") {
      const next = await createConnection({ ...draft, activate })
      closeForm()
      if (next.profile.isActive) applySwitch(next, next.profile.name)
      else {
        setState(next)
        setNotice(`Saved connection ${next.profile.name}.`)
      }
    } else if (formMode.kind === "edit") {
      const updated = await updateConnection(formMode.profile.id, draft)
      // Reflect the saved edit even if switching fails.
      setState(updated)
      if (activate || updated.profile.isActive) {
        const next = updated.profile.isActive ? updated : await activateConnection(updated.profile.id)
        applySwitch(next, updated.profile.name)
      } else {
        setNotice(`Updated connection ${updated.profile.name}.`)
      }
      closeForm()
    }
  }

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setActionError(null)
    setNotice(null)
    try {
      const removedName = deleteTarget.name
      const next = await deleteConnection(deleteTarget.id)
      setState(next)
      setDeleteTarget(null)
      setNotice(`Removed connection ${removedName}.`)
      if (!next.active) {
        nav.resetForEngineSwitch?.(false)
        notifyEngineConnectionChanged(null)
      }
    } catch (error) {
      setActionError(messageFor(error))
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleting, nav])

  if (loading) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground"
      >
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        Loading engine connections…
      </div>
    )
  }

  if (loadError || !state) {
    return (
      <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
        <p role="alert" className="text-sm text-destructive">
          {loadError ?? "Engine connections are unavailable."}
        </p>
        <Button type="button" variant="outline" className="h-11" onClick={retry}>
          <RefreshCwIcon aria-hidden="true" className="size-4" />
          Retry
        </Button>
      </div>
    )
  }

  const active = state.active
  const activeTest = active ? testResults[active.id] : undefined

  return (
    <div className="space-y-4">
      {active ? (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <ServerIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">{active.name}</h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {active.isRemote ? (
                    <>
                      <GlobeIcon aria-hidden="true" className="size-3" />
                      Remote
                    </>
                  ) : (
                    <>
                      <LaptopIcon aria-hidden="true" className="size-3" />
                      Local
                    </>
                  )}
                </span>
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {active.engineUrl}
              </p>
            </div>
            <LiveStatusChip nav={nav} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={testingId === active.id}
              onClick={() => void handleTestSaved(active)}
            >
              {testingId === active.id ? (
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <ZapIcon aria-hidden="true" className="size-4" />
              )}
              Test active connection
            </Button>
            {nav.connection !== "connected" ? (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => nav.retryConnection()}
              >
                <RefreshCwIcon aria-hidden="true" className="size-4" />
                Reconnect
              </Button>
            ) : null}
          </div>

          {activeTest ? <TestFeedback result={activeTest} /> : null}

          {active.unencryptedRemote ? (
            <p
              role="note"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
            >
              <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                This remote connection uses plain HTTP. Prefer HTTPS or a private encrypted tunnel (such as Tailscale or WireGuard) to protect credentials and traffic.
              </span>
            </p>
          ) : null}

          {active.isRemote ? (
            <p className="text-xs text-muted-foreground">
              Chat, sessions, files, diffs, and <code className="font-mono">/terminal</code> run against this remote engine. Local host file settings (Agents file editing, Plugins MCP config, and local artifact roots) still refer to the UI server machine.
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300"
        >
          {notice}
        </p>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      <ConnectionDataMigration
        profiles={state.profiles}
        activeId={state.active?.id ?? null}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium text-foreground">OpenCode instances</h3>
            <p className="text-xs text-muted-foreground">
              Switch between local or remote OpenCode V2 engines. Credentials stay private on the UI server.
            </p>
          </div>
          {formMode.kind === "closed" ? (
            <Button type="button" className="h-11" onClick={openCreateForm}>
              <PlusIcon aria-hidden="true" className="size-4" />
              Add connection
            </Button>
          ) : null}
        </div>

        {formMode.kind !== "closed" ? (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-medium text-foreground">
              {formMode.kind === "edit" ? `Edit ${formMode.profile.name}` : "Add OpenCode connection"}
            </h4>
            <EngineConnectionForm
              key={formMode.kind === "edit" ? formMode.profile.id : "create"}
              profile={formMode.kind === "edit" ? formMode.profile : undefined}
              firstConnection={state.profiles.length === 0}
              suggestedEngineUrl={state.profiles.length === 0 ? state.suggestedEngineUrl : undefined}
              onSave={saveForm}
              onCancel={closeForm}
            />
          </div>
        ) : null}

        <div className="space-y-2.5">
          {state.profiles.map((profile) => {
            const switching = busyId === profile.id
            const testing = testingId === profile.id
            const testResult = testResults[profile.id]
            return (
              <div
                key={profile.id}
                data-connection-id={profile.id}
                className={cn(
                  "space-y-3 rounded-xl border bg-card p-4",
                  profile.isActive ? "border-primary/50" : "border-border/70"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">
                        {profile.name}
                      </span>
                      {profile.isActive ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-600/40 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          Active
                        </span>
                      ) : null}
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {profile.isRemote ? "Remote" : "Local"}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {profile.hasPassword ? "Password" : "Password required"}
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {profile.engineUrl}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex h-11 items-center gap-1.5">
                      {switching ? (
                        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
                      ) : null}
                      <Switch
                        checked={profile.isActive}
                        disabled={Boolean(busyId) || profile.isActive}
                        label={
                          profile.isActive
                            ? `${profile.name} is the active engine`
                            : `Switch active engine to ${profile.name}`
                        }
                        onCheckedChange={(next) => {
                          if (next && !profile.isActive) void handleActivate(profile)
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={testing}
                      onClick={() => void handleTestSaved(profile)}
                    >
                      {testing ? (
                        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                      ) : (
                        <ZapIcon aria-hidden="true" className="size-4" />
                      )}
                      Test
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      aria-label={`Edit ${profile.name}`}
                      className="size-11"
                      onClick={() => openEditForm(profile)}
                    >
                      <PencilIcon aria-hidden="true" className="size-4" />
                    </Button>
                    {!profile.isActive || state.profiles.length === 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        aria-label={`Delete ${profile.name}`}
                        className="size-11 text-destructive"
                        onClick={() => setDeleteTarget(profile)}
                      >
                        <Trash2Icon aria-hidden="true" className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                {testResult && !profile.isActive ? (
                  <TestFeedback result={testResult} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-medium text-foreground">{deleteTarget?.name}</span> ({deleteTarget?.engineUrl}) from saved OpenCode instances. The engine itself is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
