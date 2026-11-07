import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { openCode, type SessionInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

/** Load only direct children and explicitly report the bounded page. */
export function SubagentNavigation({ nav }: { nav: OpenCodeController }) {
  const session = nav.activeSession
  const [children, setChildren] = useState<SessionInfo[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  if (!session) return null

  async function load() {
    const id = ++request.current
    setBusy(true); setError(null)
    try {
      const response = await openCode.session.list({ parentID: session!.id, limit: 50 })
      if (id !== request.current) return
      setChildren(response.data.filter((child) => child.parentID === session!.id))
      setTruncated(Boolean(response.cursor?.next))
    } catch {
      if (id === request.current) setError("Unable to load subagents. Try again.")
    } finally { if (id === request.current) setBusy(false) }
  }
  async function openParent() {
    if (!session?.parentID) return
    setBusy(true); setError(null)
    try {
      const failure = await nav.openSessionByID(session.parentID)
      if (failure) setError("Parent session is unavailable.")
    }
    catch { setError("Parent session is unavailable.") }
    finally { setBusy(false) }
  }
  return <section className="px-4" aria-label="Subagent navigation">
    <div className="flex flex-wrap items-center gap-1">
      {session.parentID ? <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => void openParent()}>Return to parent</Button> : null}
      <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => children === null ? void load() : setChildren(null)}>{busy ? "Loading subagents…" : children === null ? "Subagents" : "Hide subagents"}</Button>
    </div>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {children !== null ? <div className="flex flex-col gap-1 pb-2">
      {children.length === 0 ? <p className="text-xs text-muted-foreground">No direct subagents found.</p> : children.map((child) => <Button key={child.id} type="button" variant="outline" className="min-h-11 justify-start" onClick={() => nav.openSession(child)}>{child.title?.trim() || "Untitled session"}{nav.runningSessionIDs[child.id] ? " · Running" : ""}</Button>)}
      {truncated ? <p role="status" className="text-xs text-muted-foreground">Showing the first 50 direct subagents; more may exist.</p> : null}
    </div> : null}
  </section>
}
