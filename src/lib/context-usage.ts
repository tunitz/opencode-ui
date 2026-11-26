import type {
  ModelInfo,
  ModelRef,
  SessionInfo,
  SessionMessageInfo,
} from "@/lib/opencode"

/**
 * Native usage for the most recent assistant response.
 *
 * Every field is nullable: a missing or malformed native value stays missing
 * instead of being replaced with a guessed zero. Input/output and duration come
 * from the same assistant record, so a derived rate is never mixed across
 * different turns.
 */
export type ContextUsage = {
  input: number | null
  output: number | null
  reasoning: number | null
  cacheRead: number | null
  cacheWrite: number | null
  cost: number | null
  durationMs: number | null
  tokensPerSecond: number | null
  model: string | null
}

const EMPTY_USAGE: ContextUsage = {
  input: null,
  output: null,
  reasoning: null,
  cacheRead: null,
  cacheWrite: null,
  cost: null,
  durationMs: null,
  tokensPerSecond: null,
  model: null,
}

/** Native session-cumulative usage reported by the session record. */
export type SessionTotals = {
  input: number | null
  output: number | null
  reasoning: number | null
  cacheRead: number | null
  cacheWrite: number | null
  cost: number | null
}

const EMPTY_SESSION_TOTALS: SessionTotals = {
  input: null,
  output: null,
  reasoning: null,
  cacheRead: null,
  cacheWrite: null,
  cost: null,
}

export const MISSING_VALUE = "—"

function safeToken(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.trunc(value)
}

function safeTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }
  return value
}

function safeCost(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }
  return value
}

/** Latest assistant record wins, even when its native usage is incomplete. */
export function latestAssistantUsage(
  messages: readonly SessionMessageInfo[]
): ContextUsage {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message?.type !== "assistant") {
      continue
    }

    const tokens = message.tokens
    const input = safeToken(tokens?.input)
    const output = safeToken(tokens?.output)
    const created = safeTimestamp(message.time?.created)
    const completed = safeTimestamp(message.time?.completed)
    const durationMs =
      created !== null && completed !== null && completed >= created
        ? completed - created
        : null
    const tokensPerSecond =
      output !== null && durationMs !== null && durationMs > 0
        ? output / (durationMs / 1000)
        : null
    return {
      input,
      output,
      reasoning: safeToken(tokens?.reasoning),
      cacheRead: safeToken(tokens?.cache?.read),
      cacheWrite: safeToken(tokens?.cache?.write),
      cost: safeCost(message.cost),
      durationMs,
      tokensPerSecond,
      model: message.model
        ? `${message.model.providerID}/${message.model.id}`
        : null,
    }
  }

  return EMPTY_USAGE
}

/** Native session-cumulative tokens/cost; no derived totals are added. */
export function sessionTotals(session: SessionInfo | null): SessionTotals {
  if (!session) {
    return EMPTY_SESSION_TOTALS
  }

  return {
    input: safeToken(session.tokens?.input),
    output: safeToken(session.tokens?.output),
    reasoning: safeToken(session.tokens?.reasoning),
    cacheRead: safeToken(session.tokens?.cache?.read),
    cacheWrite: safeToken(session.tokens?.cache?.write),
    cost: safeCost(session.cost),
  }
}

/**
 * Compact "total tokens" convention shared with the stats chart: native input
 * plus output. A missing side keeps the total unavailable instead of showing a
 * partial sum as if it were the whole.
 */
export function totalTokens(
  input: number | null,
  output: number | null
): number | null {
  if (input === null || output === null) {
    return null
  }

  return input + output
}

/** Native model context window, matched by provider/id. */
export function contextLimitForModel(
  models: readonly ModelInfo[],
  model: ModelRef | null | undefined
): number | null {
  if (!model) {
    return null
  }

  const match = models.find(
    (candidate) =>
      candidate.providerID === model.providerID && candidate.id === model.id
  )
  const limit = match?.limit?.context

  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return null
  }

  return Math.trunc(limit)
}

/**
 * Elapsed time from a native run start timestamp. A missing, non-positive, or
 * future start (clock skew) is unavailable rather than a fabricated timer.
 */
export function elapsedMs(
  startedAt: number | null,
  now: number
): number | null {
  if (
    startedAt === null ||
    startedAt <= 0 ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(now) ||
    now < startedAt
  ) {
    return null
  }

  return now - startedAt
}

function compact(value: number, suffix: string): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${Number(value.toFixed(digits))}${suffix}`
}

/** Compact native token count; a missing value is shown as an em dash. */
export function formatTokenCount(value: number | null): string {
  if (value === null) return MISSING_VALUE
  if (value < 1000) return String(value)
  if (value < 1_000_000) return compact(value / 1000, "k")
  if (value < 1_000_000_000) return compact(value / 1_000_000, "m")
  return compact(value / 1_000_000_000, "b")
}

/** Output-token rate in tokens per second, without the unit label. */
export function formatTokensPerSecond(value: number | null): string {
  if (value === null) return MISSING_VALUE
  if (value >= 100) return String(Math.round(value))
  const digits = value >= 10 ? 1 : 2
  return String(Number(value.toFixed(digits)))
}

/** Elapsed native duration, or an em dash when timestamps are unavailable. */
export function formatDurationMs(value: number | null): string {
  if (value === null) return MISSING_VALUE

  const totalMs = Math.max(0, Math.round(value))
  if (totalMs < 1000) return `${totalMs}ms`

  const seconds = totalMs / 1000
  if (seconds < 10) return `${Number(seconds.toFixed(1))}s`
  if (seconds < 60) return `${Math.round(seconds)}s`

  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${String(rest).padStart(2, "0")}s`
}

export function formatCost(value: number | null): string {
  return value === null ? MISSING_VALUE : `$${value.toFixed(2)}`
}
