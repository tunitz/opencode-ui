import { useEffect, useMemo, useState } from "react"
import {
  BellIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CornerUpLeftIcon,
  GitMergeIcon,
  LoaderCircleIcon,
  MoveUpIcon,
  XIcon,
} from "lucide-react"

import { FormView } from "@/components/form-view"
import { PermissionCard } from "@/components/permission-card"
import { Button } from "@/components/ui/button"
import { inboxDeliveryLabel, inboxSummary } from "@/lib/queue"
import type { SessionInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"
import { useLiveRun } from "@/lib/use-live-run"
import { formatDurationMs } from "@/lib/context-usage"
import { cn } from "@/lib/utils"

type ChildNode = { session: SessionInfo; depth: number }

/** Loaded child sessions only; never presented as an unbounded native tree. */
export function boundedChildSessions(
  sessions: readonly SessionInfo[],
  rootID: string | null,
  maxDepth = 5
): ChildNode[] {
  if (!rootID) return []
  const byParent = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    if (!session.parentID || session.parentID === session.id) continue
    const list = byParent.get(session.parentID) ?? []
    list.push(session)
    byParent.set(session.parentID, list)
  }
  const out: ChildNode[] = []
  const visit = (parentID: string, depth: number, seen: Set<string>) => {
    if (depth > maxDepth) return
    for (const child of byParent.get(parentID) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ session: child, depth })
      visit(child.id, depth + 1, seen)
    }
  }
  visit(rootID, 1, new Set([rootID]))
  return out
}

export function activityBadgeCount(nav: OpenCodeController): number {
  return nav.inbox.length + nav.pendingPermissions.length + nav.pendingForms.length
}

export function ActivityPanel({ nav }: { nav: OpenCodeController }) {
  const run = useLiveRun(nav.activeSessionID)
  const children = useMemo(
    () => boundedChildSessions(nav.sessions, nav.activeSessionID),
    [nav.activeSessionID, nav.sessions]
  )
  const attention = nav.pendingPermissions.length + nav.pendingForms.length
  const running = run?.status === "running" || run?.status === "submitting"
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    void Promise.resolve().then(() => setNow(Date.now()))
    return () => window.clearInterval(timer)
  }, [running])

  return (
    <div className="space-y-5 px-3 pb-6">
      <section aria-label="Run state" className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">Run</h3>
        <p role="status" className="flex items-center gap-2 text-sm">
          {running ? (
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-primary" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                run?.status === "failed"
                  ? "bg-destructive"
                  : run?.status === "completed"
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/50"
              )}
            />
          )}
          <span className="min-w-0 break-words">
            {run?.status === "submitting"
              ? "Submitting prompt…"
              : run?.status === "running"
                ? "Responding"
                : run?.status === "failed"
                  ? "Last run failed"
                  : run?.status === "interrupted"
                    ? "Last run interrupted"
                    : run?.status === "completed"
                      ? "Last run completed"
                      : "Idle"}
          </span>
          {running && run?.startedAt && now !== null ? (
            <span className="ms-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatDurationMs(Math.max(0, now - run.startedAt))}
            </span>
          ) : null}
        </p>
        {run?.error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 px-2 py-1.5 text-xs break-words text-destructive">
            {run.error}
          </p>
        ) : null}
        {run?.notices.length ? (
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {run.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="Queued prompts" className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Queue</h3>
          <span className="text-[11px] tabular-nums text-muted-foreground">{nav.inbox.length}</span>
        </div>
        {nav.inboxStatus === "loading" && nav.inbox.length === 0 ? (
          <p role="status" className="text-xs text-muted-foreground">Loading queued prompts…</p>
        ) : null}
        {nav.inboxError ? (
          <div role="alert" className="space-y-1 text-xs text-destructive">
            <p className="break-words">{nav.inboxError}</p>
            <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => void nav.loadInbox()}>
              Retry
            </Button>
          </div>
        ) : null}
        {nav.inbox.length > 0 ? (
          <p className="text-[10px] text-muted-foreground">
            Taking a prompt back restores its text and files; skills and agents
            are not restored.
          </p>
        ) : null}
        {nav.inbox.length === 0 && nav.inboxStatus !== "loading" ? (
          <p className="text-xs text-muted-foreground">No prompts are waiting in the native queue.</p>
        ) : (
          <ul className="space-y-1.5">
            {nav.inbox.map((item, index) => {
              const busy = nav.inboxBusy[item.id] === true
              return (
                <li key={item.id} className="rounded-lg border border-border/70 p-2">
                  <p className="line-clamp-3 text-[13px] break-words">{inboxSummary(item)}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {item.type === "user" ? inboxDeliveryLabel(item.delivery === "queue" ? "queue" : "steer") : item.type}
                  </p>
                  {item.type === "user" ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 px-2 text-[11px]"
                        disabled={busy || index !== 0}
                        onClick={() => void nav.steerInboxItem(item.id)}
                      >
                        <MoveUpIcon aria-hidden="true" className="size-3.5" />
                        Send first as steer
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 px-2 text-[11px]"
                        disabled={busy}
                        onClick={() => void nav.takeBackInboxItem(item.id)}
                      >
                        <CornerUpLeftIcon aria-hidden="true" className="size-3.5" />
                        Take back
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 px-2 text-[11px]"
                        disabled={busy}
                        aria-label={`Cancel queued prompt ${index + 1}`}
                        onClick={() => void nav.cancelInboxItem(item.id)}
                      >
                        <XIcon aria-hidden="true" className="size-3.5" />
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Pending permissions and forms" className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Needs you</h3>
          <span className="text-[11px] tabular-nums text-muted-foreground">{attention}</span>
        </div>
        {attention === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <BellIcon aria-hidden="true" className="size-3.5" />
            Nothing is waiting for an answer.
          </p>
        ) : (
          <div className="space-y-3">
            {nav.pendingForms.map((form) => (
              <FormView key={form.id} nav={nav} form={form} />
            ))}
            {nav.pendingPermissions.map((request) => (
              <PermissionCard key={request.id} nav={nav} request={request} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Loaded child sessions" className="space-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Subagents</h3>
        {children.length === 0 ? (
          <p className="text-xs text-muted-foreground">No loaded child sessions.</p>
        ) : (
          <ul className="space-y-0.5">
            {children.map(({ session, depth }) => (
              <li key={session.id} style={{ paddingInlineStart: `${(depth - 1) * 12}px` }}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full justify-start gap-2 px-2 text-start font-normal"
                  onClick={() => nav.selectSession(session.id)}
                >
                  <GitMergeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-[12px]">
                    {session.title?.trim() || session.id}
                  </span>
                  {nav.runningSessionIDs[session.id] ? (
                    <LoaderCircleIcon aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
                  ) : null}
                  <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground">
          Bounded to loaded child sessions from the native parent link.
        </p>
      </section>

      {nav.historyError ? (
        <section aria-label="Recent failure" className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">Recent failure</h3>
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 px-2 py-1.5 text-xs break-words text-destructive">
            <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {nav.historyError}
          </p>
        </section>
      ) : null}
    </div>
  )
}
