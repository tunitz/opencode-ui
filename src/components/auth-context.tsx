import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react"
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"

import { AuthScreen, type AuthScreenMode } from "@/components/auth-screen"
import { Button } from "@/components/ui/button"
import {
  AuthApiError,
  getAuthStatus,
  logout,
  registerUnauthorizedHandler,
  type AuthStatus,
} from "@/lib/auth"
import { liveRunStore } from "@/lib/live-run-store"

export type AuthGateValue = {
  /** Boot status; null while loading or after a failed load. */
  status: AuthStatus | null
  /** Network/request failure while fetching the status. */
  loadError: string | null
  reloadStatus: () => void
  signOut: () => Promise<void>
  /**
   * Surface a mid-session 401 auth/setup error without reloading the page.
   * `setup_required` opens the setup form; anything else opens sign-in.
   */
  signalUnauthorized: (code?: string) => void
}

const AuthGateContext = createContext<AuthGateValue | null>(null)

export function useAuthGate(): AuthGateValue {
  const context = useContext(AuthGateContext)
  if (!context) throw new Error("AuthGateProvider is required")
  return context
}

function failureMessage(error: unknown): string {
  if (error instanceof AuthApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return "The server could not be reached."
}

/**
 * Gates the engine-connected app behind the UI password. Status is fetched
 * once on mount; no polling. A successful sign-in re-fetches the status and
 * remounts the app, which is acceptable and avoids trusting client state.
 */
export function AuthGateProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [forcedMode, setForcedMode] = useState<AuthScreenMode | null>(null)
  const requestRef = useRef(0)

  const loadStatus = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const next = await getAuthStatus()
      if (request !== requestRef.current) return
      setStatus(next)
      setLoadError(null)
      setForcedMode(null)
    } catch (error) {
      if (request !== requestRef.current) return
      setStatus(null)
      setLoadError(failureMessage(error))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  // The boot status comes from the server; there is no client store to subscribe to.
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot server status fetch */
  useEffect(() => {
    void loadStatus()
  }, [loadStatus])
  /* eslint-enable react-hooks/set-state-in-effect */

  const reloadStatus = useCallback(() => {
    setLoadError(null)
    setLoading(true)
    void loadStatus()
  }, [loadStatus])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } catch {
      // The login screen is still the honest next step; the next status check
      // corrects the session state if the cookie outlived the request.
    }
    liveRunStore.reset()
    setLoadError(null)
    setStatus((current) =>
      current ? { ...current, authenticated: false } : current
    )
    setForcedMode("login")
  }, [])

  const signalUnauthorized = useCallback((code?: string) => {
    liveRunStore.reset()
    setLoadError(null)
    setForcedMode(code === "setup_required" ? "setup" : "login")
  }, [])

  useEffect(
    () => registerUnauthorizedHandler(signalUnauthorized),
    [signalUnauthorized]
  )

  const value = useMemo<AuthGateValue>(
    () => ({ status, loadError, reloadStatus, signOut, signalUnauthorized }),
    [status, loadError, reloadStatus, signOut, signalUnauthorized]
  )

  let content: ReactNode
  if (loading) {
    content = (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Starting opencode-ui…
        </p>
      </main>
    )
  } else if (loadError) {
    content = (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            opencode-ui
          </p>
          <p role="alert" className="text-sm break-words text-destructive">
            {loadError}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={reloadStatus}
          >
            <RefreshCwIcon aria-hidden="true" className="size-4" />
            Retry
          </Button>
        </div>
      </main>
    )
  } else if (forcedMode) {
    content = <AuthScreen mode={forcedMode} onSuccess={reloadStatus} />
  } else if (!status || !status.authenticated) {
    content = (
      <AuthScreen
        mode={status?.configured ? "login" : "setup"}
        onSuccess={reloadStatus}
      />
    )
  } else {
    content = children
  }

  return (
    <AuthGateContext.Provider value={value}>{content}</AuthGateContext.Provider>
  )
}
