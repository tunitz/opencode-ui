import { useEffect, useState, type ReactNode } from "react"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  contextLimitForModel,
  formatCost,
  formatTokenCount,
  latestAssistantUsage,
  sessionTotals,
  type ContextUsage,
  totalTokens,
} from "@/lib/context-usage"
import { projectName } from "@/components/project-select"
import { useSessionShortcuts } from "@/lib/use-session-shortcuts"
import { useUndoToast } from "@/lib/undo-toast"
import type { OpenCodeController } from "@/lib/use-opencode"
import type { SessionStatsInfo } from "@/lib/opencode"
import { cn } from "@/lib/utils"

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end text-[12px] break-words">{children}</dd>
    </div>
  )
}

export function SessionPanel({ nav }: { nav: OpenCodeController }) {
  const session = nav.activeSession
  const { shortcuts, update, error: shortcutError } = useSessionShortcuts(nav.serverVersion)
  const undo = useUndoToast()
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null | undefined>(undefined)
  const [contextCount, setContextCount] = useState<number | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [stats, setStats] = useState<SessionStatsInfo | null>(null)
  const [statsError, setStatsError] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const sessionID = session?.id
  const loadSessionContext = nav.loadSessionContext
  const loadSessionStats = nav.loadSessionStats

  const pinned = session ? shortcuts[session.id]?.pinned === true : false
  const totals = sessionTotals(session)
  const latest = latestAssistantUsage(nav.messages)
  const limit = contextLimitForModel(nav.models, session?.model)
  const usage = contextUsage ?? latest
  const contextTokens =
    usage.input === null
      ? totalTokens(totals.input, totals.output)
      : usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  const contextPercent =
    limit && contextTokens !== null && limit > 0
      ? Math.min(100, Math.round((contextTokens / limit) * 100))
      : null
  const model = session?.model
  const modelInfo = model
    ? nav.models.find(
        (candidate) => candidate.providerID === model.providerID && candidate.id === model.id
      )
    : null
  const agent = session?.agent
    ? nav.agents.find((candidate) => candidate.id === session.agent)
    : null
  const project = nav.projects.find((candidate) => candidate.id === session?.projectID)

  useEffect(() => {
    if (!sessionID) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setContextCount(null)
      setContextUsage(null)
    })
    void loadSessionContext(sessionID).then((snapshot) => {
      if (cancelled) return
      setContextCount(snapshot?.messages.length ?? null)
      setContextUsage(snapshot ? latestAssistantUsage(snapshot.messages) : null)
    })
    return () => {
      cancelled = true
    }
  }, [loadSessionContext, sessionID])

  useEffect(() => {
    if (!sessionID) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setStats(null)
      setStatsError(false)
    })
    void loadSessionStats(sessionID).then((value) => {
      if (cancelled) return
      if (value) setStats(value)
      else setStatsError(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadSessionStats, sessionID])

  useEffect(() => {
    const directory = session?.location?.directory
    if (!directory) {
      void Promise.resolve().then(() => setBranch(null))
      return
    }
    let cancelled = false
    const query = new URLSearchParams({ "location[directory]": directory })
    void fetch(`/api/vcs?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("VCS unavailable")
        return (await response.json()) as { data?: { branch?: { current?: string } } }
      })
      .then((body) => {
        if (!cancelled) setBranch(body.data?.branch?.current || null)
      })
      .catch(() => {
        if (!cancelled) setBranch(null)
      })
    return () => {
      cancelled = true
    }
  }, [session?.location?.directory])

  if (!session) {
    return (
      <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
        Select a session.
      </p>
    )
  }

  const ruleCount = session.permissions?.length ?? 0
  const subagentCount = nav.sessions.filter((entry) => entry.parentID === session.id).length
  const archivedForSession = nav.archivedSessions.filter((entry) => entry.id === session.id)

  async function toggleArchive() {
    if (!session || archiving) return
    setArchiving(true)
    setArchiveError(null)
    const failure = await nav.setSessionArchived(session.id, true)
    setArchiveError(failure)
    setArchiving(false)
  }

  return (
    <div className="space-y-4 px-3 pb-6">
      <section aria-label="Session details">
        <dl className="divide-y divide-border/60">
          <Row label="Title">
            <span dir="auto">{session.title?.trim() || "Untitled session"}</span>
          </Row>
          <Row label="Project">
            <span dir="auto">
              {project ? projectName(project) : session.projectID}
            </span>
          </Row>
          <Row label="Directory">
            <span dir="ltr" className="font-mono text-[11px]">
              {session.location?.directory ?? "Unavailable"}
            </span>
          </Row>
          <Row label="Worktree">
            <span dir="ltr" className="font-mono text-[11px]">
              {session.subpath || "Primary worktree"}
            </span>
          </Row>
          <Row label="Branch">
            <span dir="auto">{branch === undefined ? "Loading…" : branch ?? "Unavailable"}</span>
          </Row>
          <Row label="Model">
            <span dir="ltr" className="font-mono text-[11px]">
              {model ? `${model.providerID}/${model.id}${model.variant ? ` · ${model.variant}` : ""}` : "Not selected"}
            </span>
            {modelInfo?.name && modelInfo.name !== model?.id ? (
              <span className="block text-[10px] text-muted-foreground">{modelInfo.name}</span>
            ) : null}
          </Row>
          <Row label="Agent">
            <span>{agent?.name ?? session.agent ?? "Default"}</span>
          </Row>
          <Row label="Permissions">
            <span>{ruleCount > 0 ? `${ruleCount} session rule${ruleCount === 1 ? "" : "s"}` : "Inherited"}</span>
          </Row>
          <Row label="Child sessions">
            <span>{subagentCount} loaded</span>
          </Row>
        </dl>
      </section>

      <section aria-label="Context and token usage" className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Context &amp; tokens</h3>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Context window</span>
            <span className="tabular-nums">
              {formatTokenCount(contextTokens)}
              {limit !== null ? ` / ${formatTokenCount(limit)}` : ""}
              {contextPercent !== null ? ` · ${contextPercent}%` : ""}
            </span>
          </div>
          <div
            role="meter"
            aria-label="Context window usage"
            aria-valuemin={0}
            aria-valuemax={limit ?? 100}
            aria-valuenow={limit ? contextTokens ?? 0 : undefined}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <span
              aria-hidden="true"
              className={cn(
                "block h-full rounded-full bg-primary motion-reduce:transition-none",
                contextPercent !== null && contextPercent >= 90 && "bg-destructive"
              )}
              style={{ width: `${contextPercent ?? 0}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {contextCount === null
              ? "Native context unavailable."
              : `${contextCount} messages in native context.`}{" "}
            No cost is estimated.
          </p>
        </div>
        <dl className="divide-y divide-border/60">
          <Row label="Session input">{formatTokenCount(totals.input)}</Row>
          <Row label="Session output">{formatTokenCount(totals.output)}</Row>
          <Row label="Reasoning">{formatTokenCount(totals.reasoning)}</Row>
          <Row label="Cache read">{formatTokenCount(totals.cacheRead)}</Row>
          <Row label="Cache write">{formatTokenCount(totals.cacheWrite)}</Row>
          <Row label="Cost (native)">{formatCost(totals.cost)}</Row>
        </dl>
        {stats ? (
          <div className="rounded-lg border border-border/70 p-2">
            <p className="text-[11px] font-medium">Native usage stats</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {stats.sessions} sessions · {stats.prompts} prompts · {formatTokenCount(stats.tokens.input)} input ·{" "}
              {formatTokenCount(stats.tokens.output)} output · {formatCost(stats.cost)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Account-wide native aggregate, not this session's cost.
            </p>
          </div>
        ) : statsError ? (
          <p className="text-[10px] text-muted-foreground">Native usage stats are unavailable.</p>
        ) : (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin" />
            Loading native usage stats…
          </p>
        )}
      </section>

      <section aria-label="Local session actions" className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Session</h3>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-start gap-2"
          aria-pressed={pinned}
          onClick={() => {
            const next = !pinned
            if (update(session.id, { pinned: next })) {
              undo.showUndo(
                next ? "Session pinned in this browser" : "Session unpinned in this browser",
                () => update(session.id, { pinned: pinned })
              )
            }
          }}
        >
          {pinned ? (
            <PinOffIcon aria-hidden="true" className="size-4" />
          ) : (
            <PinIcon aria-hidden="true" className="size-4" />
          )}
          {pinned ? "Unpin in this browser" : "Pin in this browser"}
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Pin is stored only in this browser and never changes the session.
        </p>
        {shortcutError ? (
          <p role="alert" className="text-[11px] text-destructive">{shortcutError}</p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-start gap-2"
          disabled={archiving}
          onClick={() => void toggleArchive()}
        >
          {archiving ? (
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ArchiveIcon aria-hidden="true" className="size-4" />
          )}
          Archive session (native)
        </Button>
        {archiveError ? (
          <p role="alert" className="text-[11px] text-destructive">{archiveError}</p>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full justify-start gap-2 text-xs"
          onClick={() => {
            if (!showArchived) void nav.loadArchivedSessions()
            setShowArchived((current) => !current)
          }}
          aria-expanded={showArchived}
        >
          <ArchiveRestoreIcon aria-hidden="true" className="size-4" />
          {showArchived ? "Hide archived sessions" : "Archived sessions"}
          <span className="ms-auto tabular-nums text-muted-foreground">
            {nav.archivedStatus === "loading" ? "…" : nav.archivedSessions.length}
          </span>
        </Button>
        {showArchived ? (
          <div className="space-y-1">
            {nav.archivedStatus === "error" ? (
              <div role="alert" className="space-y-1 text-[11px] text-destructive">
                <p className="break-words">{nav.archivedError}</p>
                <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => void nav.loadArchivedSessions()}>
                  Retry
                </Button>
              </div>
            ) : null}
            {nav.archivedSessions.length === 0 && nav.archivedStatus === "ready" ? (
              <p className="text-[11px] text-muted-foreground">No archived sessions in this scope.</p>
            ) : null}
            {nav.archivedSessions.map((entry) => (
              <div key={entry.id} className="flex items-center gap-1 rounded-lg border border-border/70 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 min-w-0 flex-1 justify-start gap-2 px-2 text-start font-normal"
                  onClick={() => void nav.openSessionByID(entry.id)}
                >
                  <span dir="auto" className="min-w-0 truncate text-[12px]">
                    {entry.title?.trim() || entry.id}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 px-2 text-[11px]"
                  onClick={() => void nav.unarchiveSession(entry.id)}
                >
                  Unarchive
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {archivedForSession.length > 0 ? (
          <p className="text-[10px] text-muted-foreground">This session appears in the native archive.</p>
        ) : null}
      </section>
    </div>
  )
}
