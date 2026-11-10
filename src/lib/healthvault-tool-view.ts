// HealthVault tool output is untrusted data. Everything in this module is
// parsed with JSON.parse and reduced to plain strings for React to escape.
// Nothing here evaluates code, follows URLs, or produces markup.

const PREFIX = "healthvault_"
const MAX_ROWS = 25
const MAX_CELL = 160
const MAX_SUMMARY = 160
const MAX_NOTE = 300

export type HealthvaultViewKind =
  | "context"
  | "profile"
  | "nutrition-day"
  | "nutrition-summary"
  | "nutrition-targets"
  | "record-types"
  | "records"
  | "uploads"
  | "supplements"
  | "supplement-history"
  | "workouts"
  | "measurements"
  | "foods"
  | "metrics"
  | "result"

export type HealthvaultStatItem = { label: string; value: string }

export type HealthvaultStatsBlock = {
  kind: "stats"
  title: string
  items: HealthvaultStatItem[]
}

export type HealthvaultTableBlock = {
  kind: "table"
  caption: string
  columns: string[]
  rows: string[][]
  moreRows: number
}

export type HealthvaultTextBlock = { kind: "text"; text: string }

export type HealthvaultBlock =
  | HealthvaultStatsBlock
  | HealthvaultTableBlock
  | HealthvaultTextBlock

export type HealthvaultContentView = {
  kind: HealthvaultViewKind
  tool: string
  title: string
  summary: string
  blocks: HealthvaultBlock[]
}

export type HealthvaultFallbackReason =
  | "empty-output"
  | "invalid-json"
  | "tool-error"
  | "error-status"
  | "unknown-shape"
  | "unsupported-tool"

export type HealthvaultFallbackView = {
  kind: "fallback"
  tool: string
  title: string
  summary: string
  reason: HealthvaultFallbackReason
  message: string
}

export type HealthvaultToolView = HealthvaultContentView | HealthvaultFallbackView

export type HealthvaultParseFailure = {
  ok: false
  reason: "empty-output" | "invalid-json" | "tool-error"
  message: string
}

export type HealthvaultParseResult =
  | { ok: true; value: unknown }
  | HealthvaultParseFailure

type JsonRecord = Record<string, unknown>

const MEALS: ReadonlyArray<readonly [string, string]> = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
  ["snack", "Snack"],
]

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const MACROS: ReadonlyArray<{
  key: string
  label: string
  unit: string
  digits: number
}> = [
  { key: "kcal", label: "Calories", unit: "kcal", digits: 0 },
  { key: "proteinG", label: "Protein", unit: "g", digits: 0 },
  { key: "carbsG", label: "Carbs", unit: "g", digits: 0 },
  { key: "fatG", label: "Fat", unit: "g", digits: 0 },
  { key: "fibreG", label: "Fibre", unit: "g", digits: 0 },
  { key: "sodiumMg", label: "Sodium", unit: "mg", digits: 0 },
]

