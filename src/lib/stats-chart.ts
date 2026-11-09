import type { SessionStatsInfo } from "@/lib/opencode"

export type StatsTokenRow = {
  key: string
  label: string
  input: number
  output: number
  total: number
}

export type StatsTokenChart = {
  rows: StatsTokenRow[]
  chartRows: StatsTokenRow[]
  totalInput: number
  totalOutput: number
  invalidValues: number
}

function safeToken(value: unknown): { value: number; invalid: boolean } {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return { value: 0, invalid: true }
  }
  return { value: Math.trunc(value), invalid: false }
}

/**
 * Project the native `SessionStatsInfo.models` totals into a small, finite
 * chart. Only native input/output token fields are used; cost is deliberately
 * not plotted because a reported zero can mean unavailable pricing. Rows with
 * no nonzero tokens remain in `rows` for the text equivalent but are omitted
 * from the chart so an empty stats view stays honest.
 */
export function buildStatsTokenChart(stats: SessionStatsInfo): StatsTokenChart {
  let invalidValues = 0
  const rows = stats.models.map((entry) => {
    const input = safeToken(entry.tokens?.input)
    const output = safeToken(entry.tokens?.output)
    if (input.invalid) invalidValues += 1
    if (output.invalid) invalidValues += 1

    const providerID = String(entry.model.providerID)
    const modelID = String(entry.model.id)
    const variant = entry.model.variant ? ` · ${entry.model.variant}` : ""

    return {
      key: `${providerID}/${modelID}/${entry.model.variant ?? ""}`,
      label: `${providerID}/${modelID}${variant}`,
      input: input.value,
      output: output.value,
      total: input.value + output.value,
    }
  })

  const chartRows = rows
    .filter((row) => row.total > 0)
    .toSorted(
      (a, b) =>
        b.total - a.total ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key)
    )

  return {
    rows,
    chartRows,
    totalInput: rows.reduce((sum, row) => sum + row.input, 0),
    totalOutput: rows.reduce((sum, row) => sum + row.output, 0),
    invalidValues,
  }
}
