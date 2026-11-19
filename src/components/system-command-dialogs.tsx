import { useEffect, useRef, useState } from "react"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react"

import {
  CommandDialogShell,
  ErrorNotice,
} from "@/components/session-command-dialogs"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"
import { errorMessage, openCode } from "@/lib/opencode"
import {
  buildStatusLines,
  changelogUrl,
  flattenUsagePayload,
  highlightRequestInit,
  parseHighlights,
  planUsageLimitsRequest,
  releaseNotesUrl,
  safeReleaseVersion,
  safeServerUrl,
  USAGE_MIN_VERSION,
  type ReleaseHighlight,
} from "@/lib/system-commands"
import type { OpenCodeController } from "@/lib/use-opencode"
import type { ServerInfo } from "@opencode/client"

// Keep a single import surface for existing dialog consumers.
export {
  buildStatusLines,
  changelogUrl,
  compareVersions,
  finiteExpiry,
  flattenUsagePayload,
  highlightRequestInit,
  isVersionAtLeast,
  parseHighlights,
  releaseNotesUrl,
  safeReleaseVersion,
  safeServerUrl,
  supportsUsageLimits,
  usageLimitsUrl,
  USAGE_MIN_VERSION,
} from "@/lib/system-commands"
export type { ReleaseHighlight } from "@/lib/system-commands"

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                    */
/* -------------------------------------------------------------------------- */

type Props = {
  nav: OpenCodeController
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
}

async function currentServerVersion(fallback: string | null): Promise<string | null> {
  try {
    return (await openCode.server.info()).version
  } catch {
    return fallback
  }
}

export function PairDialog({ onClose, onResult }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [expiresIn, setExpiresIn] = useState<number | null>(null)
  const [urls, setUrls] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      setCopied(false)
      const [pairing, info] = await Promise.allSettled([
        openCode.server.pair(),
        openCode.server.info(),
      ])
      if (token !== request.current) return
      if (pairing.status !== "fulfilled") {
        setCode(null)
        setExpiresIn(null)
        setUrls([])
        setError("Could not request a pairing code from the native server.")
        setStatus("error")
        return
      }
      setCode(pairing.value.code)
      setExpiresIn(pairing.value.expires_in)
      setUrls(
        info.status === "fulfilled"
          ? info.value.urls.map(safeServerUrl).filter((value): value is string => Boolean(value))
          : []
      )
      setStatus("ready")
    })
    return () => {
      request.current += 1
    }
  }, [reloadKey])

  async function copy() {
    if (status !== "ready") return
    const lines = [
      code ? `Pairing code: ${code}` : "",
      expiresIn !== null ? `Expires in: ${expiresIn}s` : "",
      ...urls.map((url) => `URL: ${url}`),
    ].filter(Boolean)
    try {
      await copyText(lines.join("\n"))
      setCopied(true)
      onResult("Pairing details copied.")
    } catch (failure) {
      onResult(errorMessage(failure), false)
    }
  }

  return (
    <CommandDialogShell
      title="Pair device"
      description="Display a native pairing code for another device. This browser never redeems the code."
      pending={false}
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
            <RefreshCwIcon aria-hidden="true" className="size-4" />
            Refresh
          </Button>
          <Button type="button" className="h-11 px-4" onClick={() => void copy()} disabled={status !== "ready"}>
            <CopyIcon aria-hidden="true" className="size-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
        </>
      }
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Requesting a pairing code…
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
        <div className="space-y-3 text-[12px]">
          {code ? (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-muted-foreground">Pairing code</p>
              <p dir="ltr" className="mt-1 font-mono text-lg font-semibold tracking-widest">{code}</p>
              {expiresIn !== null ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Expires in {expiresIn}s</p>
              ) : null}
            </div>
          ) : (
            <p role="status" className="text-xs text-muted-foreground">No code was returned.</p>
          )}
          {urls.length > 0 ? (
            <div>
              <p className="text-[11px] text-muted-foreground">Validated server URLs</p>
              <ul className="mt-1 space-y-1">
                {urls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 break-all font-mono text-[11px] underline"
                    >
                      <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No credential-free HTTP(S) server URL was reported; enter the address on the other device manually.
            </p>
          )}
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-muted-foreground">
            The code is shown here only for transfer to the other device. Nothing is stored or logged in the browser.
          </p>
        </div>
      ) : null}
    </CommandDialogShell>
  )
}