export function healthvaultToolName(
  name: string | null | undefined
): string | null {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  if (trimmed.length <= PREFIX.length) return null
  if (trimmed.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return null
  const tool = trimmed.slice(PREFIX.length).trim().toLowerCase()
  return tool || null
}

export function isHealthvaultTool(name: string | null | undefined): boolean {
  return healthvaultToolName(name) !== null
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function array(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function first(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const text = value.trim().replace(/,/g, "")
    if (!text) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const numberFormats = new Map<number, Intl.NumberFormat>()

function numberFormat(digits: number): Intl.NumberFormat {
  const bounded = Math.max(0, Math.min(6, Math.trunc(digits)))
  const cached = numberFormats.get(bounded)
  if (cached) return cached
  const format = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: bounded,
  })
  numberFormats.set(bounded, format)
  return format
}

/** Format a finite number; non-finite values disappear instead of printing NaN/Infinity. */
export function healthvaultNumber(
  value: unknown,
  maxFractionDigits = 1
): string {
  const parsed = numberValue(value)
  if (parsed === null) return ""
  const normalized = Object.is(parsed, -0) ? 0 : parsed
  return numberFormat(maxFractionDigits).format(normalized)
}

function boundText(text: string, max = MAX_CELL): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Coerce one rendered primitive to a bounded, single-line plain string. */
export function healthvaultTextValue(value: unknown, max = MAX_CELL): string {
  let text: string
  if (typeof value === "string") text = value
  else if (typeof value === "number") text = healthvaultNumber(value, 2)
  else if (typeof value === "boolean") text = value ? "yes" : "no"
  else return ""
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized ? boundText(normalized, max) : ""
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ")
}

function boundSummary(summary: string): string {
  return boundText(summary.replace(/\s+/g, " ").trim(), MAX_SUMMARY)
}

function humanize(value: string): string {
  const text = value.replace(/_/g, " ").replace(/\s+/g, " ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}

function typeLabel(value: unknown): string {
  const text = healthvaultTextValue(value, 120)
  if (!text) return ""
  const stripped = text
    .replace(/^HKQuantityTypeIdentifier/, "")
    .replace(/^HKCategoryTypeIdentifier/, "")
    .replace(/^HKWorkoutActivityType/, "")
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || text
}

function plural(count: number, singular: string, pluralWord?: string): string {
  return count === 1 ? singular : (pluralWord ?? `${singular}s`)
}

function amount(value: unknown, unit: unknown, digits = 1): string {
  const formatted = healthvaultNumber(value, digits)
  if (!formatted) return ""
  const suffix = healthvaultTextValue(unit, 20)
  return suffix ? `${formatted} ${suffix}` : formatted
}

function weekdayName(value: unknown): string {
  const index = numberValue(value)
  if (index === null || index < 0 || index > 6) {
    return healthvaultTextValue(value, 20)
  }
  return WEEKDAYS[Math.trunc(index)] ?? ""
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  const direct = record(value)
  if (direct) return direct
  if (typeof value !== "string" || !value.trim()) return null
  try {
    return record(JSON.parse(value))
  } catch {
    return null
  }
}

function scheduleLabel(schedule: JsonRecord | null, max = 90): string {
  if (!schedule) return ""
  const time = healthvaultTextValue(schedule.time, 8)
  const rawDays = array(schedule.days)
  const days = rawDays
    ? rawDays
        .map((day) => numberValue(day))
        .filter((day): day is number => day !== null && day >= 0 && day <= 6)
    : null
  const daysLabel =
    days && days.length > 0 && days.length < 7
      ? days.map((day) => WEEKDAYS[Math.trunc(day)]).join(", ")
      : "Every day"
  const note = healthvaultTextValue(schedule.note, 60)
  return healthvaultTextValue(
    joinParts([time, daysLabel, note]),
    max
  )
}

function doseLabel(supplement: JsonRecord | null): string {
  if (!supplement) return ""
  const dose = numberValue(supplement.dose)
  const unit = healthvaultTextValue(supplement.unit, 30)
  if (dose === null) return healthvaultTextValue(supplement.dose, 30)
  return `${healthvaultNumber(dose, 2)}${unit ? ` ${unit}` : ""}`
}

function statsBlock(
  title: string,
  items: HealthvaultStatItem[]
): HealthvaultStatsBlock | null {
  const visible = items.filter((item) => item.value !== "")
  return visible.length > 0 ? { kind: "stats", title, items: visible } : null
}

function tableBlock(
  caption: string,
  columns: string[],
  rows: string[][],
  rowCap = MAX_ROWS
): HealthvaultTableBlock | null {
  if (rows.length === 0) return null
  return {
    kind: "table",
    caption,
    columns,
    rows: rows.slice(0, rowCap),
    moreRows: Math.max(0, rows.length - rowCap),
  }
}

function textBlock(text: unknown): HealthvaultTextBlock | null {
  const value = healthvaultTextValue(text, MAX_NOTE)
  return value ? { kind: "text", text: value } : null
}

function content(
  kind: HealthvaultViewKind,
  tool: string,
  title: string,
  summary: string,
  blocks: Array<HealthvaultBlock | null>
): HealthvaultContentView {
  return {
    kind,
    tool,
    title: healthvaultTextValue(title, 120) || tool,
    summary: boundSummary(summary),
    blocks: blocks.filter(
      (block): block is HealthvaultBlock => block !== null
    ),
  }
}

function fallbackView(
  tool: string,
  reason: HealthvaultFallbackReason,
  message: string,
  summary: string
): HealthvaultFallbackView {
  return {
    kind: "fallback",
    tool,
    title: `${tool} result`,
    summary: boundSummary(summary),
    reason,
    message: healthvaultTextValue(message, MAX_NOTE) || "No details available.",
  }
}

function unwrapResult(
  value: unknown,
  depth = 0
): { value: unknown } | { error: string } {
  if (depth > 5) return { value }
  if (isRecord(value)) {
    if (value.ok === false) {
      return {
        error:
          healthvaultTextValue(first(value.error, value.message), MAX_NOTE) ||
          "The tool reported an error.",
      }
    }
    if ("result" in value) return unwrapResult(value.result, depth + 1)
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    const looksLikeJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    if (looksLikeJson) {
      try {
        return unwrapResult(JSON.parse(trimmed), depth + 1)
      } catch {
        return { value }
      }
    }
  }
  return { value }
}

/** JSON.parse only; wrappers such as `{ ok, tool, result }` are unwrapped. */
export function parseHealthvaultOutput(
  output: string | null | undefined
): HealthvaultParseResult {
  if (typeof output !== "string" || !output.trim()) {
    return {
      ok: false,
      reason: "empty-output",
      message: "The tool did not return any output.",
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim())
  } catch {
    return {
      ok: false,
      reason: "invalid-json",
      message: "The tool output is not valid JSON.",
    }
  }
  const unwrapped = unwrapResult(parsed)
  if ("error" in unwrapped) {
    return { ok: false, reason: "tool-error", message: unwrapped.error }
  }
  return { ok: true, value: unwrapped.value }
}

function macroItems(
  totals: JsonRecord | null,
  targets: JsonRecord | null
): HealthvaultStatItem[] {
  return MACROS.map((macro) => {
    const total = numberValue(totals?.[macro.key])
    const target = numberValue(targets?.[macro.key])
    if (total === null && target === null) {
      return { label: macro.label, value: "" }
    }
    const suffix = macro.unit ? ` ${macro.unit}` : ""
    if (target === null) {
      return {
        label: macro.label,
        value: `${healthvaultNumber(total, macro.digits)}${suffix}`,
      }
    }
    const totalText =
      total === null ? "—" : healthvaultNumber(total, macro.digits)
    return {
      label: macro.label,
      value: `${totalText} / ${healthvaultNumber(target, macro.digits)}${suffix}`,
    }
  })
}

function nutritionStatsBlock(nutrition: JsonRecord): HealthvaultStatsBlock | null {
  return statsBlock(
    "Macros",
    macroItems(record(nutrition.totals), record(nutrition.targets))
  )
}

function remainingBlock(nutrition: JsonRecord): HealthvaultStatsBlock | null {
  const remaining = record(nutrition.remaining)
  if (!remaining) return null
  return statsBlock("Remaining", [
    { label: "Calories", value: amount(remaining.kcal, "kcal", 0) },
    { label: "Protein", value: amount(remaining.proteinG, "g", 0) },
    { label: "Carbs", value: amount(remaining.carbsG, "g", 0) },
    { label: "Fat", value: amount(remaining.fatG, "g", 0) },
  ])
}

function mealRow(entry: JsonRecord): string[] {
  const name =
    healthvaultTextValue(
      first(entry.name, entry.foodName, entry.title),
      120
    ) || "Entry"
  const estimated = entry.estimated === 1 || entry.estimated === true
  return [
    estimated ? `${name} (estimated)` : name,
    amount(entry.grams, "g", 0) ||
      amount(entry.servingGrams, "g", 0),
    healthvaultNumber(entry.kcal, 0),
    healthvaultNumber(entry.proteinG, 0),
    healthvaultNumber(entry.carbsG, 0),
    healthvaultNumber(entry.fatG, 0),
  ]
}

function mealBlocks(meals: JsonRecord | null): Array<HealthvaultBlock | null> {
  if (!meals) return []
  return MEALS.map(([key, label]) => {
    const entries = array(meals[key])
    if (!entries || entries.length === 0) return null
    const rows = entries.map((entry) => mealRow(record(entry) ?? {}))
    return tableBlock(
      `${label} · ${entries.length} ${plural(entries.length, "entry", "entries")}`,
      ["Food", "Amount", "kcal", "Protein", "Carbs", "Fat"],
      rows
    )
  })
}

function estimatedBlock(nutrition: JsonRecord): HealthvaultTextBlock | null {
  const estimated = numberValue(nutrition.estimatedEntries)
  if (estimated === null || estimated <= 0) return null
  return textBlock(
    `${healthvaultNumber(estimated, 0)} estimated ${plural(
      estimated,
      "entry",
      "entries"
    )}.`
  )
}

function profileStatsBlock(
  profile: JsonRecord,
  age: unknown
): HealthvaultStatsBlock | null {
  return statsBlock("Profile", [
    { label: "Name", value: healthvaultTextValue(profile.name, 80) },
    { label: "Age", value: healthvaultNumber(age, 0) },
    { label: "Sex", value: healthvaultTextValue(profile.sex, 20) },
    { label: "Height", value: amount(profile.heightCm, "cm", 0) },
    {
      label: "Timezone",
      value: healthvaultTextValue(profile.timezone, 80),
    },
    { label: "Units", value: healthvaultTextValue(profile.units, 20) },
    { label: "Goal weight", value: amount(profile.goalWeightKg, "kg", 1) },
    { label: "Birth date", value: healthvaultTextValue(profile.birthDate, 20) },
  ])
}

function profileNoteBlocks(
  profile: JsonRecord
): Array<HealthvaultBlock | null> {
  return [
    ["Goals", profile.goalsNote],
    ["Diet", profile.dietNote],
    ["Activity", profile.activityNote],
  ].flatMap(([label, value]) => {
    const text = healthvaultTextValue(value, MAX_NOTE)
    return text ? [textBlock(`${label}: ${text}`)] : []
  })
}

function workScheduleBlocks(
  profile: JsonRecord
): Array<HealthvaultBlock | null> {
  const schedule = parseJsonRecord(
    first(profile.workSchedule, profile.workScheduleJson)
  )
  if (!schedule) return []
  const days = array(schedule.days) ?? []
  const rows: string[][] = []
  for (const item of days) {
    const day = record(item)
    if (!day) continue
    rows.push([
      weekdayName(day.weekday),
      healthvaultTextValue(day.start, 8),
      healthvaultTextValue(day.end, 8),
    ])
  }
  const note = healthvaultTextValue(schedule.note, 240)
  return [
    tableBlock("Work schedule", ["Day", "Start", "End"], rows),
    note ? textBlock(`Schedule note: ${note}`) : null,
  ]
}

function weightBlocks(
  weight: JsonRecord | null
): Array<HealthvaultBlock | null> {
  if (!weight) return []
  const latest = record(weight.latest)
  const change = numberValue(weight.change7dKg)
  const goal = numberValue(weight.goalKg)
  const stats = statsBlock("Weight", [
    {
      label: "Latest",
      value: latest
        ? joinParts([
            amount(latest.value, latest.unit, 1),
            healthvaultTextValue(latest.day, 20),
          ])
        : "",
    },
    {
      label: "7-day change",
      value:
        change === null
          ? ""
          : `${change > 0 ? "+" : ""}${healthvaultNumber(change, 1)} kg`,
    },
    { label: "Goal", value: amount(goal, "kg", 1) },
  ])
  const points = array(weight.points) ?? []
  const rows = points.map((point) => {
    const row = record(point) ?? {}
    return [
      healthvaultTextValue(row.day, 20),
      healthvaultNumber(row.value, 1),
      healthvaultTextValue(row.unit, 10),
      healthvaultTextValue(row.source, 80),
    ]
  })
  return [
    stats,
    tableBlock("Weight trend", ["Day", "Weight", "Unit", "Source"], rows),
  ]
}

function checklistParts(
  checklist: JsonRecord | null
): { taken: number | null; total: number | null } {
  if (!checklist) return { taken: null, total: null }
  const items = array(checklist.items)
  return {
    taken: numberValue(checklist.taken),
    total: numberValue(checklist.total) ?? (items ? items.length : null),
  }
}

function supplementStatsBlock(
  checklist: JsonRecord | null,
  next?: JsonRecord | null
): HealthvaultStatsBlock | null {
  if (!checklist) return null
  const { taken, total } = checklistParts(checklist)
  const nextSupplement = record(next?.supplement)
  const nextSchedule = record(next?.schedule)
  return statsBlock("Supplements", [
    {
      label: "Taken",
      value:
        taken !== null && total !== null
          ? `${healthvaultNumber(taken, 0)} / ${healthvaultNumber(total, 0)}`
          : "",
    },
    { label: "Day", value: healthvaultTextValue(checklist.day, 20) },
    {
      label: "Next",
      value: nextSupplement
        ? joinParts([
            healthvaultTextValue(nextSupplement.name, 80),
            scheduleLabel(nextSchedule, 60),
          ])
        : "",
    },
  ])
}

function supplementChecklistTable(
  checklist: JsonRecord | null
): HealthvaultTableBlock | null {
  if (!checklist) return null
  const items = array(checklist.items) ?? []
  const rows = items.map((item) => {
    const entry = record(item) ?? {}
    const supplement = record(entry.supplement)
    return [
      healthvaultTextValue(supplement?.name, 120),
      doseLabel(supplement),
      scheduleLabel(record(entry.schedule)),
      entry.logged === true ? "Taken" : "Not logged",
    ]
  })
  const { taken, total } = checklistParts(checklist)
  const caption =
    taken !== null && total !== null
      ? `Checklist · ${healthvaultNumber(taken, 0)}/${healthvaultNumber(total, 0)} taken`
      : "Checklist"
  return tableBlock(
    caption,
    ["Supplement", "Dose", "Schedule", "Today"],
    rows
  )
}

function supplementCatalogTable(
  supplements: unknown[]
): HealthvaultTableBlock | null {
  const rows = supplements.map((item) => {
    const supplement = record(item) ?? {}
    return [
      healthvaultTextValue(supplement.name, 120),
      doseLabel(supplement),
      scheduleLabel(parseJsonRecord(supplement.scheduleJson)),
      supplement.active === 0 || supplement.active === false
        ? "Inactive"
        : "Active",
    ]
  })
  return tableBlock("Supplements", ["Name", "Dose", "Schedule", "Status"], rows)
}

function supplementHistoryTable(
  days: unknown[]
): HealthvaultTableBlock | null {
  const rows = days.map((item) => {
    const day = record(item) ?? {}
    const taken = numberValue(day.taken)
    const items = array(day.items) ?? []
    const names = items
      .map((entry) => healthvaultTextValue(record(entry)?.name, 60))
      .filter(Boolean)
      .join(", ")
    return [
      healthvaultTextValue(day.day, 20),
      taken === null ? "" : healthvaultNumber(taken, 0),
      names ? healthvaultTextValue(names, 200) : "",
    ]
  })
  return tableBlock("Intake by day", ["Day", "Doses", "Supplements"], rows)
}

function pace(value: unknown): string {
  const minutes = numberValue(value)
  if (minutes === null || minutes <= 0) return ""
  const whole = Math.floor(minutes)
  let seconds = Math.round((minutes - whole) * 60)
  let adjusted = whole
  if (seconds === 60) {
    adjusted += 1
    seconds = 0
  }
  return `${adjusted}:${String(seconds).padStart(2, "0")} /km`
}

function workoutRows(workouts: unknown[]): string[][] {
  return workouts.map((item) => {
    const workout = record(item) ?? {}
    return [
      healthvaultTextValue(workout.day, 20),
      typeLabel(workout.type),
      amount(workout.minutes, "min", 0),
      amount(workout.km, "km", 1),
      amount(workout.kcal, "kcal", 0),
      pace(workout.paceMinPerKm),
      amount(workout.speedKmh, "km/h", 1),
      amount(workout.avgHr, "bpm", 0),
      healthvaultTextValue(workout.sourceName, 80),
    ]
  })
}

const WORKOUT_COLUMNS = [
  "Day",
  "Type",
  "Time",
  "Distance",
  "Energy",
  "Pace",
  "Speed",
  "Avg HR",
  "Source",
]

function workoutsTable(
  workouts: unknown[]
): HealthvaultTableBlock | null {
  return tableBlock("Workouts", WORKOUT_COLUMNS, workoutRows(workouts))
}

function workoutStatsBlock(
  workouts: unknown[]
): HealthvaultStatsBlock | null {
  let minutes = 0
  let km = 0
  let kcal = 0
  for (const item of workouts) {
    const workout = record(item) ?? {}
    minutes += numberValue(workout.minutes) ?? 0
    km += numberValue(workout.km) ?? 0
    kcal += numberValue(workout.kcal) ?? 0
  }
  return statsBlock("Training", [
    { label: "Workouts", value: healthvaultNumber(workouts.length, 0) },
    { label: "Total time", value: amount(minutes, "min", 0) },
    { label: "Distance", value: amount(km, "km", 1) },
    { label: "Energy", value: amount(kcal, "kcal", 0) },
  ])
}

function formatBytes(value: unknown): string {
  const bytes = numberValue(value)
  if (bytes === null || bytes < 0) return ""
  if (bytes < 1024) return `${healthvaultNumber(bytes, 0)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${healthvaultNumber(kb, 1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${healthvaultNumber(mb, 1)} MB`
  return `${healthvaultNumber(mb / 1024, 1)} GB`
}

function formatTimestamp(value: unknown): string {
  const ms = numberValue(value)
  if (ms === null || ms <= 0) return ""
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

function dataBlock(data: JsonRecord | null): HealthvaultStatsBlock | null {
  if (!data) return null
  const upload = record(data.lastUpload)
  return statsBlock("Data", [
    {
      label: "Last record day",
      value: healthvaultTextValue(data.lastRecordDay, 20),
    },
    {
      label: "Last upload",
      value: healthvaultTextValue(upload?.filename, 100),
    },
    {
      label: "Upload status",
      value: healthvaultTextValue(upload?.status, 40),
    },
    {
      label: "Inserted",
      value: healthvaultNumber(upload?.inserted, 0),
    },
    {
      label: "Finished",
      value: formatTimestamp(upload?.finishedAtMs),
    },
  ])
}

function buildContext(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const context = record(value)
  if (!context) return null
  const profile = record(context.profile)
  const nutrition = record(context.nutrition)
  const checklist = record(context.supplements)
  const training = record(context.training)
  const { taken, total } = checklistParts(checklist)
  const kcal = numberValue(record(nutrition?.totals)?.kcal)
  const summary = joinParts([
    tool,
    kcal !== null ? `${healthvaultNumber(kcal, 0)} kcal` : "",
    taken !== null && total !== null
      ? `${healthvaultNumber(taken, 0)}/${healthvaultNumber(total, 0)} supplements`
      : "",
  ])
  const today = healthvaultTextValue(context.today, 20)
  return content(
    "context",
    tool,
    today ? `Health snapshot · ${today}` : "Health snapshot",
    summary,
    [
      profile ? profileStatsBlock(profile, profile.age) : null,
      profile ? workScheduleBlocks(profile) : null,
      nutrition ? nutritionStatsBlock(nutrition) : null,
      nutrition ? remainingBlock(nutrition) : null,
      ...(nutrition ? mealBlocks(record(nutrition.meals)) : []),
      nutrition ? estimatedBlock(nutrition) : null,
      ...weightBlocks(record(context.weight)),
      supplementStatsBlock(checklist, record(context.nextSupplement)),
      supplementChecklistTable(checklist),
      ...(training
        ? [
            workoutStatsBlock(array(training.workouts) ?? []),
            workoutsTable(array(training.workouts) ?? []),
            statsBlock("Daily activity", [
              {
                label: "Steps / day",
                value: healthvaultNumber(record(training.steps)?.avgPerDay, 0),
              },
              {
                label: "Sleep / night",
                value: amount(record(training.sleep)?.avgPerNight, "h", 1),
              },
            ]),
          ]
        : []),
      dataBlock(record(context.data)),
    ].flat()
  )
}

function buildProfileGet(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const profile =
    record(result.profile) ??
    (result.timezone !== undefined || result.name !== undefined ? result : null)
  if (!profile) return null
  const age = first(result.age, profile.age)
  const suggested = record(result.suggestedTargets)
  const summary = joinParts([
    tool,
    healthvaultTextValue(profile.name, 60),
    healthvaultNumber(age, 0) ? `${healthvaultNumber(age, 0)} y` : "",
  ])
  return content("profile", tool, "Profile", summary, [
    profileStatsBlock(profile, age),
    ...workScheduleBlocks(profile),
    suggested ? statsBlock("Suggested targets", macroItems(suggested, null)) : null,
    ...profileNoteBlocks(profile),
  ])
}

function buildProfileResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const profile = record(result.profile) ?? result
  const summary = joinParts([
    tool,
    healthvaultTextValue(profile.name, 60) || "updated",
  ])
  return content("result", tool, "Profile updated", summary, [
    profileStatsBlock(profile, first(result.age, profile.age)),
    ...workScheduleBlocks(profile),
  ])
}

function buildNutritionDay(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const nutrition = record(value)
  if (!nutrition) return null
  const totals = record(nutrition.totals)
  const kcal = numberValue(totals?.kcal)
  const protein = numberValue(totals?.proteinG)
  const day = healthvaultTextValue(nutrition.day, 20)
  const summary = joinParts([
    tool,
    kcal !== null ? `${healthvaultNumber(kcal, 0)} kcal` : "",
    protein !== null ? `${healthvaultNumber(protein, 0)} g protein` : "",
  ])
  return content(
    "nutrition-day",
    tool,
    day ? `Nutrition · ${day}` : "Nutrition",
    summary,
    [
      nutritionStatsBlock(nutrition),
      remainingBlock(nutrition),
      ...mealBlocks(record(nutrition.meals)),
      estimatedBlock(nutrition),
    ]
  )
}

function buildNutritionSummary(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  const perDay = array(value) ?? array(result?.perDay)
  if (!perDay) return null
  const days =
    numberValue(result?.days) ?? perDay.length
  const kcals = perDay
    .map((entry) => numberValue(record(entry)?.kcal))
    .filter((entry): entry is number => entry !== null)
  const average =
    kcals.length > 0
      ? kcals.reduce((sum, entry) => sum + entry, 0) / kcals.length
      : null
  const summary = joinParts([
    tool,
    `${healthvaultNumber(days, 0)} ${plural(days, "day")}`,
    average !== null ? `${healthvaultNumber(average, 0)} kcal avg` : "",
  ])
  const rows = perDay.map((entry) => {
    const day = record(entry) ?? {}
    return [
      healthvaultTextValue(day.day, 20),
      healthvaultNumber(day.kcal, 0),
      healthvaultNumber(day.proteinG, 0),
      healthvaultNumber(day.carbsG, 0),
      healthvaultNumber(day.fatG, 0),
      healthvaultNumber(day.fibreG, 0),
      healthvaultNumber(day.sodiumMg, 0),
      healthvaultNumber(day.entries, 0),
      healthvaultNumber(day.targetKcal, 0),
    ]
  })
  return content("nutrition-summary", tool, "Nutrition summary", summary, [
    statsBlock("Summary", [
      { label: "Days", value: healthvaultNumber(days, 0) },
      { label: "Average", value: amount(average, "kcal", 0) },
      {
        label: "Target",
        value: amount(record(result?.targets)?.kcal, "kcal", 0),
      },
    ]),
    tableBlock(
      "Per day",
      [
        "Day",
        "kcal",
        "Protein",
        "Carbs",
        "Fat",
        "Fibre",
        "Sodium",
        "Entries",
        "Target",
      ],
      rows
    ),
  ])
}

function buildRecordTypes(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const types = array(value) ?? array(record(value)?.types)
  if (!types) return null
  const rows = types.map((entry) => {
    const type = record(entry) ?? {}
    return [
      typeLabel(type.typeIdentifier),
      healthvaultTextValue(type.unit, 30),
      healthvaultNumber(type.count, 0),
      healthvaultTextValue(type.firstDay, 20),
      healthvaultTextValue(type.lastDay, 20),
      healthvaultNumber(type.sum, 2),
      healthvaultNumber(type.avg, 2),
      healthvaultNumber(type.max, 2),
    ]
  })
  return content(
    "record-types",
    tool,
    "Record types",
    joinParts([tool, `${healthvaultNumber(types.length, 0)} types`]),
    [
      tableBlock(
        "Record types",
        ["Type", "Unit", "Count", "First", "Last", "Sum", "Avg", "Max"],
        rows
      ),
    ]
  )
}

function buildRecords(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const rows = array(result.rows)
  if (!rows) return null
  const type = typeLabel(result.type)
  const summary = joinParts([
    tool,
    type,
    `${healthvaultNumber(rows.length, 0)} ${plural(rows.length, "row")}`,
  ])
  const tableRows = rows.map((entry) => {
    const row = record(entry) ?? {}
    return [
      healthvaultTextValue(row.day, 20),
      healthvaultTextValue(row.startDate, 40),
      healthvaultTextValue(row.endDate, 40),
      healthvaultNumber(row.value, 2),
      healthvaultTextValue(row.unit, 30),
      healthvaultTextValue(row.sourceName, 80),
    ]
  })
  return content("records", tool, type ? `Recent ${type}` : "Recent records", summary, [
    statsBlock("Records", [
      { label: "Type", value: type },
      { label: "Rows", value: healthvaultNumber(rows.length, 0) },
    ]),
    tableBlock(
      "Recent records",
      ["Day", "Start", "End", "Value", "Unit", "Source"],
      tableRows
    ),
  ])
}

function buildUploads(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const uploads = array(value) ?? array(record(value)?.uploads)
  if (!uploads) return null
  const rows = uploads.map((entry) => {
    const upload = record(entry) ?? {}
    return [
      healthvaultTextValue(upload.filename, 120),
      formatBytes(upload.bytes),
      healthvaultTextValue(upload.status, 30),
      healthvaultNumber(upload.recordsInserted, 0),
      healthvaultNumber(upload.recordsDuplicates, 0),
      formatTimestamp(first(upload.finishedAtMs, upload.createdAtMs)),
    ]
  })
  const message = uploads
    .map((entry) => healthvaultTextValue(record(entry)?.message, 200))
    .filter(Boolean)
    .join(" ")
  return content(
    "uploads",
    tool,
    "Recent uploads",
    joinParts([
      tool,
      `${healthvaultNumber(uploads.length, 0)} ${plural(uploads.length, "upload")}`,
    ]),
    [
      tableBlock(
        "Uploads",
        ["File", "Size", "Status", "Inserted", "Duplicates", "Finished"],
        rows
      ),
      textBlock(message),
    ]
  )
}

function buildSupplements(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const checklist = record(result.checklist)
  const supplements = array(result.supplements)
  if (!checklist && !supplements) return null
  const { taken, total } = checklistParts(checklist)
  const summary =
    total !== null
      ? joinParts([
          tool,
          `${healthvaultNumber(taken ?? 0, 0)}/${healthvaultNumber(total, 0)} taken`,
        ])
      : joinParts([
          tool,
          supplements
            ? `${healthvaultNumber(supplements.length, 0)} supplements`
            : "",
        ])
  return content(
    "supplements",
    tool,
    total !== null ? `Supplements · ${healthvaultNumber(taken ?? 0, 0)}/${healthvaultNumber(total, 0)}` : "Supplements",
    summary,
    [
      supplementStatsBlock(checklist),
      supplementChecklistTable(checklist),
      checklist ? null : supplements ? supplementCatalogTable(supplements) : null,
    ]
  )
}

function buildSupplementHistory(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const days = array(value) ?? array(record(value)?.history)
  if (!days) return null
  return content(
    "supplement-history",
    tool,
    "Supplement history",
    joinParts([
      tool,
      `${healthvaultNumber(days.length, 0)} ${plural(days.length, "day")}`,
    ]),
    [supplementHistoryTable(days)]
  )
}

function buildWorkouts(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const workouts = array(value) ?? array(record(value)?.workouts)
  if (!workouts) return null
  let minutes = 0
  for (const entry of workouts) {
    minutes += numberValue(record(entry)?.minutes) ?? 0
  }
  return content(
    "workouts",
    tool,
    "Recent workouts",
    joinParts([
      tool,
      `${healthvaultNumber(workouts.length, 0)} ${plural(workouts.length, "workout")}`,
      minutes > 0 ? `${healthvaultNumber(minutes, 0)} min` : "",
    ]),
    [workoutStatsBlock(workouts), workoutsTable(workouts)]
  )
}

function buildMeasurements(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const points = array(value) ?? array(record(value)?.points)
  if (!points) return null
  const rows = points.map((entry) => {
    const point = record(entry) ?? {}
    return [
      healthvaultTextValue(point.day, 20),
      healthvaultNumber(point.value, 2),
      healthvaultTextValue(point.unit, 20),
      healthvaultTextValue(point.source, 40),
      healthvaultTextValue(point.note, 120),
    ]
  })
  const latest = points.length ? record(points[points.length - 1]) : null
  return content(
    "measurements",
    tool,
    "Measurements",
    joinParts([
      tool,
      `${healthvaultNumber(points.length, 0)} ${plural(points.length, "entry", "entries")}`,
      latest ? amount(latest.value, latest.unit, 2) : "",
    ]),
    [
      tableBlock(
        "Measurements",
        ["Day", "Value", "Unit", "Source", "Note"],
        rows
      ),
    ]
  )
}

function buildMeasurementResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const kind = humanize(healthvaultTextValue(result.kind, 40))
  const reading = amount(result.value, result.unit, 2)
  const readingLabel = [kind, reading].filter(Boolean).join(" ")
  return content(
    "result",
    tool,
    kind ? `${kind} measurement` : "Measurement",
    joinParts([tool, readingLabel || "saved"]),
    [
      statsBlock("Measurement", [
        { label: "Kind", value: kind },
        { label: "Value", value: reading },
        { label: "Day", value: healthvaultTextValue(result.day, 20) },
        { label: "Note", value: healthvaultTextValue(result.note, 160) },
      ]),
    ]
  )
}

function buildFoods(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const foods = array(value) ?? array(record(value)?.foods)
  if (!foods) return null
  const rows = foods.map((entry) => {
    const food = record(entry) ?? {}
    return [
      healthvaultTextValue(food.name, 120),
      healthvaultTextValue(food.brand, 80),
      amount(food.servingGrams, "g", 0),
      healthvaultNumber(food.kcalPer100g, 0),
      healthvaultNumber(food.proteinPer100g, 1),
      healthvaultNumber(food.carbsPer100g, 1),
      healthvaultNumber(food.fatPer100g, 1),
      healthvaultTextValue(food.source, 60),
    ]
  })
  return content(
    "foods",
    tool,
    "Foods",
    joinParts([
      tool,
      `${healthvaultNumber(foods.length, 0)} ${plural(foods.length, "food")}`,
    ]),
    [
      tableBlock(
        "Foods",
        ["Food", "Brand", "Serving", "kcal /100 g", "Protein", "Carbs", "Fat", "Source"],
        rows
      ),
    ]
  )
}

function buildFoodResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const food = record(value)
  if (!food) return null
  return content(
    "result",
    tool,
    "Food",
    joinParts([
      tool,
      healthvaultTextValue(food.name, 80) || "saved",
    ]),
    [
      statsBlock("Food", [
        { label: "Name", value: healthvaultTextValue(food.name, 120) },
        { label: "Brand", value: healthvaultTextValue(food.brand, 80) },
        { label: "Serving", value: amount(food.servingGrams, "g", 0) },
        { label: "kcal /100 g", value: healthvaultNumber(food.kcalPer100g, 0) },
        {
          label: "Protein /100 g",
          value: amount(food.proteinPer100g, "g", 1),
        },
        { label: "Carbs /100 g", value: amount(food.carbsPer100g, "g", 1) },
        { label: "Fat /100 g", value: amount(food.fatPer100g, "g", 1) },
      ]),
    ]
  )
}

function buildMealLog(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const entries = array(result.entries)
  if (!entries) return null
  const meal = humanize(healthvaultTextValue(result.meal, 20))
  return content(
    "result",
    tool,
    meal ? `Logged ${meal.toLowerCase()}` : "Logged meal",
    joinParts([
      tool,
      `${healthvaultNumber(entries.length, 0)} ${plural(entries.length, "entry", "entries")}`,
    ]),
    [
      statsBlock("Meal", [
        { label: "Meal", value: meal },
        { label: "Day", value: healthvaultTextValue(result.day, 20) },
        { label: "Entries", value: healthvaultNumber(entries.length, 0) },
      ]),
      tableBlock(
        "Logged entries",
        ["Food", "Amount", "kcal", "Protein", "Carbs", "Fat"],
        entries.map((entry) => mealRow(record(entry) ?? {}))
      ),
    ]
  )
}

function buildMealEntry(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const entry = record(value)
  if (!entry) return null
  const name = healthvaultTextValue(entry.name, 100)
  return content(
    "result",
    tool,
    "Meal entry",
    joinParts([tool, name || "updated"]),
    [
      statsBlock("Entry", [
        { label: "Food", value: name },
        { label: "Meal", value: healthvaultTextValue(entry.meal, 20) },
        { label: "Amount", value: amount(entry.grams, "g", 0) },
        { label: "Calories", value: amount(entry.kcal, "kcal", 0) },
        { label: "Protein", value: amount(entry.proteinG, "g", 0) },
        { label: "Carbs", value: amount(entry.carbsG, "g", 0) },
        { label: "Fat", value: amount(entry.fatG, "g", 0) },
      ]),
    ]
  )
}

function buildSupplementResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const supplement = record(value)
  if (!supplement) return null
  return content(
    "result",
    tool,
    "Supplement",
    joinParts([
      tool,
      healthvaultTextValue(supplement.name, 80) || "saved",
    ]),
    [
      statsBlock("Supplement", [
        { label: "Name", value: healthvaultTextValue(supplement.name, 120) },
        { label: "Dose", value: doseLabel(supplement) },
        {
          label: "Schedule",
          value: scheduleLabel(parseJsonRecord(supplement.scheduleJson)),
        },
        { label: "Notes", value: healthvaultTextValue(supplement.notes, 160) },
        {
          label: "Status",
          value:
            supplement.active === 0 || supplement.active === false
              ? "Inactive"
              : "Active",
        },
      ]),
    ]
  )
}

function buildSupplementLogResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const supplement = record(result.supplement)
  const log = record(result.log)
  const logged = result.logged === true
  return content(
    "result",
    tool,
    "Supplement intake",
    joinParts([tool, logged ? "logged" : "not logged"]),
    [
      statsBlock("Intake", [
        { label: "Status", value: logged ? "Logged" : "Not logged" },
        { label: "Supplement", value: healthvaultTextValue(supplement?.name, 120) },
        { label: "Day", value: healthvaultTextValue(log?.day, 20) },
        { label: "Dose", value: doseLabel(log) },
      ]),
    ]
  )
}

function buildTargetsResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const targets = record(result.targets) ?? result
  return content(
    "nutrition-targets",
    tool,
    "Nutrition targets",
    joinParts([
      tool,
      amount(targets.kcal, "kcal", 0) ? `${amount(targets.kcal, "kcal", 0)} target` : "saved",
    ]),
    [statsBlock("Targets", macroItems(targets, null))]
  )
}

function buildMetrics(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const points = array(result.points)
  if (!points) return null
  const metric = humanize(healthvaultTextValue(result.metric, 40))
  const unit = healthvaultTextValue(result.unit, 20)
  const values = points
    .map((entry) => numberValue(record(entry)?.value))
    .filter((entry): entry is number => entry !== null)
  const latest = points.length ? record(points[points.length - 1]) : null
  const average =
    values.length > 0
      ? values.reduce((sum, entry) => sum + entry, 0) / values.length
      : null
  const minimum = values.length > 0 ? Math.min(...values) : null
  const maximum = values.length > 0 ? Math.max(...values) : null
  const rows = points.map((entry) => {
    const point = record(entry) ?? {}
    return [
      healthvaultTextValue(point.day, 20),
      healthvaultNumber(point.value, 2),
      healthvaultTextValue(point.source, 80),
    ]
  })
  return content(
    "metrics",
    tool,
    metric || "Metric series",
    joinParts([
      tool,
      metric,
      `${healthvaultNumber(points.length, 0)} ${plural(points.length, "point")}`,
    ]),
    [
      statsBlock("Series", [
        { label: "Metric", value: metric },
        { label: "Unit", value: unit },
        { label: "Points", value: healthvaultNumber(points.length, 0) },
        { label: "Latest", value: amount(latest?.value, unit, 2) },
        { label: "Average", value: amount(average, unit, 2) },
        { label: "Minimum", value: amount(minimum, unit, 2) },
        { label: "Maximum", value: amount(maximum, unit, 2) },
      ]),
      tableBlock("Values", ["Day", "Value", "Source"], rows),
    ]
  )
}

