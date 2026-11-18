/**
 * Liveness watchdog for a long-lived event stream. Every `arm()` restarts the
 * countdown; if no frame arrives before the deadline, `onStale` runs exactly
 * once. Disposing cancels any pending deadline.
 */
export type StreamWatchdog = {
  arm(): void
  dispose(): void
}

export function createStreamWatchdog(
  onStale: () => void,
  staleMs = 60_000
): StreamWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  return {
    arm() {
      if (disposed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!disposed) onStale()
      }, staleMs)
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
