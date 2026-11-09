import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { ChevronRightIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  contextLimitForModel,
  elapsedMs,
  formatCost,
  formatDurationMs,
  formatTokenCount,
  formatTokensPerSecond,
  latestAssistantUsage,
  MISSING_VALUE,
  sessionTotals,
  totalTokens,
} from "@/lib/context-usage"
import { liveRunStore } from "@/lib/live-run-store"
import type {
  ModelInfo,
  SessionInfo,
  SessionMessageInfo,
  SessionRevert,
} from "@/lib/opencode"
import { cn } from "@/lib/utils"

function Metric({
  label,
  name,
  value,
}: {
  label: string
  name: string
  value: string
}) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap">
      <span aria-hidden="true" className="text-muted-foreground">
        {label}
      </span>
      <span className="sr-only">{name}: </span>
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate tabular-nums text-foreground" title={value}>
        {value}
      </dd>
    </div>
  )
}

/**
 * Subscribe only to the active state and native start instant. Token deltas
 * keep the same snapshot, so the strip does not re-render per streamed token.
 */
function useLiveRunTiming(sessionID: string | null): {
  active: boolean
  startedAt: number | null
} {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      sessionID
        ? liveRunStore.subscribe(sessionID, onStoreChange)
        : () => {},
    [sessionID]
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      if (!sessionID) return ""
      const run = liveRunStore.getRun(sessionID)
      return run ? `${run.status}|${run.startedAt ?? ""}` : ""
    },
    () => ""
  )

  const separator = snapshot.indexOf("|")
  if (separator === -1) {
    return { active: false, startedAt: null }
  }

  const status = snapshot.slice(0, separator)
  const rawStartedAt = snapshot.slice(separator + 1)
  const parsedStartedAt = rawStartedAt ? Number(rawStartedAt) : null

  return {
    active: status === "running",
    startedAt:
      parsedStartedAt !== null && Number.isFinite(parsedStartedAt)
        ? parsedStartedAt
        : null,
  }
}

/** Re-render once per second while a trustworthy native run timer is active. */
function useElapsedSince(startedAt: number | null): number | null {
  const [clock, setClock] = useState<{
    startedAt: number | null
    now: number
  }>({ startedAt: null, now: 0 })

  useEffect(() => {
    if (startedAt === null) {
      return
    }

    // Tag the sample with its run start so a different execution never reads
    // a stale clock before the first update lands.
    const update = () => setClock({ startedAt, now: Date.now() })
    const frame = window.requestAnimationFrame(update)
    const timer = window.setInterval(update, 1000)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
    }
  }, [startedAt])

  if (startedAt === null || clock.startedAt !== startedAt) {
    return null
  }

  return elapsedMs(startedAt, clock.now)
}

/**
 * Composer-adjacent usage strip. It is collapsed by default and only reports
 * native token/timestamp values; any unavailable field is shown as an em dash
 * rather than inferred. Scopes are kept separate: last response, live run,
 * session cumulative totals, and the model context window.
 */