function buildGenericResult(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  const result = record(value)
  if (!result) return null
  const items: HealthvaultStatItem[] = []
  const add = (label: string, value: string) => {
    if (value) items.push({ label, value })
  }
  if (typeof result.deleted === "boolean") {
    add("Deleted", result.deleted ? "yes" : "no")
  }
  if (typeof result.archived === "boolean") {
    add("Archived", result.archived ? "yes" : "no")
  }
  add("Copied", healthvaultNumber(result.copied, 0))
  add("Copied to", healthvaultTextValue(result.toDay, 20))
  if (typeof result.logged === "boolean") {
    add("Logged", result.logged ? "yes" : "no")
  }
  add("Day", healthvaultTextValue(result.day, 20))
  add("Count", healthvaultNumber(result.count, 0))
  if (Array.isArray(result.entries)) {
    add("Entries", healthvaultNumber(result.entries.length, 0))
  } else {
    add("Entries", healthvaultNumber(result.entries, 0))
  }
  add("Name", healthvaultTextValue(result.name, 120))
  add("File", healthvaultTextValue(result.filename, 120))
  add("Status", healthvaultTextValue(result.status, 40))

  let summary: string
  if (result.archived === true) {
    summary = joinParts([tool, "archived"])
  } else if (typeof result.deleted === "boolean") {
    summary = joinParts([tool, result.deleted ? "deleted" : "not deleted"])
  } else {
    const copied = numberValue(result.copied)
    if (copied !== null) {
      summary = joinParts([tool, `${healthvaultNumber(copied, 0)} copied`])
    } else if (typeof result.logged === "boolean") {
      summary = joinParts([tool, result.logged ? "logged" : "not logged"])
    } else {
      const name = healthvaultTextValue(first(result.name, result.filename), 80)
      summary = joinParts([tool, name || "done"])
    }
  }
  return content("result", tool, humanize(tool), summary, [
    statsBlock("Result", items),
  ])
}

