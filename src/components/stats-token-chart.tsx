import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react"

import { useTheme } from "@/components/theme-provider"
import type { StatsTokenRow } from "@/lib/stats-chart"

const LazyStatsTokenChart = lazy(
  () => import("@/components/stats-token-chart-runtime")
)

function currentMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light"
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function useResolvedMode() {
  const { theme } = useTheme()
  const [mode, setMode] = useState<"light" | "dark">(currentMode)

  useEffect(() => {
    const update = () => setMode(currentMode())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [theme])

  return mode
}

class StatsTokenChartErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function ChartFallback({ height, text }: { height: number; text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 text-center text-xs text-muted-foreground"
      style={{ height }}
    >
      {text}
    </div>
  )
}

export function StatsTokenChart({
  rows,
  height = 300,
}: {
  rows: StatsTokenRow[]
  height?: number
}) {
  const mode = useResolvedMode()

  return (
    <StatsTokenChartErrorBoundary
      fallback={
        <ChartFallback
          height={height}
          text="Chart unavailable. Native model token totals remain below."
        />
      }
    >
      <Suspense
        fallback={<ChartFallback height={height} text="Loading token chart…" />}
      >
        <LazyStatsTokenChart
          rows={rows}
          mode={mode}
          height={height}
        />
      </Suspense>
    </StatsTokenChartErrorBoundary>
  )
}
