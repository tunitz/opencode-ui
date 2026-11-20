import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { canSteerInboxItem, inboxDeliveryLabel, inboxSummary } from "@/lib/queue"
import type { SessionInfo } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"
import { liveRunStore } from "@/lib/live-run-store"
import type { LiveRun, LiveRunStatus } from "@/lib/session-events"
import { useLiveRunStatus } from "@/lib/use-live-run"
import { formatDurationMs } from "@/lib/context-usage"
import { cn } from "@/lib/utils"

type ChildNode = { session: SessionInfo; depth: number }

type QueueAction = "steer" | "edit" | "cancel"

type QueueFeedback = {
  sessionID: string
  inboxID: string
  action: QueueAction
  tone: "status" | "error"
  text: string
}

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
  const [feedback, setFeedback] = useState<QueueFeedback | null>(null)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<Record<string, QueueAction>>({})
  const actionGuardRef = useRef<Set<string>>(new Set())

  async function runQueueAction(inboxID: string, action: QueueAction) {
    const sessionID = nav.activeSessionID
    if (!sessionID) {
      setFeedback({
        sessionID: "",
        inboxID,
        action,
        tone: "error",
        text: "Select a session first.",
      })
      return
    }
    const index = nav.inbox.findIndex((entry) => entry.id === inboxID)
    if (index < 0) return
    const eligible =
      action === "steer"
        ? canSteerInboxItem(nav.inbox[index], index)
        : nav.inbox[index].type === "user"
    if (!eligible) return
    // The native hook also guards by inbox id; this keeps a double click from
    // reaching it before its state has propagated to the component.
    if (actionGuardRef.current.has(inboxID) || nav.inboxBusy[inboxID]) return
    actionGuardRef.current.add(inboxID)
    setPendingAction((current) => ({ ...current, [inboxID]: action }))
    setFeedback(null)

    let failure: string | null
    try {
      if (action === "steer") failure = await nav.steerInboxItem(inboxID)
      else if (action === "edit") failure = await nav.takeBackInboxItem(inboxID)
      else failure = await nav.cancelInboxItem(inboxID)
    } catch (error) {
      failure = error instanceof Error ? error.message : "Could not complete that action."
    } finally {
      actionGuardRef.current.delete(inboxID)
      setPendingAction((current) => {
        const next = { ...current }
        delete next[inboxID]
        return next
      })
    }

    setFeedback({
      sessionID,
      inboxID,
      action,
      tone: failure ? "error" : "status",
      text: failure
        ? failure
        : action === "steer"
          ? "Delivery set to steer for the next opportunity."
          : action === "edit"
            ? "Returned to the composer and removed from the queue; it may already have been delivered."
            : "Prompt removed from the queue; it may already have been delivered.",
    })
  }

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

  // Feedback stays bound to the session that started the action; switching
  // sessions cannot make another session's error look like its own. Only one
  // lightweight latest outcome is kept — never the native payload.
  const visibleFeedback =
    feedback?.sessionID === (nav.activeSessionID ?? "") ? feedback : null
  const canRetry =
    visibleFeedback?.tone === "error" &&
    (() => {
      const index = nav.inbox.findIndex((entry) => entry.id === visibleFeedback.inboxID)
      if (index < 0) return false
      const item = nav.inbox[index]
      return visibleFeedback.action === "steer"
        ? canSteerInboxItem(item, index)
        : item.type === "user"
    })()

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
        {/* Two persistent, non-nested live regions: the outcome is announced
            even when its row leaves the queue on success. */}
        <div className="flex flex-col gap-1">
          <div
            role="status"
            aria-atomic="true"
            className={cn(
              "rounded-lg px-2 py-1 text-[11px] break-words",
              visibleFeedback?.tone === "status"
                ? "bg-muted/60 text-muted-foreground"
                : "sr-only"
            )}
          >
            {visibleFeedback?.tone === "status" ? visibleFeedback.text : ""}
          </div>
          <div
            role="alert"
            aria-atomic="true"
            className={cn(
              "flex flex-wrap items-center gap-1 rounded-lg px-2 py-1 text-[11px] break-words",
              visibleFeedback?.tone === "error"
                ? "bg-destructive/10 text-destructive"
                : "sr-only"
            )}
          >
            {visibleFeedback?.tone === "error" ? (
              <>
                <span className="min-w-0 flex-1">{visibleFeedback.text}</span>
                {canRetry ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-3 text-[11px]"
                    disabled={
                      pendingAction[visibleFeedback.inboxID] !== undefined ||
                      nav.inboxBusy[visibleFeedback.inboxID] === true
                    }
                    onClick={() => {
                      if (visibleFeedback.action === "cancel") {
                        setCancelTarget(visibleFeedback.inboxID)
                      } else {
                        void runQueueAction(visibleFeedback.inboxID, visibleFeedback.action)
                      }
                    }}
                  >
                    {visibleFeedback.action === "cancel" ? "Retry cancel" : "Retry"}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
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
              const action = pendingAction[item.id]
              const busy = nav.inboxBusy[item.id] === true || action !== undefined
              const isUser = item.type === "user"
              return (
                <li key={item.id}>
                  <Item variant="outline" size="sm">
                    <ItemContent className="min-w-0 flex-1">
                      <p className="line-clamp-3 break-words text-[13px]">{inboxSummary(item)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {isUser ? inboxDeliveryLabel(item.delivery === "queue" ? "queue" : "steer") : item.type}
                      </p>
                      {isUser && index === 0 && item.delivery === "queue" ? (
                        <p className="text-[10px] text-muted-foreground">
                          Steering applies at the next opportunity, not instantly.
                        </p>
                      ) : null}
                      {isUser &&
                      ((item.payload.agents?.length ?? 0) > 0 ||
                        (item.payload.skills?.length ?? 0) > 0) ? (
                        <p className="text-[10px] text-muted-foreground">
                          Skills and agents from this prompt are not restored.
                        </p>
                      ) : null}
                    </ItemContent>
                    {isUser ? (
                      <ItemActions className="w-full flex-wrap">
                        {canSteerInboxItem(item, index) ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 px-2 text-[11px]"
                            aria-busy={action === "steer"}
                            disabled={busy}
                            onClick={() => void runQueueAction(item.id, "steer")}
                          >
                            {action === "steer" ? (
                              <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
                            ) : (
                              <MoveUpIcon aria-hidden="true" className="size-3.5" />
                            )}
                            {action === "steer" ? "Steering…" : "Steer current run"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 px-2 text-[11px]"
                          aria-busy={action === "edit"}
                          disabled={busy}
                          onClick={() => void runQueueAction(item.id, "edit")}
                        >
                          {action === "edit" ? (
                            <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
                          ) : (
                            <CornerUpLeftIcon aria-hidden="true" className="size-3.5" />
                          )}
                          {action === "edit" ? "Returning…" : "Return to draft"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-11 px-2 text-[11px]"
                          aria-busy={action === "cancel"}
                          aria-label={`Cancel queued prompt ${index + 1}`}
                          disabled={busy}
                          onClick={() => setCancelTarget(item.id)}
                        >
                          {action === "cancel" ? (
                            <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
                          ) : (
                            <XIcon aria-hidden="true" className="size-3.5" />
                          )}
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

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this queued prompt?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancel removes it from the native queue. Its text and files are
              not returned to your draft, and the prompt may already have been
              delivered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep prompt</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (cancelTarget) void runQueueAction(cancelTarget, "cancel")
                setCancelTarget(null)
              }}
            >
              Cancel prompt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