function buildView(
  tool: string,
  value: unknown
): HealthvaultContentView | null {
  switch (tool) {
    case "context":
      return buildContext(tool, value)
    case "profile_get":
      return buildProfileGet(tool, value)
    case "profile_update":
      return buildProfileResult(tool, value)
    case "measurement_add":
      return buildMeasurementResult(tool, value)
    case "measurement_history":
      return buildMeasurements(tool, value)
    case "measurement_delete":
      return buildGenericResult(tool, value)
    case "food_search":
      return buildFoods(tool, value)
    case "food_add":
      return buildFoodResult(tool, value)
    case "food_delete":
      return buildGenericResult(tool, value)
    case "meal_log":
      return buildMealLog(tool, value)
    case "meal_update":
      return buildMealEntry(tool, value)
    case "meal_delete":
      return buildGenericResult(tool, value)
    case "nutrition_day":
      return buildNutritionDay(tool, value)
    case "nutrition_summary":
      return buildNutritionSummary(tool, value)
    case "nutrition_target_set":
      return buildTargetsResult(tool, value)
    case "supplement_list":
      return buildSupplements(tool, value)
    case "supplement_create":
    case "supplement_update":
      return buildSupplementResult(tool, value)
    case "supplement_log":
      return buildSupplementLogResult(tool, value)
    case "supplement_delete":
      return buildGenericResult(tool, value)
    case "supplement_history":
      return buildSupplementHistory(tool, value)
    case "metrics_series":
      return buildMetrics(tool, value)
    case "workouts_recent":
      return buildWorkouts(tool, value)
    case "copy_day":
      return buildGenericResult(tool, value)
    case "record_types":
      return buildRecordTypes(tool, value)
    case "records_recent":
      return buildRecords(tool, value)
    case "uploads_recent":
      return buildUploads(tool, value)
    default:
      return null
  }
}

