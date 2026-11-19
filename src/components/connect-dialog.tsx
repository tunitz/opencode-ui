import { useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"
import type { IntegrationCommandAttempt } from "@opencode/client"

import { FieldRenderer } from "@/components/form-view"
import { ErrorNotice } from "@/components/session-command-dialogs"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fixedDesktopSettingsStyle, fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  buildReplyAnswer,
  defaultAnswer,
  fieldErrorMap,
  validateForm,
  visibleFields,
} from "@/lib/form-state"
import {
  connectMethodLabel,
  connectedSummary,
  isBrowserConnectMethod,
  pollDeadline,
  redactSecret,
  safeOAuthUrl,
} from "@/lib/provider-auth"
import {
  errorMessage,
  openCode,
  type FormAnswer,
  type FormField,
  type FormValue,
  type IntegrationAttempt,
  type IntegrationInfo,
  type IntegrationMethod,
} from "@/lib/opencode"
import { finiteExpiry } from "@/components/system-command-dialogs"
import { useIsDesktop } from "@/lib/use-is-desktop"
import type { OpenCodeController } from "@/lib/use-opencode"

type Props = {
  nav: OpenCodeController
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
}

type View = "list" | "detail" | "oauth" | "command" | "success"

function methodForm(method: IntegrationMethod | null): FormField[] {
  if (!method) return []
  if (method.type === "key" || method.type === "oauth" || method.type === "external") {
    return (method.form ?? []) as FormField[]
  }
  return []
}

/** Prevent any submitted form value from being reflected in an upstream error. */
function redactAnswers(message: string, values: FormAnswer): string {
  let result = message
  for (const value of Object.values(values)) {
    for (const part of Array.isArray(value) ? value : [value]) {
      if (typeof part === "string" && part.trim().length >= 3) {
        result = redactSecret(result, part)
      }
    }
  }
  return result
}

