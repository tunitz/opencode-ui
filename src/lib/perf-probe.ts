export type PerfProbeState = {
  enabled: boolean
  counts: Record<string, number>
  longtasks: Array<{ startTime: number; duration: number }>
  marks: Array<{ name: string; at: number; detail?: unknown }>
}

declare global {
  interface Window {
    __opencodePerf?: PerfProbeState
  }
}

/** Test-only render probe. Inert unless the browser test installs the global. */
export function recordPerfRender(name: string): void {
  if (typeof window === "undefined") return
  const perf = window.__opencodePerf
  if (!perf?.enabled) return
  perf.counts[name] = (perf.counts[name] ?? 0) + 1
}

/** Test-only mark helper; never writes network or storage. */
export function recordPerfMark(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return
  const perf = window.__opencodePerf
  if (!perf?.enabled) return
  perf.marks.push({ name, at: performance.now(), detail })
}