export function healthvaultToolView(
  name: string | null | undefined,
  output: string | null | undefined,
  status?: "running" | "completed" | "error"
): HealthvaultToolView {
  const tool = healthvaultToolName(name)
  if (!tool) {
    return fallbackView(
      typeof name === "string" && name.trim() ? name.trim() : "tool",
      "unsupported-tool",
      "This is not a HealthVault tool.",
      "tool · result"
    )
  }
  if (status === "error") {
    return fallbackView(
      tool,
      "error-status",
      output || "The tool reported an error.",
      `${tool} · error`
    )
  }
  const parsed = parseHealthvaultOutput(output)
  if (parsed.ok === false) {
    return fallbackView(tool, parsed.reason, parsed.message, `${tool} · result`)
  }
  try {
    const view = buildView(tool, parsed.value)
    if (!view) {
      return fallbackView(
        tool,
        "unknown-shape",
        "The tool result shape is not recognized.",
        `${tool} · result`
      )
    }
    if (view.blocks.length === 0) {
      return fallbackView(
        tool,
        "unknown-shape",
        "The tool result did not contain displayable details.",
        `${tool} · result`
      )
    }
    return view
  } catch {
    return fallbackView(
      tool,
      "unknown-shape",
      "The tool result could not be read.",
      `${tool} · result`
    )
  }
}

export function healthvaultToolSummary(
  name: string | null | undefined,
  output: string | null | undefined,
  status?: "running" | "completed" | "error"
): string | undefined {
  const tool = healthvaultToolName(name)
  if (!tool) return undefined
  if (status === "running" && (output === undefined || output === "")) {
    return tool
  }
  return healthvaultToolView(name, output, status).summary
}