export function HighlightsDialog({ nav, onClose }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [items, setItems] = useState<ReleaseHighlight[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      setItems([])
      setVersion(null)
      const resolved = await currentServerVersion(nav.serverVersion)
      if (token !== request.current) return
      if (!resolved) {
        setError("The running server version is unavailable.")
        setStatus("error")
        return
      }
      const safeVersion = safeReleaseVersion(resolved)
      if (!safeVersion) {
        setVersion(resolved)
        setError("The server version cannot be used to look up release notes safely.")
        setStatus("error")
        return
      }
      setVersion(safeVersion)
      try {
        const response = await fetch(changelogUrl(safeVersion), highlightRequestInit())
        if (token !== request.current) return
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const changelog = await response.text()
        if (token !== request.current) return
        const parsed = parseHighlights(changelog)
        setItems(parsed)
        setStatus(parsed.length > 0 ? "ready" : "empty")
      } catch {
        if (token !== request.current) return
        setStatus("empty")
      }
    })
    return () => {
      request.current += 1
    }
  }, [nav.serverVersion, reloadKey])

  const notesLink = version ? releaseNotesUrl(version) : "https://github.com/anomalyco/opencode/releases"

  return (
    <CommandDialogShell
      title="Release highlights"
      description={version ? `Highlights for v${version}, read from the public changelog.` : "Release highlights for the running version."}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)} disabled={status === "loading"}>
            <RefreshCwIcon aria-hidden="true" className="size-4" />
            Refresh
          </Button>
          <a href={notesLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-4 text-[12px] hover:bg-muted/60">
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
            Release notes
          </a>
        </>
      }
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Reading the public changelog…
        </p>
      ) : null}
      {status === "error" ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error}</p>
          <a href={notesLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 underline">
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            Open official release notes
          </a>
        </div>
      ) : null}
      {status === "empty" ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>No published highlights were found for this version. Nothing is shown in their place.</p>
          <a href={notesLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 underline">
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            Open official release notes
          </a>
        </div>
      ) : null}
      {status === "ready" ? (
        <ul className="space-y-2" aria-label="Release highlights">
          {items.map((item, index) => (
            <li key={`${index}:${item.title}`} className="rounded-lg border border-border p-2.5 text-[12px]">
              <p className="font-medium">{item.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </CommandDialogShell>
  )
}

export function UsageDialog({ nav, onClose }: Props) {
  const directory = nav.activeSession?.location.directory ?? nav.directory ?? null
  const [version, setVersion] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "unavailable" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<{ label: string; value: string }[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      setRows([])
      const resolved = await currentServerVersion(nav.serverVersion)
      if (token !== request.current) return
      setVersion(resolved)
      const plan = planUsageLimitsRequest(resolved, directory)
      if (!plan.fetch) {
        if (plan.reason === "unsupported-version") {
          setStatus("unavailable")
        } else {
          setError("Select a project directory to view usage limits.")
          setStatus("error")
        }
        return
      }
      try {
        const response = await fetch(plan.url, {
          credentials: "same-origin",
          signal: AbortSignal.timeout(5000),
        })
        if (token !== request.current) return
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const payload: unknown = await response.json()
        if (token !== request.current) return
        const flattened = flattenUsagePayload(payload)
        setRows(flattened)
        setStatus(flattened.length > 0 ? "ready" : "empty")
      } catch (failure) {
        if (token !== request.current) return
        setError(errorMessage(failure))
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [directory, nav.serverVersion, reloadKey])

  return (
    <CommandDialogShell
      title="Usage limits"
      description="Native usage limits for the running server version."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>
          {status === "ready" || status === "empty" ? (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)}>
              <RefreshCwIcon aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          ) : null}
        </>
      }
    >
      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Checking native usage limits…
        </p>
      ) : null}
      {status === "unavailable" ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Usage limits require OpenCode {USAGE_MIN_VERSION} or newer.
            {version ? ` The running server reports v${version}.` : " The server version is unavailable."}
          </p>
          <p>Upgrade the server to view this information; no values are estimated here.</p>
        </div>
      ) : null}
      {status === "error" ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error}</p>
          <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => setReloadKey((current) => current + 1)}>Retry</Button>
        </div>
      ) : null}
      {status === "empty" ? (
        <p className="text-xs text-muted-foreground">The native endpoint returned no usage-limit values.</p>
      ) : null}
      {status === "ready" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {rows.map((row) => (
            <div key={row.label} className="col-span-2 grid grid-cols-[auto_1fr] gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words font-mono text-[11px] tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </CommandDialogShell>
  )
}

export function StatusDialog({ nav, onClose }: Props) {
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const request = useRef(0)

  useEffect(() => {
    const token = ++request.current
    void Promise.resolve().then(async () => {
      setStatus("loading")
      setError(null)
      try {
        const value = await openCode.server.info()
        if (token !== request.current) return
        setInfo(value)
        setStatus("ready")
      } catch {
        if (token !== request.current) return
        setInfo(null)
        setError("Native server info is unavailable; showing controller state only.")
        setStatus("error")
      }
    })
    return () => {
      request.current += 1
    }
  }, [reloadKey])

  const lines = buildStatusLines(info, nav)

  return (
    <CommandDialogShell
      title="Status"
      description="Connection and native server status. No credentials are shown."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={onClose}>Close</Button>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setReloadKey((current) => current + 1)} disabled={status === "loading"}>
            <RefreshCwIcon aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        </>
      }
    >
      {status === "error" ? <ErrorNotice error={error} /> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {lines.map((line) => {
          const split = line.indexOf(":")
          const label = split === -1 ? line : line.slice(0, split)
          const value = split === -1 ? "" : line.slice(split + 1).trim()
          return (
            <div key={label} className="col-span-2 grid grid-cols-[auto_1fr] gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words font-mono text-[11px]">{value || <CheckCircle2Icon aria-hidden="true" className="size-3.5 text-diff-added" />}</dd>
            </div>
          )
        })}
      </dl>
      {status === "loading" ? (
        <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Reading native server info…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <CircleAlertIcon aria-hidden="true" className="size-3.5" />
          Controller state is shown; native values are unavailable.
        </p>
      ) : null}
    </CommandDialogShell>
  )
}