export function ContextStrip({
  sessionID,
  hasSession,
  session,
  messages,
  models,
  revert,
}: {
  sessionID: string | null
  hasSession: boolean
  session: SessionInfo | null
  messages: readonly SessionMessageInfo[]
  models: readonly ModelInfo[]
  revert: SessionRevert | null
}) {
  const [open, setOpen] = useState(false)
  const timing = useLiveRunTiming(sessionID)
  const runElapsed = useElapsedSince(timing.active ? timing.startedAt : null)
  const visibleMessages = useMemo(() => {
    if (!revert) return messages
    const boundary = messages.findIndex(
      (message) => message.id === revert.messageID
    )
    return boundary === -1 ? messages : messages.slice(0, boundary)
  }, [messages, revert])
  const usage = useMemo(
    () => latestAssistantUsage(visibleMessages),
    [visibleMessages]
  )
  const totals = useMemo(() => sessionTotals(session), [session])
  const totalTokensForSession = totalTokens(totals.input, totals.output)
  const contextLimit = useMemo(
    () => contextLimitForModel(models, session?.model),
    [models, session?.model]
  )

  if (!hasSession) {
    return null
  }

  return (
    <div className="border-t border-border/60 bg-background px-3 md:px-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md text-start text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:text-[13px]">
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <Metric
              label="in"
              name="Last response input tokens"
              value={formatTokenCount(usage.input)}
            />
            <Metric
              label="out"
              name="Last response output tokens"
              value={formatTokenCount(usage.output)}
            />
            <Metric
              label="total"
              name="Session total tokens (input plus output)"
              value={formatTokenCount(totalTokensForSession)}
            />
            <Metric
              label="t/s"
              name="Last response tokens per second"
              value={formatTokensPerSecond(usage.tokensPerSecond)}
            />
            <Metric
              label="last"
              name="Last response duration"
              value={formatDurationMs(usage.durationMs)}
            />
            {timing.active ? (
              <Metric
                label="run"
                name="Current run elapsed"
                value={formatDurationMs(runElapsed)}
              />
            ) : null}
          </span>
          <span className="sr-only">
            {open ? "Hide response usage details" : "Show response usage details"}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 pt-1 pb-3 text-[11px] md:text-[13px]">
            <section>
              <h4 className="mb-1 font-medium text-foreground">Last response</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                <Detail
                  label="Input tokens"
                  value={formatTokenCount(usage.input)}
                />
                <Detail
                  label="Output tokens"
                  value={formatTokenCount(usage.output)}
                />
                <Detail
                  label="Reasoning tokens"
                  value={formatTokenCount(usage.reasoning)}
                />
                <Detail
                  label="Cache read"
                  value={formatTokenCount(usage.cacheRead)}
                />
                <Detail
                  label="Cache write"
                  value={formatTokenCount(usage.cacheWrite)}
                />
                <Detail
                  label="Speed"
                  value={
                    usage.tokensPerSecond === null
                      ? MISSING_VALUE
                      : `${formatTokensPerSecond(usage.tokensPerSecond)} t/s`
                  }
                />
                <Detail
                  label="Duration"
                  value={formatDurationMs(usage.durationMs)}
                />
                <Detail label="Cost" value={formatCost(usage.cost)} />
                <Detail
                  label="Model"
                  value={usage.model ?? MISSING_VALUE}
                />
              </dl>
            </section>
            <section>
              <h4 className="mb-1 font-medium text-foreground">Session total</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                <Detail
                  label="Input tokens"
                  value={formatTokenCount(totals.input)}
                />
                <Detail
                  label="Output tokens"
                  value={formatTokenCount(totals.output)}
                />
                <Detail
                  label="Reasoning tokens"
                  value={formatTokenCount(totals.reasoning)}
                />
                <Detail
                  label="Cache read"
                  value={formatTokenCount(totals.cacheRead)}
                />
                <Detail
                  label="Cache write"
                  value={formatTokenCount(totals.cacheWrite)}
                />
                <Detail label="Cost" value={formatCost(totals.cost)} />
              </dl>
            </section>
            <section>
              <h4 className="mb-1 font-medium text-foreground">Model</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                <Detail
                  label="Selected"
                  value={
                    session?.model
                      ? `${session.model.providerID}/${session.model.id}`
                      : MISSING_VALUE
                  }
                />
                <Detail
                  label="Context limit"
                  value={
                    contextLimit === null
                      ? MISSING_VALUE
                      : `${formatTokenCount(contextLimit)} tokens`
                  }
                />
              </dl>
            </section>
            {timing.active ? (
              <section>
                <h4 className="mb-1 font-medium text-foreground">
                  Current run
                </h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  <Detail
                    label="Elapsed"
                    value={formatDurationMs(runElapsed)}
                  />
                </dl>
              </section>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
