import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
  type EngineAuthMode,
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

function isPlainRemoteHttp(value: string): boolean {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:") return false
    const host = url.hostname.toLowerCase()
    return host !== "localhost" && host !== "::1" && host !== "[::1]" && !host.startsWith("127.")
  } catch {
    return false
  }
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

function TestFeedback({ result }: { result: EngineTestResult }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 text-xs",
        result.ok
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-destructive"
      )}
    >
      {result.ok ? (
        <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">
        {result.ok
          ? `Reachable · OpenCode v${result.version ?? "unknown"} · ${result.latencyMs} ms`
          : result.error ?? "Connection test failed."}
      </span>
    </p>
  )
}

/**
 * Settings > Connection: inspect the active OpenCode engine, save local or
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
  const [name, setName] = useState("")
  const [engineUrl, setEngineUrl] = useState("")
  const [authMode, setAuthMode] = useState<EngineAuthMode>("password")
  const [username, setUsername] = useState("opencode")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [serviceFile, setServiceFile] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [formTesting, setFormTesting] = useState(false)
  const [formTestResult, setFormTestResult] = useState<EngineTestResult | null>(null)
  const [formSaving, setFormSaving] = useState(false)

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

  const openCreateForm = useCallback(() => {
    setActionError(null)
    setNotice(null)
    setFormError(null)
    setFormTestResult(null)
    setName("")
    setEngineUrl("http://127.0.0.1:4096")
    setAuthMode("password")
    setUsername("opencode")
    setPassword("")
    setShowPassword(false)
    setServiceFile("")
    setFormMode({ kind: "create" })
  }, [])

  const openEditForm = useCallback((profile: EngineProfileSummary) => {
    setActionError(null)
    setNotice(null)
    setFormError(null)
    setFormTestResult(null)
    setName(profile.name)
    setEngineUrl(profile.engineUrl)
    setAuthMode(profile.authMode)
    setUsername(profile.username || "opencode")
    setPassword("")
    setShowPassword(false)
    setServiceFile(profile.serviceFile ?? "")
    setFormMode({ kind: "edit", profile })
  }, [])

  const closeForm = useCallback(() => {
    setFormMode({ kind: "closed" })
    setFormError(null)
    setFormTestResult(null)
    setPassword("")
    setShowPassword(false)
  }, [])

  const applySwitch = useCallback(
    (next: ConnectionsState, label: string) => {
      setState(next)
      notifyEngineConnectionChanged(next.active)
      nav.resetForEngineSwitch?.()
      setNotice(`Switched active engine to ${label}.`)
    },
    [nav]
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

  const urlChangedDuringEdit =
    formMode.kind === "edit" &&
    engineUrl.trim().replace(/\/+$/, "") !== formMode.profile.engineUrl

  const handleTestForm = useCallback(async () => {
    if (formTesting) return
    setFormError(null)
    setFormTestResult(null)
    setFormTesting(true)
    try {
      const result = await testConnection({
        ...(formMode.kind === "edit" ? { profileId: formMode.profile.id } : {}),
        engineUrl: engineUrl.trim(),
        authMode,
        username: username.trim() || "opencode",
        ...(authMode === "password" && password ? { password } : {}),
        ...(authMode === "service-file" ? { serviceFile: serviceFile.trim() } : {}),
      })
      setFormTestResult(result)
    } catch (error) {
      setFormError(messageFor(error))
    } finally {
      setFormTesting(false)
    }
  }, [authMode, engineUrl, formMode, formTesting, password, serviceFile, username])

  const submitForm = useCallback(
    async (activateAfterSave: boolean) => {
      if (formSaving || formMode.kind === "closed") return
      setFormError(null)
      setActionError(null)
      setNotice(null)

      const trimmedName = name.trim()
      const trimmedUrl = engineUrl.trim()
      if (!trimmedName) {
        setFormError("Enter a name for this connection.")
        return
      }
      if (!trimmedUrl) {
        setFormError("Enter the engine HTTP(S) origin.")
        return
      }
      if (authMode === "service-file" && !serviceFile.trim()) {
        setFormError("Enter the path to the local service.json file.")
        return
      }
      if (authMode === "password") {
        const needsPassword =
          formMode.kind === "create" ||
          formMode.profile.authMode !== "password" ||
          urlChangedDuringEdit
        if (needsPassword && !password) {
          setFormError(
            urlChangedDuringEdit
              ? "Re-enter the password for the new engine URL."
              : "Enter the engine password."
          )
          return
        }
      }

      setFormSaving(true)
      try {
        if (formMode.kind === "create") {
          const next = await createConnection({
            name: trimmedName,
            engineUrl: trimmedUrl,
            authMode,
            username: username.trim() || "opencode",
            ...(authMode === "password" ? { password } : { serviceFile: serviceFile.trim() }),
            activate: activateAfterSave,
          })
          closeForm()
          if (activateAfterSave) {
            applySwitch(next, next.profile.name)
          } else {
            setState(next)
            setNotice(`Saved connection ${next.profile.name}.`)
          }
        } else if (formMode.kind === "edit") {
          const targetId = formMode.profile.id
          const updated = await updateConnection(targetId, {
            name: trimmedName,
            engineUrl: trimmedUrl,
            authMode,
            username: username.trim() || "opencode",
            ...(authMode === "password"
              ? password
                ? { password }
                : {}
              : { serviceFile: serviceFile.trim() }),
          })
          closeForm()
          if (activateAfterSave && !updated.profile.isActive) {
            const switched = await activateConnection(targetId)
            applySwitch(switched, updated.profile.name)
          } else if (updated.profile.isActive) {
            applySwitch(updated, updated.profile.name)
          } else {
            setState(updated)
            setNotice(`Updated connection ${updated.profile.name}.`)
          }
        }
      } catch (error) {
        setFormError(messageFor(error))
      } finally {
        setFormSaving(false)
      }
    },
    [
      applySwitch,
      authMode,
      closeForm,
      engineUrl,
      formMode,
      formSaving,
      name,
      password,
      serviceFile,
      urlChangedDuringEdit,
      username,
    ]
  )

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void submitForm(false)
    },
    [submitForm]
  )

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
    } catch (error) {
      setActionError(messageFor(error))
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleting])

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
  const activeTest = testResults[active.id]

  return (
    <div className="space-y-4">
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
              Add instance
            </Button>
          ) : null}
        </div>

        {formMode.kind !== "closed" ? (
          <form
            noValidate
            onSubmit={handleFormSubmit}
            className="space-y-4 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground">
                {formMode.kind === "create"
                  ? "Add OpenCode instance"
                  : `Edit ${formMode.profile.name}`}
              </h4>
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-3 text-muted-foreground"
                disabled={formSaving}
                onClick={closeForm}
              >
                Cancel
              </Button>
            </div>

            <Field>
              <FieldLabel htmlFor="conn-name">Name</FieldLabel>
              <Input
                id="conn-name"
                type="text"
                maxLength={80}
                placeholder="e.g. Workstation or Local :4096"
                value={name}
                disabled={formSaving}
                className="h-11"
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError(null)
                }}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="conn-url">Engine URL</FieldLabel>
              <Input
                id="conn-url"
                type="url"
                inputMode="url"
                placeholder="http://127.0.0.1:4096 or https://devbox.example.test:4096"
                value={engineUrl}
                disabled={formSaving}
                className="h-11 font-mono text-sm"
                onChange={(event) => {
                  setEngineUrl(event.target.value)
                  setFormError(null)
                  setFormTestResult(null)
                }}
              />
              {isPlainRemoteHttp(engineUrl) ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Plain HTTP to a non-loopback host sends credentials unencrypted unless routed through a private tunnel.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Origin only (scheme, host, and optional port).
                </p>
              )}
            </Field>

            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">Authentication</span>
              <div
                role="radiogroup"
                aria-label="Authentication method"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {(
                  [
                    {
                      id: "password" as const,
                      title: "Password (recommended)",
                      detail: "Works for local and remote engines; saved privately on the UI server.",
                    },
                    {
                      id: "service-file" as const,
                      title: "Local service.json",
                      detail: "Reads password on demand from a local file on this machine.",
                    },
                  ] as const
                ).map((option) => {
                  const selected = authMode === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={formSaving}
                      onClick={() => {
                        setAuthMode(option.id)
                        setFormError(null)
                        setFormTestResult(null)
                      }}
                      className={cn(
                        "flex min-h-11 flex-col items-start rounded-lg border px-3 py-2.5 text-start transition-colors",
                        selected
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent/50"
                      )}
                    >
                      <span className="text-sm font-medium text-foreground">
                        {option.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {authMode === "password" ? (
              <Field>
                <FieldLabel htmlFor="conn-password">Engine password</FieldLabel>
                <div className="relative flex items-center">
                  <Input
                    id="conn-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="off"
                    maxLength={256}
                    placeholder={
                      formMode.kind === "edit" &&
                      formMode.profile.authMode === "password" &&
                      !urlChangedDuringEdit
                        ? "Leave blank to keep saved password"
                        : "Enter engine service password"
                    }
                    value={password}
                    disabled={formSaving}
                    className="h-11 pe-12"
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setFormError(null)
                      setFormTestResult(null)
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={formSaving}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute end-0 size-11 text-muted-foreground"
                  >
                    {showPassword ? (
                      <EyeOffIcon aria-hidden="true" className="size-4" />
                    ) : (
                      <EyeIcon aria-hidden="true" className="size-4" />
                    )}
                  </Button>
                </div>
                {urlChangedDuringEdit ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    The engine URL changed — re-enter the password so saved credentials are never sent to a different host.
                  </p>
                ) : null}
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="conn-service-file">Service file path</FieldLabel>
                <Input
                  id="conn-service-file"
                  type="text"
                  placeholder="~/.config/opencode/service.json"
                  value={serviceFile}
                  disabled={formSaving}
                  className="h-11 font-mono text-sm"
                  onChange={(event) => {
                    setServiceFile(event.target.value)
                    setFormError(null)
                    setFormTestResult(null)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  JSON file readable by the UI server containing a nonempty <code className="font-mono">password</code> field.
                </p>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="conn-username">Basic username</FieldLabel>
              <Input
                id="conn-username"
                type="text"
                maxLength={64}
                placeholder="opencode"
                value={username}
                disabled={formSaving}
                className="h-11 font-mono text-sm"
                onChange={(event) => {
                  setUsername(event.target.value)
                  setFormError(null)
                }}
              />
            </Field>

            {formTestResult ? <TestFeedback result={formTestResult} /> : null}

            {formError ? (
              <p role="alert" className="text-sm break-words text-destructive">
                {formError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={formSaving || formTesting}
                onClick={() => void handleTestForm()}
              >
                {formTesting ? (
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <ZapIcon aria-hidden="true" className="size-4" />
                )}
                Test
              </Button>
              <Button type="submit" variant="outline" className="h-11" disabled={formSaving}>
                {formSaving ? (
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                Save
              </Button>
              <Button
                type="button"
                className="h-11"
                disabled={formSaving}
                onClick={() => void submitForm(true)}
              >
                {formSaving ? (
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {formMode.kind === "edit" && formMode.profile.isActive
                  ? "Save & reconnect"
                  : "Save & switch"}
              </Button>
            </div>
          </form>
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
                      {profile.isDefault ? (
                        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Startup default
                        </span>
                      ) : null}
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {profile.isRemote ? "Remote" : "Local"}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {profile.authMode === "password" ? "Password" : "Service file"}
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {profile.engineUrl}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {!profile.isActive ? (
                      <Button
                        type="button"
                        className="h-11"
                        disabled={Boolean(busyId)}
                        onClick={() => void handleActivate(profile)}
                      >
                        {switching ? (
                          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                        ) : null}
                        Switch
                      </Button>
                    ) : null}
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
                    {!profile.isDefault ? (
                      <>
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
                        {!profile.isActive ? (
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
                      </>
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
