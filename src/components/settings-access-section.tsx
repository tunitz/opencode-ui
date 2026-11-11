import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
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
  AuthApiError,
  changePassword,
  getAuthStatus,
  setupPassword,
  type AuthStatus,
} from "@/lib/auth"

function messageFor(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.code === "auth_required" || error.code === "setup_required") {
      return "Session expired — sign in again."
    }
    return error.message
  }
  return "The request failed. Try again."
}

/**
 * Settings > Access: shows whether a UI password is set, and sets, changes or
 * (on non-required binds) removes it. The server enforces the password rules;
 * this form adds only match and minimum-length checks.
 */
export function SettingsAccessSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeCurrent, setRemoveCurrent] = useState("")
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const next = await getAuthStatus()
      if (request !== requestRef.current) return
      setStatus(next)
      setStatusError(null)
    } catch (failure) {
      if (request !== requestRef.current) return
      setStatusError(
        failure instanceof AuthApiError
          ? failure.message
          : "The access status could not be loaded."
      )
    } finally {
      if (request === requestRef.current) setLoadingStatus(false)
    }
  }, [])

  // The section reads the current status from the server once on mount.
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot server status fetch */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable react-hooks/set-state-in-effect */

  const retry = useCallback(() => {
    setStatusError(null)
    setLoadingStatus(true)
    void load()
  }, [load])

  const configured = status?.configured ?? false

  function resetFields() {
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setError(null)
    setNotice(null)

    if (configured && !currentPassword) {
      setError("Enter your current password.")
      return
    }
    if (newPassword.length < 8) {
      setError("Use at least 8 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setSaving(true)
    try {
      if (configured) await changePassword(currentPassword, newPassword)
      else await setupPassword(newPassword)
      resetFields()
      setNotice(configured ? "Password updated." : "Password set.")
      await load()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setSaving(false)
    }
  }

  async function removePassword() {
    if (removing) return
    setRemoveError(null)
    if (!removeCurrent) {
      setRemoveError("Enter your current password.")
      return
    }
    setRemoving(true)
    try {
      await changePassword(removeCurrent, "")
      setRemoveOpen(false)
      setRemoveCurrent("")
      setNotice("Password removed.")
      await load()
    } catch (failure) {
      setRemoveError(messageFor(failure))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-4 px-1 pb-2">
      {loadingStatus ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Checking access…
        </p>
      ) : null}

      {statusError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm break-words text-destructive">
            {statusError}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:w-auto sm:px-4"
            onClick={retry}
          >
            <RefreshCwIcon aria-hidden="true" className="size-4" />
            Retry
          </Button>
        </div>
      ) : null}

      {status ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <ShieldCheckIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              {configured ? "Password set" : "Not set"}
            </span>
            {status.required ? (
              <span className="text-muted-foreground">
                Required on this network
              </span>
            ) : null}
          </div>

          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <form onSubmit={submit} noValidate className="max-w-md space-y-4">
            {configured ? (
              <Field>
                <FieldLabel htmlFor="access-current">
                  Current password
                </FieldLabel>
                <Input
                  id="access-current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  disabled={saving}
                  aria-invalid={error ? true : undefined}
                  className="h-11"
                  onChange={(event) => {
                    setCurrentPassword(event.target.value)
                    setError(null)
                  }}
                />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="access-new">
                {configured ? "New password" : "Password"}
              </FieldLabel>
              <Input
                id="access-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                disabled={saving}
                aria-invalid={error ? true : undefined}
                aria-describedby="access-new-hint"
                className="h-11"
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  setError(null)
                }}
              />
              <p id="access-new-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor="access-confirm">
                {configured ? "Confirm new password" : "Confirm password"}
              </FieldLabel>
              <Input
                id="access-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                disabled={saving}
                aria-invalid={error ? true : undefined}
                className="h-11"
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  setError(null)
                }}
              />
            </Field>

            {error ? (
              <p role="alert" className="text-sm break-words text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="h-11 w-full sm:w-auto sm:px-4"
              disabled={saving}
            >
              {saving ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : null}
              {saving
                ? configured
                  ? "Updating…"
                  : "Setting…"
                : configured
                  ? "Update password"
                  : "Set password"}
            </Button>
          </form>

          {!configured && !status.required ? (
            <p className="text-xs text-muted-foreground">
              A password is optional on this network.
            </p>
          ) : null}

          {configured && !status.required ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full text-destructive sm:w-auto sm:px-4"
              disabled={saving}
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Remove password
            </Button>
          ) : null}
        </>
      ) : null}

      <AlertDialog
        open={removeOpen}
        onOpenChange={(open) => {
          if (removing) return
          setRemoveOpen(open)
          if (!open) {
            setRemoveCurrent("")
            setRemoveError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the password?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone who can reach this UI can use it without signing in. This
              ends every session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="access-remove-current">
              Current password
            </FieldLabel>
            <Input
              id="access-remove-current"
              type="password"
              autoComplete="current-password"
              value={removeCurrent}
              disabled={removing}
              aria-invalid={removeError ? true : undefined}
              className="h-11"
              onChange={(event) => {
                setRemoveCurrent(event.target.value)
                setRemoveError(null)
              }}
            />
          </Field>
          {removeError ? (
            <p role="alert" className="text-sm break-words text-destructive">
              {removeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={() => void removePassword()}
            >
              {removing ? "Removing…" : "Remove password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
