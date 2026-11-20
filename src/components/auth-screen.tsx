import { useState, type FormEvent } from "react"
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthApiError, login, setupPassword } from "@/lib/auth"

export type AuthScreenMode = "login" | "setup"

/**
 * Full-screen sign-in / first-password screen. Rendered by `AuthGateProvider`
 * instead of the app while the UI server reports an unauthenticated session.
 * Passwords only ever live in component state and are cleared after a submit.
 */
export function AuthScreen({
  mode,
  onSuccess,
}: {
  mode: AuthScreenMode
  onSuccess?: () => void
}) {
  const setup = mode === "setup"
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (password.length < 8) {
      setError("Use at least 8 characters.")
      return
    }
    if (password.length > 256) {
      setError("Use at most 256 characters.")
      return
    }
    if (setup && password !== confirm) {
      setError("Passwords do not match.")
      return
    }
    setBusy(true)
    try {
      if (setup) await setupPassword(password)
      else await login(password)
      setPassword("")
      setConfirm("")
      onSuccess?.()
    } catch (failure) {
      setError(
        failure instanceof AuthApiError
          ? failure.message
          : "The request failed. Try again."
      )
    } finally {
      setBusy(false)
    }
  }

  const passwordDescribedBy =
    [setup ? "auth-password-hint" : null, error ? "auth-error" : null]
      .filter(Boolean)
      .join(" ") || undefined

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 space-y-1 text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            opencode-ui
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            {setup ? "Set a password" : "Sign in"}
          </h1>
          {setup ? (
            <p className="text-sm text-muted-foreground">
              This password protects the UI on this network.
            </p>
          ) : null}
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <Field>
            <FieldLabel htmlFor="auth-password">Password</FieldLabel>
            <div className="relative flex items-center">
              <Input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoFocus
                maxLength={256}
                autoComplete={setup ? "new-password" : "current-password"}
                value={password}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={passwordDescribedBy}
                className="h-11 pe-12"
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError(null)
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={busy}
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
            {setup ? (
              <p
                id="auth-password-hint"
                className="text-xs text-muted-foreground"
              >
                At least 8 characters. Up to 256.
              </p>
            ) : null}
          </Field>

          {setup ? (
            <Field>
              <FieldLabel htmlFor="auth-confirm">Confirm password</FieldLabel>
              <Input
                id="auth-confirm"
                type={showPassword ? "text" : "password"}
                maxLength={256}
                autoComplete="new-password"
                value={confirm}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "auth-error" : undefined}
                className="h-11"
                onChange={(event) => {
                  setConfirm(event.target.value)
                  setError(null)
                }}
              />
            </Field>
          ) : null}

          {error ? (
            <p id="auth-error" role="alert" className="text-sm break-words text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {busy ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {busy
              ? setup
                ? "Setting up…"
                : "Signing in…"
              : setup
                ? "Set password"
                : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  )
}