export function ConnectDialog({ nav, onClose, onResult }: Props) {
  const isDesktop = useIsDesktop()
  const directory = nav.activeSession?.location.directory ?? nav.directory ?? null
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([])
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading")
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState("")
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [method, setMethod] = useState<IntegrationMethod | null>(null)
  const [answer, setAnswer] = useState<FormAnswer>({})
  const [apiKey, setApiKey] = useState("")
  const [keyVisible, setKeyVisible] = useState(false)
  const [oauthCode, setOauthCode] = useState("")
  const [attempt, setAttempt] = useState<IntegrationAttempt | null>(null)
  const [commandAttempt, setCommandAttempt] = useState<IntegrationCommandAttempt | null>(null)
  const [authStatus, setAuthStatus] = useState<"idle" | "starting" | "waiting" | "success" | "error" | "unknown">("idle")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [view, setView] = useState<View>("list")
  const request = useRef(0)
  const pollToken = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAbort = useRef<AbortController | null>(null)
  const attemptRef = useRef<IntegrationAttempt | null>(null)
  const attemptContextRef = useRef<{ integrationID: string; directory: string } | null>(null)
  const settledRef = useRef(false)
  const commandPollToken = useRef(0)
  const commandPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commandPollAbort = useRef<AbortController | null>(null)
  const commandAttemptRef = useRef<IntegrationCommandAttempt | null>(null)
  const commandContextRef = useRef<{ integrationID: string; directory: string } | null>(null)
  const commandSettledRef = useRef(false)
  const initialDirectory = useRef(directory)

  async function loadCatalog() {
    if (!directory) {
      setCatalogStatus("error")
      setCatalogError("This session has no project directory.")
      return
    }
    const token = ++request.current
    setCatalogStatus("loading")
    setCatalogError(null)
    try {
      const response = await openCode.integration.list({
        location: { directory },
      })
      if (token !== request.current) return
      setIntegrations(
        response.data.toSorted((left, right) =>
          left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
        )
      )
      setCatalogStatus("ready")
    } catch (failure) {
      if (token !== request.current) return
      setCatalogError(errorMessage(failure))
      setCatalogStatus("error")
    }
  }

  useEffect(() => {
    if (!directory) return
    void Promise.resolve().then(() => loadCatalog())
    return () => {
      request.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, reloadKey])

  useEffect(() => {
    return () => {
      pollToken.current += 1
      if (pollTimer.current) clearTimeout(pollTimer.current)
      pollAbort.current?.abort()
      commandPollToken.current += 1
      if (commandPollTimer.current) clearTimeout(commandPollTimer.current)
      commandPollAbort.current?.abort()
    }
  }, [])

  async function close() {
    if (closing) return
    if (busy && !attemptRef.current && !commandAttemptRef.current) return
    setClosing(true)
    pollToken.current += 1
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
    pollAbort.current?.abort()
    pollAbort.current = null
    commandPollToken.current += 1
    if (commandPollTimer.current) clearTimeout(commandPollTimer.current)
    commandPollTimer.current = null
    commandPollAbort.current?.abort()
    commandPollAbort.current = null
    const active = attemptRef.current
    const context = attemptContextRef.current
    const commandActive = commandAttemptRef.current
    const commandContext = commandContextRef.current
    setApiKey("")
    setOauthCode("")
    if (active && context && !settledRef.current) {
      try {
        await openCode.integration.oauth.cancel({
          integrationID: context.integrationID,
          attemptID: active.attemptID,
          location: { directory: context.directory },
        })
      } catch {
        onResult(
          "Closed the connection dialog; server-side OAuth cancellation is unknown. No automatic retry was started."
        )
      }
    }
    if (commandActive && commandContext && !commandSettledRef.current) {
      try {
        await openCode.integration.command.cancel({
          integrationID: commandContext.integrationID,
          attemptID: commandActive.attemptID,
          location: { directory: commandContext.directory },
        })
      } catch {
        onResult(
          "Closed the connection dialog; server-side command cancellation is unknown. No automatic retry was started."
        )
      }
    }
    attemptRef.current = null
    attemptContextRef.current = null
    commandAttemptRef.current = null
    commandContextRef.current = null
    setAttempt(null)
    setCommandAttempt(null)
    onClose()
  }

  useEffect(() => {
    if (initialDirectory.current === directory) return
    initialDirectory.current = directory
    void close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory])

  if (!directory) return null

  const selected = integrations.find((integration) => integration.id === selectedID) ?? null
  const fields = methodForm(method)
  const visible = visibleFields(fields, answer)
  const errors = fieldErrorMap(fields, answer)
  const filtered = integrations.filter((integration) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return true
    return (
      integration.name.toLowerCase().includes(normalized) ||
      integration.id.toLowerCase().includes(normalized)
    )
  })

  function resetAttempt() {
    pollToken.current += 1
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
    pollAbort.current?.abort()
    pollAbort.current = null
    attemptRef.current = null
    attemptContextRef.current = null
    settledRef.current = false
    commandPollToken.current += 1
    if (commandPollTimer.current) clearTimeout(commandPollTimer.current)
    commandPollTimer.current = null
    commandPollAbort.current?.abort()
    commandPollAbort.current = null
    commandAttemptRef.current = null
    commandContextRef.current = null
    commandSettledRef.current = false
    setAttempt(null)
    setCommandAttempt(null)
    setOauthCode("")
    setAuthStatus("idle")
    setError(null)
    setNotice(null)
  }

  function chooseIntegration(integration: IntegrationInfo) {
    setSelectedID(integration.id)
    setMethod(null)
    setAnswer({})
    setApiKey("")
    setKeyVisible(false)
    resetAttempt()
    setView("detail")
  }

  function chooseMethod(next: IntegrationMethod) {
    if (!isBrowserConnectMethod(next)) return
    setMethod(next)
    setAnswer(defaultAnswer(methodForm(next)))
    setApiKey("")
    setKeyVisible(false)
    resetAttempt()
    setError(null)
    setNotice(null)
  }

  function setValue(key: string, value: FormValue | undefined) {
    setAnswer((current) => {
      const next = { ...current }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })
  }

  async function finishSuccess(integration: IntegrationInfo) {
    settledRef.current = true
    setApiKey("")
    setOauthCode("")
    setAuthStatus("success")
    setNotice(
      "Connected. Provider/model catalogs are refreshing. The current session model and browser defaults were not changed."
    )
    attemptRef.current = null
    attemptContextRef.current = null
    commandAttemptRef.current = null
    commandContextRef.current = null
    setAttempt(null)
    setCommandAttempt(null)
    setView("success")
    await loadCatalog()
    nav.retryCatalogs()
    onResult(`Connected ${integration.name}. Catalogs refreshed.`)
  }

  async function connectWithKey(integration: IntegrationInfo, selectedMethod: IntegrationMethod) {
    if (busy || selectedMethod.type !== "key") return
    const key = apiKey
    if (!key.trim()) {
      setError("Enter an API key.")
      return
    }
    const invalid = validateForm(fields, answer)
    if (invalid) {
      setError(invalid)
      return
    }
    const reply = fields.length > 0 ? buildReplyAnswer(fields, answer) : undefined
    setBusy(true)
    setError(null)
    try {
      await openCode.integration.connect.key({
        integrationID: integration.id,
        location: { directory },
        key,
        ...(reply ? { answer: reply } : {}),
      })
      setApiKey("")
      await finishSuccess(integration)
    } catch (failure) {
      setError(redactSecret(errorMessage(failure), key))
    } finally {
      setBusy(false)
    }
  }

  async function connectExternal(integration: IntegrationInfo, selectedMethod: IntegrationMethod) {
    if (busy || selectedMethod.type !== "external") return
    const invalid = validateForm(fields, answer)
    if (invalid) {
      setError(invalid)
      return
    }
    const reply = fields.length > 0 ? buildReplyAnswer(fields, answer) : undefined
    setBusy(true)
    setError(null)
    try {
      await openCode.integration.connect.external({
        integrationID: integration.id,
        methodID: selectedMethod.id,
        location: { directory },
        ...(reply ? { answer: reply } : {}),
      })
      await finishSuccess(integration)
    } catch (failure) {
      setError(redactAnswers(errorMessage(failure), answer))
    } finally {
      setBusy(false)
    }
  }

  function startPolling(integration: IntegrationInfo, next: IntegrationAttempt) {
    attemptRef.current = next
    setAttempt(next)
    settledRef.current = false
    setAuthStatus("waiting")
    const token = ++pollToken.current
    const deadline = pollDeadline(next.time.expires)

    const poll = async () => {
      if (token !== pollToken.current || settledRef.current) return
      const controller = new AbortController()
      pollAbort.current = controller
      try {
        const response = await openCode.integration.oauth.status(
          {
            integrationID: integration.id,
            attemptID: next.attemptID,
            location: { directory },
          },
          { signal: controller.signal }
        )
        if (token !== pollToken.current || settledRef.current) return
        const status = response.data
        if (status.status === "pending") {
          if (Date.now() >= deadline) {
            setAuthStatus("unknown")
            setError(
              "Authorization status is unknown after the bounded polling window. The server may still complete the attempt; no automatic retry was started."
            )
            return
          }
          pollTimer.current = setTimeout(poll, 600)
          return
        }
        if (status.status === "complete") {
          settledRef.current = true
          await finishSuccess(integration)
          return
        }
        settledRef.current = true
        setAuthStatus("error")
        setError(
          status.status === "failed"
            ? status.message
            : "Authorization expired. Start sign-in again if needed."
        )
      } catch (failure) {
        if (controller.signal.aborted || token !== pollToken.current) return
        setAuthStatus("unknown")
        setError(
          `Authorization status is unknown: ${errorMessage(failure)}. The server may still complete it; no automatic retry was started.`
        )
      }
    }
    void poll()
  }

  function startCommandPolling(integration: IntegrationInfo, next: IntegrationCommandAttempt) {
    commandAttemptRef.current = next
    setCommandAttempt(next)
    commandSettledRef.current = false
    setAuthStatus("waiting")
    const token = ++commandPollToken.current
    const deadline = pollDeadline(finiteExpiry(next.time.expires))

    const poll = async () => {
      if (token !== commandPollToken.current || commandSettledRef.current) return
      const controller = new AbortController()
      commandPollAbort.current = controller
      try {
        const response = await openCode.integration.command.status(
          {
            integrationID: integration.id,
            attemptID: next.attemptID,
            location: { directory },
          },
          { signal: controller.signal }
        )
        if (token !== commandPollToken.current || commandSettledRef.current) return
        const status = response.data
        if (status.status === "pending") {
          if (Date.now() >= deadline) {
            setAuthStatus("unknown")
            setError(
              "Command authentication status is unknown after the bounded polling window. The server may still complete the attempt; no automatic retry was started."
            )
            return
          }
          commandPollTimer.current = setTimeout(poll, 600)
          return
        }
        commandSettledRef.current = true
        if (status.status === "complete") {
          await finishSuccess(integration)
          return
        }
        setAuthStatus("error")
        setError(
          status.status === "failed"
            ? status.message
            : "The command attempt expired. Start sign-in again if needed."
        )
      } catch (failure) {
        if (controller.signal.aborted || token !== commandPollToken.current) return
        setAuthStatus("unknown")
        setError(
          `Command authentication status is unknown: ${errorMessage(failure)}. The server may still complete it; no automatic retry was started.`
        )
      }
    }
    void poll()
  }

  async function startCommand(integration: IntegrationInfo, selectedMethod: IntegrationMethod) {
    if (busy || selectedMethod.type !== "command") return
    setBusy(true)
    setError(null)
    setNotice(null)
    resetAttempt()
    setAuthStatus("starting")
    try {
      const response = await openCode.integration.command.connect({
        integrationID: integration.id,
        methodID: selectedMethod.id,
        location: { directory },
      })
      const next = response.data
      commandAttemptRef.current = next
      commandContextRef.current = { integrationID: integration.id, directory }
      setCommandAttempt(next)
      startCommandPolling(integration, next)
      setView("command")
    } catch (failure) {
      setAuthStatus("error")
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  async function startOAuth(integration: IntegrationInfo, selectedMethod: IntegrationMethod) {
    if (busy || selectedMethod.type !== "oauth") return
    const invalid = validateForm(fields, answer)
    if (invalid) {
      setError(invalid)
      return
    }
    const reply = fields.length > 0 ? buildReplyAnswer(fields, answer) : undefined
    setBusy(true)
    setError(null)
    setNotice(null)
    resetAttempt()
    setAuthStatus("starting")
    try {
      const response = await openCode.integration.oauth.connect({
        integrationID: integration.id,
        methodID: selectedMethod.id,
        location: { directory },
        ...(reply ? { answer: reply } : {}),
      })
      const next = response.data
      attemptRef.current = next
      attemptContextRef.current = { integrationID: integration.id, directory }
      setAttempt(next)
      setOauthCode("")
      if (next.mode === "auto") {
        startPolling(integration, next)
      } else {
        setAuthStatus("waiting")
      }
      setView("oauth")
    } catch (failure) {
      setAuthStatus("error")
      setError(redactAnswers(errorMessage(failure), answer))
    } finally {
      setBusy(false)
    }
  }

  async function completeOAuth(integration: IntegrationInfo) {
    if (!attempt || busy) return
    if (!oauthCode.trim()) {
      setError("Enter the authorization code.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await openCode.integration.oauth.complete({
        integrationID: integration.id,
        attemptID: attempt.attemptID,
        location: { directory },
        code: oauthCode,
      })
      await finishSuccess(integration)
    } catch (failure) {
      setError(redactSecret(errorMessage(failure), oauthCode))
    } finally {
      setBusy(false)
    }
  }

  function backToList() {
    if (busy || attemptRef.current || commandAttemptRef.current) return
    setSelectedID(null)
    setMethod(null)
    setAnswer({})
    setApiKey("")
    setOauthCode("")
    resetAttempt()
    setView("list")
  }

  const methodFields =
    method && method.type !== "env" ? (
      <div className="space-y-3">
        {visible.map((field) => (
          <FieldRenderer
            key={field.key}
            formID={`connect-${selected?.id ?? "provider"}-${method.type}`}
            field={field}
            value={answer[field.key]}
            error={errors[field.key]}
            onChange={(value) => setValue(field.key, value)}
          />
        ))}
      </div>
    ) : null

  const body =
    view === "list" ? (
      <div className="space-y-2">
        <div className="relative">
          <Input
            aria-label="Search providers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search providers"
            className="h-11"
            autoFocus
          />
        </div>
        {catalogStatus === "loading" ? (
          <p role="status" className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Loading provider catalog…
          </p>
        ) : null}
        {catalogStatus === "error" ? (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>{catalogError}</p>
            <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>
              Retry
            </Button>
          </div>
        ) : null}
        {catalogStatus === "ready" ? (
          <ul className="max-h-[52svh] space-y-1 overflow-y-auto" aria-label="Providers">
            {filtered.map((integration) => {
              const summary = connectedSummary(integration)
              const browserMethods = integration.methods.filter(isBrowserConnectMethod)
              return (
                <li key={integration.id}>
                  <button
                    type="button"
                    onClick={() => chooseIntegration(integration)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-start hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{integration.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {browserMethods.length > 0
                          ? `${browserMethods.length} browser auth method${browserMethods.length === 1 ? "" : "s"}`
                          : "No browser-native auth method"}
                      </span>
                    </span>
                    {summary ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">{summary}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted-foreground">No providers match.</li>
            ) : null}
          </ul>
        ) : null}
      </div>
    ) : view === "detail" && selected ? (
      <div className="space-y-3">
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-[13px] font-medium">{selected.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {connectedSummary(selected) ?? "Not connected"}
          </p>
        </div>
        <div className="space-y-1" aria-label="Connection methods">
          {selected.methods.map((candidate, index) => {
            const active = isBrowserConnectMethod(candidate)
            const reason =
              candidate.type === "env"
                ? `Environment variable${candidate.names.length === 1 ? "" : "s"}: ${candidate.names.map((name) => `$${name}`).join(", ")}`
                : candidate.type === "external"
                  ? "Links a credential provisioned outside this browser."
                  : candidate.type === "command"
                    ? "Completes when the configured server command finishes."
                    : null
            return (
              <button
                key={`${candidate.type}:${"id" in candidate && candidate.id ? candidate.id : index}`}
                type="button"
                disabled={!active}
                onClick={() => chooseMethod(candidate)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-start text-[12px] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block">{connectMethodLabel(candidate)}</span>
                  {reason ? <span className="block text-[10px] text-muted-foreground">{reason}</span> : null}
                </span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{candidate.type}</span>
              </button>
            )
          })}
        </div>
        {method ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-[12px] font-medium">
              {method.type === "key" ? "API key" : "Sign in"}
            </p>
            {methodFields}
            {method.type === "key" ? (
              <div className="space-y-1.5">
                <Label htmlFor="connect-api-key">API key</Label>
                <div className="flex gap-1">
                  <Input
                    id="connect-api-key"
                    aria-label="API key"
                    type={keyVisible ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                    autoCapitalize="none"
                    className="h-11 min-w-0 font-mono text-[12px]"
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    aria-label={keyVisible ? "Hide API key" : "Show API key"}
                    className="size-11 shrink-0 rounded-full p-0"
                    onClick={() => setKeyVisible((current) => !current)}
                  >
                    {keyVisible ? <EyeOffIcon aria-hidden="true" className="size-4" /> : <EyeIcon aria-hidden="true" className="size-4" />}
                  </Button>
                </div>
              </div>
            ) : null}
            <Button
              type="button"
              className="h-11 w-full px-4"
              disabled={busy || (method.type === "key" && !apiKey.trim())}
              aria-busy={busy}
              onClick={() => {
                if (method.type === "key") void connectWithKey(selected, method)
                else if (method.type === "external") void connectExternal(selected, method)
                else if (method.type === "command") void startCommand(selected, method)
                else void startOAuth(selected, method)
              }}
            >
              {busy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
              {method.type === "key" || method.type === "external" ? "Connect" : "Start sign-in"}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Credentials are kept only in this open form and are sent once to the native backend; they are never put in URLs, browser storage, or logs.
            </p>
            <p className="text-[10px] text-muted-foreground">
              Credentials traverse this HTTP origin. Only connect on a network you trust.
            </p>
          </div>
        ) : null}
        <ErrorNotice error={error} />
      </div>
    ) : view === "command" && selected && commandAttempt ? (
      <div className="space-y-3">
        <div className="rounded-lg border border-border p-2.5 text-[12px]">
          <p className="font-medium">{method?.type === "command" ? method.label : "Command sign-in"}</p>
          {method?.type === "command" && method.command.length > 0 ? (
            <div>
              <p className="mt-1 text-[11px] text-muted-foreground">Run this command on the server to finish sign-in:</p>
              <p dir="ltr" className="mt-1 break-all rounded-md bg-muted/40 p-2 font-mono text-[11px]">{method.command.join(" ")}</p>
            </div>
          ) : null}
          {authStatus === "waiting" ? (
            <p role="status" className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              Waiting for the command to complete…
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Status is checked with the native endpoint until the bounded polling window ends; no automatic retry is started.
          </p>
        </div>
        <ErrorNotice error={error} />
      </div>
    ) : view === "oauth" && selected && attempt ? (
      <div className="space-y-3">
        <div className="rounded-lg border border-border p-2.5 text-[12px]">
          <p className="font-medium">{method?.type === "oauth" ? method.label : "Authorization"}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
            {attempt.instructions}
          </p>
          {safeOAuthUrl(attempt.url) ? (
            <a
              href={safeOAuthUrl(attempt.url) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium underline"
            >
              <ExternalLinkIcon aria-hidden="true" className="size-4" />
              Open authorization page
            </a>
          ) : (
            <p className="mt-2 break-all text-[10px] text-destructive">
              The provider returned an authorization URL that cannot be opened safely here
              (only credential-free HTTPS links are allowed). Follow the instructions manually.
            </p>
          )}
          {attempt.mode === "auto" ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Waiting for authorization. The status is checked with the native endpoint; if this
              provider redirects to localhost, a remote/headless browser may not complete it.
            </p>
          ) : null}
        </div>
        {attempt.mode === "code" ? (
          <div className="space-y-1.5">
            <Label htmlFor="connect-oauth-code">Authorization code</Label>
            <Input
              id="connect-oauth-code"
              aria-label="Authorization code"
              value={oauthCode}
              onChange={(event) => setOauthCode(event.target.value)}
              autoComplete="one-time-code"
              spellCheck={false}
              className="h-11 font-mono text-[12px]"
              disabled={busy}
            />
            <Button
              type="button"
              className="h-11 w-full px-4"
              disabled={busy || !oauthCode.trim()}
              aria-busy={busy}
              onClick={() => void completeOAuth(selected)}
            >
              {busy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
              Complete sign-in
            </Button>
          </div>
        ) : authStatus === "waiting" ? (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Waiting for authorization…
          </p>
        ) : null}
        <ErrorNotice error={error} />
      </div>
    ) : view === "success" && selected ? (
      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <CheckCircle2Icon aria-hidden="true" className="size-4 text-diff-added" />
          Connected {selected.name}
        </p>
        <p className="text-[11px] text-muted-foreground">{notice}</p>
        <p className="text-[11px] text-muted-foreground">
          Provider/agent/model catalogs were refreshed. No current session model or browser
          preference was changed.
        </p>
      </div>
    ) : null

  const footer =
    view === "list" ? (
      <>
        <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void close()} disabled={busy || closing}>Close</Button>
        <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)} disabled={catalogStatus === "loading"}>
          {catalogStatus === "loading" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCwIcon aria-hidden="true" className="size-4" />}
          Refresh
        </Button>
      </>
    ) : view === "detail" ? (
      <>
        <Button type="button" variant="outline" className="h-11 px-4" onClick={backToList} disabled={busy}>Back</Button>
        <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void close()} disabled={busy || closing}>Close</Button>
      </>
    ) : view === "oauth" ? (
      <>
        <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void close()} disabled={closing}>Close</Button>
      </>
    ) : (
      <Button type="button" className="h-11 px-4" onClick={() => void close()} disabled={closing}>Close</Button>
    )

  const content = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          {isDesktop ? (
            <DialogTitle className="text-[17px] font-semibold tracking-tight">Connect an integration</DialogTitle>
          ) : (
            <SheetTitle className="text-[17px] font-semibold tracking-tight">Connect an integration</SheetTitle>
          )}
          {isDesktop ? (
            <DialogDescription className="text-[12px] text-muted-foreground">
              Use the native provider/integration API. No session model is changed automatically.
            </DialogDescription>
          ) : (
            <SheetDescription className="text-[12px] text-muted-foreground">
              Use the native provider/integration API. No session model is changed automatically.
            </SheetDescription>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close connection dialog"
          className="size-11 shrink-0 rounded-full p-0"
          onClick={() => void close()}
          disabled={busy || closing}
        >
          <XIcon aria-hidden="true" className="size-5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {view !== "list" ? (
          <Button type="button" variant="ghost" size="sm" className="mb-2 h-11 px-2 text-xs" onClick={backToList} disabled={busy || Boolean(attempt) || Boolean(commandAttempt)}>
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Providers
          </Button>
        ) : null}
        {body}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {footer}
      </div>
    </div>
  )

  if (!isDesktop) {
    return (
      <Sheet open onOpenChange={(open) => !open && void close()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 overflow-x-hidden overflow-y-auto rounded-t-xl bg-card p-0"
          style={fixedMobileDrawerStyle()}
        >
          {content}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close()
      }}
    >
      <DialogContent showCloseButton={false} className="flex w-[min(44rem,92vw)] flex-col gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-none" style={fixedDesktopSettingsStyle()}>
        {content}
      </DialogContent>
    </Dialog>
  )
}
