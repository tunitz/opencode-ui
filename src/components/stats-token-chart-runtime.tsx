import { BarChart } from "@openuidev/react-ui/Charts/BarChart"
import { ThemeProvider, type Theme } from "@openuidev/react-ui/ThemeProvider"
import "@openuidev/react-ui/styles/charts.css"
import "@openuidev/react-ui/styles/button.css"
import "@openuidev/react-ui/styles/iconButton.css"
import "@openuidev/react-ui/styles/separator.css"

import type { StatsTokenRow } from "@/lib/stats-chart"

const chartTheme: Theme = {
  background: "var(--card)",
  foreground: "var(--card)",
  textNeutralPrimary: "var(--foreground)",
  textNeutralSecondary: "var(--muted-foreground)",
  textNeutralTertiary: "var(--muted-foreground)",
  borderDefault: "var(--border)",
  borderInteractive: "var(--border)",
  borderInteractiveSelected: "var(--ring)",
  sunk: "var(--muted)",
  highlightSubtle: "color-mix(in oklch, var(--muted) 45%, transparent)",
  textLabelXs: "400 11px/16px 'Geist Variable', sans-serif",
  textLabelXsLetterSpacing: "0",
  textLabelSm: "500 12px/16px 'Geist Variable', sans-serif",
  textLabelSmLetterSpacing: "0",
  textBodyDefault: "400 12px/16px 'Geist Variable', sans-serif",
  textBodyDefaultLetterSpacing: "0",
  fontVariationRegular: "normal",
  fontVariationMedium: "normal",
}

const lightPalette = ["#0b5bd3", "#0f6b3c"]
const darkPalette = ["#82b8ff", "#8fe0a7"]

export default function StatsTokenChartRuntime({
  rows,
  mode,
  height,
}: {
  rows: StatsTokenRow[]
  mode: "light" | "dark"
  height: number
}) {
  const data = rows.map((row) => ({
    model: row.label,
    Input: row.input,
    Output: row.output,
  }))

  return (
    <ThemeProvider
      mode={mode}
      cssSelector=".openui-chart-scope"
      lightTheme={chartTheme}
      darkTheme={chartTheme}
    >
      <div
        className="openui-chart-scope"
        data-openui-stats-chart="true"
        data-chart-models={rows.length}
        dir="ltr"
      >
        <BarChart
          data={data}
          categoryKey="model"
          orientation="horizontal"
          customPalette={mode === "dark" ? darkPalette : lightPalette}
          height={height}
          density="compact"
          legend
          isAnimationActive={false}
        />
      </div>
    </ThemeProvider>
  )
}
