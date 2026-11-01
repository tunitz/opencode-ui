/**
 * Bounded exponential backoff with jitter for the event-stream reconnect loop.
 * The stream is volatile and has no replay, so retries must neither hammer the
 * backend nor give up: the delay caps at `RECONNECT_MAX_MS`.
 */

export const RECONNECT_BASE_MS = 1000
export const RECONNECT_MAX_MS = 30000

/**
 * Delay in ms for a reconnect attempt. `random` is injectable so tests are
 * deterministic; jitter is ±20% of the exponential value.
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random
): number {
  const n = Math.max(0, Math.floor(attempt))
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** n)
  const jitter = (random() - 0.5) * 0.4

  return Math.max(0, Math.round(exponential * (1 + jitter)))
}
