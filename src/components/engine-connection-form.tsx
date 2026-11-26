import { useState, type FormEvent } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  ZapIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  testConnection,
  type ConnectionDraftInput,
  type EngineProfileSummary,
  type EngineTestResult,
} from "@/lib/connections"
import { cn } from "@/lib/utils"

export function TestFeedback({ result }: { result: EngineTestResult }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 text-xs",
        result.ok ? "text-foreground" : "text-destructive"
      )}
    >
      {result.ok ? (
        <CheckCircle2Icon
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
      ) : (
        <AlertTriangleIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0"
        />
      )}
      <span className="min-w-0 break-words">
        {result.ok
          ? `Reachable · OpenCode v${result.version ?? "unknown"} · ${result.latencyMs} ms`
          : (result.error ?? "Connection test failed.")}
      </span>
    </p>
  )
}

export function EngineConnectionForm({
  profile,
  firstConnection,
  suggestedEngineUrl,
  onSave,
  onCancel,
}: {
  profile?: EngineProfileSummary
  firstConnection: boolean
  suggestedEngineUrl?: string
  onSave: (draft: ConnectionDraftInput, activate: boolean) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(profile?.name ?? "")
  const [engineUrl, setEngineUrl] = useState(
    profile?.engineUrl ?? suggestedEngineUrl ?? ""
  )
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<EngineTestResult | null>(null)
  const [busy, setBusy] = useState<"test" | "save" | null>(null)

  const origin = engineUrl.trim()
  const url = (() => {
    try {
      return new URL(origin)
    } catch {
      return null
    }
  })()
  const canKeepPassword =
    !!profile?.hasPassword && url?.origin === profile.engineUrl
  const candidatePassword =
    canKeepPassword && !password ? undefined : password
  const unencryptedRemote =
    url?.protocol === "http:" &&
    !["localhost", "[::1]"].includes(url.hostname) &&
    !url.hostname.startsWith("127.")

  function clearFeedback() {
    setError(null)
    setTestResult(null)
  }

  async function runTest(form: HTMLFormElement | null) {
    if (busy || !form) return
    // A connection test needs the URL and credentials, not the display name.
    for (const name of ["engineUrl", "enginePassword"]) {
      const input = form.elements.namedItem(name)
      if (input instanceof HTMLInputElement && !input.reportValidity()) return
    }
    clearFeedback()
    setBusy("test")
    try {
      setTestResult(
        await testConnection({
          profileId: profile?.id,
          engineUrl: origin,
          password: candidatePassword,
        })
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not test the connection."
      )
    } finally {
      setBusy(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    clearFeedback()
    if (!name.trim()) {
      setError("Enter a name for this connection.")
      return
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const activate =
      firstConnection || submitter?.getAttribute("value") === "activate"
    setBusy("save")
    try {
      await onSave(
        { name: name.trim(), engineUrl: origin, password: candidatePassword },
        activate
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the connection."
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <form
      method="post"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="conn-name">Name</FieldLabel>
          <Input
            id="conn-name"
            name="name"
            required
            maxLength={80}
            placeholder="e.g. Local OpenCode"
            value={name}
            disabled={!!busy}
            className="h-11"
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="conn-url">Engine URL</FieldLabel>
          <Input
            id="conn-url"
            name="engineUrl"
            type="url"
            required
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="conn-url-help"
            placeholder="http://127.0.0.1:4096"
            value={engineUrl}
            disabled={!!busy}
            className="h-11 font-mono"
            onChange={(event) => {
              setEngineUrl(event.target.value)
              clearFeedback()
            }}
          />
          <FieldDescription id="conn-url-help">
            {unencryptedRemote
              ? "Remote HTTP is unencrypted. Use HTTPS or an encrypted tunnel to protect credentials and traffic."
              : "Use the OpenCode service address, including its port. Enter only the origin, with no path."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="conn-password">Engine password</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="conn-password"
              name="enginePassword"
              type={showPassword ? "text" : "password"}
              required={!canKeepPassword}
              autoComplete="section-engine current-password"
              aria-describedby="conn-password-help"
              maxLength={256}
              value={password}
              disabled={!!busy}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFeedback()
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                className="size-11"
                aria-label="Show engine password"
                aria-pressed={showPassword}
                disabled={!!busy}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOffIcon aria-hidden="true" />
                ) : (
                  <EyeIcon aria-hidden="true" />
                )}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription id="conn-password-help">
            {canKeepPassword
              ? "Leave blank to keep the saved password for this engine."
              : "Copy the output of opencode service get password on the engine machine. Do not use your OpenCode UI password."}
          </FieldDescription>
        </Field>
      </FieldGroup>

      {testResult ? <TestFeedback result={testResult} /> : null}
      {error ? (
        <p role="alert" className="text-sm break-words text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!!busy}
          onClick={(event) => void runTest(event.currentTarget.form)}
        >
          {busy === "test" ? (
            <LoaderCircleIcon
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin"
            />
          ) : (
            <ZapIcon aria-hidden="true" data-icon="inline-start" />
          )}
          Test connection
        </Button>
        {!firstConnection ? (
          <Button
            type="submit"
            variant="outline"
            className="h-11"
            disabled={!!busy}
          >
            Save
          </Button>
        ) : null}
        <Button
          type="submit"
          name="intent"
          value="activate"
          className="h-11"
          disabled={!!busy}
        >
          {busy === "save"
            ? "Saving…"
            : firstConnection
              ? "Save and connect"
              : profile?.isActive
                ? "Save & reconnect"
                : "Save & switch"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={!!busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
