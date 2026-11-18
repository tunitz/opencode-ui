import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Item, ItemActions, ItemContent } from "@/components/ui/item"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { inboxDeliveryLabel, inboxSummary } from "@/lib/queue"
import type { SessionInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"
import { liveRunStore } from "@/lib/live-run-store"
import type { LiveRun, LiveRunStatus } from "@/lib/session-events"
import { useLiveRunStatus } from "@/lib/use-live-run"
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

/** Map an SDK run state onto the finite Trace status vocabulary. */
function runTraceStatus(status: string | undefined): "running" | "error" | undefined {
  if (status === "running" || status === "submitting") return "running"
  if (status === "failed") return "error"
  return undefined
}

type RunMeta = {
  startedAt: number | null
  error: string | null
  notices: string[]
}

const EMPTY_RUN_META: RunMeta = { startedAt: null, error: null, notices: [] }
const noopUnsubscribe = () => {}

// The status hook keeps the panel off the per-token update path; this selector
// covers the other fields the panel renders (duration/error/notices) with a
// referentially stable snapshot so text deltas never re-render it either.
let lastMeta: RunMeta = EMPTY_RUN_META
function selectRunMeta(run: LiveRun | null): RunMeta {
  if (!run) return EMPTY_RUN_META
  if (
    lastMeta !== EMPTY_RUN_META &&
    lastMeta.startedAt === run.startedAt &&
    lastMeta.error === run.error &&
    lastMeta.notices === run.notices
  ) {
    return lastMeta
  }
  lastMeta = {
    startedAt: run.startedAt,
    error: run.error,
    notices: run.notices,
  }
  return lastMeta
}

function useRunMeta(sessionID: string | null): RunMeta {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      sessionID
        ? liveRunStore.subscribe(sessionID, onStoreChange)
        : noopUnsubscribe,
    [sessionID]
  )
  return useSyncExternalStore(subscribe, () =>
    selectRunMeta(liveRunStore.getRun(sessionID))
  )
}

type ActivityRun = RunMeta & { status: LiveRunStatus }

export function ActivityPanel({ nav }: { nav: OpenCodeController }) {
  const status = useLiveRunStatus(nav.activeSessionID)
  const runMeta = useRunMeta(nav.activeSessionID)
  const run: ActivityRun | null = status === null ? null : { status, ...runMeta }
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

  const statusLabel =
    run?.status === "submitting"
      ? "Submitting prompt…"
      : run?.status === "running"
        ? "Responding"
        : run?.status === "failed"
          ? "Last run failed"
          : run?.status === "interrupted"
            ? "Last run interrupted"
            : run?.status === "completed"
              ? "Last run completed"
              : "Idle"

  return (
    <div className="flex flex-col gap-5 px-3 pb-6">
      <section aria-label="Run state" className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground">Run</h3>
        <Trace>
          <TraceLine status={runTraceStatus(run?.status)}>
            <TraceIcon>
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
                        ? "bg-primary"
                        : "bg-muted-foreground/50"
                  )}
                />
              )}
            </TraceIcon>
            <TraceTitle>{statusLabel}</TraceTitle>
            {running && run?.startedAt && now !== null ? (
              <TraceDescription>
                {formatDurationMs(Math.max(0, now - run.startedAt))}
              </TraceDescription>
            ) : null}
          </TraceLine>
        </Trace>
        {run?.error ? (
          <CodeBlock variant="destructive" size="sm">
            <CodeBlockContent wrap className="max-h-24">
              {run.error}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
        {run?.notices.length ? (
          <div className="flex flex-col gap-0.5">
            {run.notices.map((notice) => (
              <Marker key={notice} className="text-[11px]">
                <MarkerContent>{notice}</MarkerContent>
              </Marker>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-label="Queued prompts" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Queue</h3>
          <Badge variant="secondary" className="tabular-nums">{nav.inbox.length}</Badge>
        </div>
        {nav.inboxStatus === "loading" && nav.inbox.length === 0 ? (
          <div role="status" className="flex flex-col gap-1">
            <span className="sr-only">Loading queued prompts…</span>
            <Skeleton className="h-9 w-full" aria-hidden="true" />
          </div>
        ) : null}
        {nav.inboxError ? (
          <div role="alert" className="flex flex-col gap-1 text-xs text-destructive">
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
          <Empty className="p-3">
            <EmptyHeader>
              <EmptyTitle>No queued prompts</EmptyTitle>
              <EmptyDescription>No prompts are waiting in the native queue.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {nav.inbox.map((item, index) => {
              const busy = nav.inboxBusy[item.id] === true
              return (
                <li key={item.id}>
                  <Item variant="outline" size="sm">
                    <ItemContent className="min-w-0 flex-1">
                      <p className="line-clamp-3 break-words text-[13px]">{inboxSummary(item)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.type === "user" ? inboxDeliveryLabel(item.delivery === "queue" ? "queue" : "steer") : item.type}
                      </p>
                    </ItemContent>
                    {item.type === "user" ? (
                      <ItemActions className="w-full flex-wrap">
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
                      </ItemActions>
                    ) : null}
                  </Item>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Pending permissions and forms" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Needs you</h3>
          <Badge variant="secondary" className="tabular-nums">{attention}</Badge>
        </div>
        {attention === 0 ? (
          <Empty className="p-3">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BellIcon /></EmptyMedia>
              <EmptyTitle>Nothing is waiting for an answer.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {nav.pendingForms.map((form) => (
              <FormView key={form.id} nav={nav} form={form} />
            ))}
            {nav.pendingPermissions.map((request) => (
              <PermissionCard key={request.id} nav={nav} request={request} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Loaded child sessions" className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Subagents</h3>
        {children.length === 0 ? (
          <Empty className="p-3">
            <EmptyHeader>
              <EmptyTitle>No loaded child sessions</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {children.map(({ session, depth }) => {
              const runningChild = nav.runningSessionIDs[session.id] === true
              return (
                <li key={session.id} style={{ paddingInlineStart: `${(depth - 1) * 12}px` }}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-full justify-start gap-2 px-2 text-start font-normal"
                    onClick={() => nav.selectSession(session.id)}
                  >
                    <TraceLine status={runningChild ? "running" : undefined}>
                      <TraceIcon>
                        {runningChild ? (
                          <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
                        ) : (
                          <GitMergeIcon aria-hidden="true" />
                        )}
                      </TraceIcon>
                      <TraceTitle className="text-[12px]">{session.title?.trim() || session.id}</TraceTitle>
                    </TraceLine>
                    <ChevronRightIcon aria-hidden="true" className="ms-auto size-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground">
          Bounded to loaded child sessions from the native parent link.
        </p>
      </section>

      {nav.historyError ? (
        <section aria-label="Recent failure" className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Recent failure</h3>
          <Marker className="text-destructive">
            <MarkerIcon><CircleAlertIcon /></MarkerIcon>
            <MarkerContent>{nav.historyError}</MarkerContent>
          </Marker>
        </section>
      ) : null}
    </div>
  )
}
