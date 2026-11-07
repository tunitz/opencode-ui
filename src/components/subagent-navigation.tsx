import { useEffect, useRef, useState } from "react"
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { openCode, type SessionInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

export async function loadDirectSubagents(sessionID: string, list = openCode.session.list) {
  const response = await list({ parentID: sessionID, limit: 50 })
  return { children: response.data.filter((child) => child.parentID === sessionID), truncated: Boolean(response.cursor?.next) }
}

/** Header controls for the current session; discovery is always refreshed on open. */
export function SubagentNavigation({ nav, title }: { nav: OpenCodeController; title: string }) {
  const session = nav.activeSession!
  const { subscribeSessionListChanges } = nav
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ key: string; children: SessionInfo[]; truncated: boolean; error: string | null } | null>(null)
  const [parentBusy, setParentBusy] = useState(false)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const knownChildren = useRef<Set<string> | null>(null)
  const loading = useRef(false)
  const pendingChanges = useRef({ relevant: false, unknown: new Set<string>() })
  const refreshForLocalChange = useRef<(() => void) | null>(null)
  const previousChildrenVersion = useRef<string | null>(null)
  const generation = useRef(0)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  // Also observe local list changes, including edits made in this UI.
  const childrenVersion = JSON.stringify(nav.sessions.filter((child) => child.parentID === session.id).map((child) => [child.id, child.time.updated, child.title, child.agent]))

  const current = result?.key === session.id ? result : null

  useEffect(() => {
    if (!open) return
    function refresh() {
      if (loading.current) {
        pendingChanges.current.relevant = true
      } else {
        setBusy(true)
        setRetry((value) => value + 1)
      }
    }
    refreshForLocalChange.current = refresh
    const unsubscribe = subscribeSessionListChanges((change) => {
      if (change.sessionID === null || change.parentID === session.id || knownChildren.current?.has(change.sessionID)) {
        refresh()
      } else if (loading.current && change.parentID === undefined) {
        // A changed session may be in the in-flight page, even if it was not
        // in the sidebar or the previous page. Resolve that ambiguity once.
        const pending = pendingChanges.current
        if (pending.unknown.size < 1024) pending.unknown.add(change.sessionID)
        else pending.relevant = true
      }
    })
    return () => { refreshForLocalChange.current = null; unsubscribe() }
  }, [open, subscribeSessionListChanges, session.id])

  useEffect(() => {
    if (!open) return
    const generationRef = generation
    const request = ++generationRef.current
    loading.current = true
    pendingChanges.current = { relevant: false, unknown: new Set() }
    void loadDirectSubagents(session.id).then((page) => {
      if (request !== generation.current) return
      const ids = new Set(page.children.map((child) => child.id))
      const pending = pendingChanges.current
      const refresh = pending.relevant || [...pending.unknown].some((id) => ids.has(id))
      knownChildren.current = ids
      loading.current = false
      setResult({ key: session.id, ...page, error: null })
      if (refresh) setRetry((value) => value + 1)
      else setBusy(false)
    }).catch(() => {
      if (request !== generation.current) return
      loading.current = false
      setResult({ key: session.id, children: [], truncated: false, error: "Unable to load subagents." })
      setBusy(false)
    })
    return () => {
      if (generationRef.current === request) generationRef.current++
      loading.current = false
    }
  }, [open, session.id, retry])

  useEffect(() => {
    const previous = previousChildrenVersion.current
    previousChildrenVersion.current = childrenVersion
    if (open && previous !== null && previous !== childrenVersion) refreshForLocalChange.current?.()
  }, [open, childrenVersion])

  async function openParent() {
    if (!session.parentID) return
    setParentBusy(true); setNavigationError(null)
    try {
      const failure = await nav.openSessionByID(session.parentID)
      if (failure) setNavigationError("Parent session is unavailable. Try again.")
    } catch { setNavigationError("Parent session is unavailable. Try again.") }
    finally { setParentBusy(false) }
  }

  async function openChild(sessionID: string) {
    setNavigationError(null)
    try {
      const failure = await nav.openSessionByID(sessionID)
      if (failure) setNavigationError("Subagent session is unavailable or changed. Try again.")
    } catch { setNavigationError("Subagent session is unavailable. Try again.") }
  }

  return <div className="relative flex min-w-0 flex-1 items-center justify-center">
    {session.parentID ? <Button type="button" variant="ghost" size="icon-lg" className="size-11 shrink-0" aria-label="Return to parent session" disabled={parentBusy} onClick={() => void openParent()}><ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" /></Button> : null}
    <DropdownMenu open={open} onOpenChange={(next) => { if (next) { setBusy(true); setRetry((value) => value + 1) } setOpen(next) }} modal={false}>
      <h1 className="min-w-0" title={title} aria-label={title}>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" className="h-11 min-w-11 max-w-full gap-1 px-1 text-[13px] font-medium text-foreground" aria-label="Subagents" />}>
          <span dir="auto" className="min-w-0 truncate">{title}</span>
          <ChevronDownIcon aria-hidden="true" className={open ? "rotate-180" : undefined} />
        </DropdownMenuTrigger>
      </h1>
      <DropdownMenuContent align="center" aria-label="Subagents" className="w-72 max-w-[calc(100vw-2rem)]">
        {busy ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">{current && !current.error ? "Refreshing subagents…" : "Loading subagents…"}</p> : null}
        {!busy && current?.error ? <><p role="alert" className="px-2 py-2 text-sm text-destructive">{current.error}</p><DropdownMenuItem onClick={(event) => { event.preventDefault(); setBusy(true); setRetry((value) => value + 1) }}>Retry</DropdownMenuItem></> : null}
        {!busy && !current?.error && current?.children.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No direct subagents found.</p> : null}
        {!current?.error && current?.children.map((child) => <DropdownMenuItem key={child.id} className="flex-col items-start gap-0" onClick={() => void openChild(child.id)}>
          <span dir="auto" className="w-full truncate">{child.title?.trim() || "Untitled session"}</span>
          {child.agent || nav.runningSessionIDs[child.id] ? <span className="text-xs text-muted-foreground">{[child.agent, nav.runningSessionIDs[child.id] ? "Running" : null].filter(Boolean).join(" · ")}</span> : null}
        </DropdownMenuItem>)}
        {!busy && !current?.error && current?.truncated ? <p role="status" className="px-2 py-2 text-xs text-muted-foreground">Showing the first 50 direct subagents; more may exist.</p> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    {navigationError ? <p role="alert" className="absolute top-full z-10 rounded-md border bg-popover p-2 text-xs text-destructive shadow-md">{navigationError}</p> : null}
  </div>
}
