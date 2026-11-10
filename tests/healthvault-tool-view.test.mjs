import { expect, test } from "bun:test"

import {
  healthvaultNumber,
  healthvaultTextValue,
  healthvaultToolName,
  healthvaultToolSummary,
  healthvaultToolView,
  isHealthvaultTool,
  parseHealthvaultOutput,
} from "../src/lib/healthvault-tool-view"
import { toolCallSummary } from "../src/lib/tool-details"

const macros = {
  kcal: 1842,
  proteinG: 120,
  carbsG: 190,
  fatG: 58,
  fibreG: 31,
  sodiumMg: 2100,
}

const targets = {
  ...macros,
  kcal: 2200,
  proteinG: 140,
  effectiveFrom: "2026-11-01",
  source: "manual",
}

const breakfast = [
  {
    name: "Oats",
    grams: 80,
    kcal: 300,
    proteinG: 10,
    carbsG: 50,
    fatG: 6,
    estimated: 0,
  },
]

const nutritionDay = {
  day: "2026-11-10",
  timezone: "Europe/Berlin",
  targets,
  totals: macros,
  remaining: {
    kcal: 358,
    proteinG: 20,
    carbsG: 40,
    fatG: 12,
    fibreG: 4,
    sodiumMg: 300,
  },
  progress: { kcal: 84, proteinG: 86, carbsG: 83, fatG: 83 },
  entries: breakfast,
  meals: {
    breakfast,
    lunch: [],
    dinner: [],
    snack: [],
  },
  estimatedEntries: 0,
}

const context = {
  generatedAt: "2026-11-10T08:00:00.000Z",
  today: "2026-11-10",
  timezone: "Europe/Berlin",
  profile: {
    name: "Sam",
    age: 34,
    timezone: "Europe/Berlin",
    units: "metric",
    heightCm: 178,
    goalWeightKg: 75,
    birthDate: "1992-02-02",
    workSchedule: {
      days: [{ weekday: 1, start: "09:00", end: "17:00" }],
      note: "Office day",
    },
  },
  nutrition: {
    ...nutritionDay,
    totals: { ...macros, kcal: 1699 },
  },
  weight: {
    latest: { day: "2026-11-10", value: 82.4, unit: "kg", source: "manual" },
    goalKg: 75,
    change7dKg: -0.4,
    points: [
      { day: "2026-11-09", value: 82.8, unit: "kg", source: "manual" },
      { day: "2026-11-10", value: 82.4, unit: "kg", source: "manual" },
    ],
  },
  supplements: {
    day: "2026-11-10",
    items: [
      {
        supplement: { name: "Vitamin D", dose: 1, unit: "capsule" },
        schedule: { time: "08:00", days: null },
        logged: true,
      },
    ],
    taken: 5,
    total: 5,
  },
  nextSupplement: {
    supplement: { name: "Magnesium", dose: 1, unit: "tablet" },
    schedule: { time: "20:00", days: [1, 2, 3, 4, 5] },
  },
  training: {
    workouts: [
      {
        day: "2026-11-09",
        type: "Running",
        minutes: 45,
        km: 8,
        kcal: 420,
        paceMinPerKm: 5.625,
        speedKmh: 10.7,
        avgHr: 148,
        minHr: 120,
        maxHr: 170,
        sourceName: "Watch",
      },
    ],
    steps: { avgPerDay: 8200 },
    sleep: { avgPerNight: 7.2 },
  },
  data: {
    lastUpload: {
      filename: "export.zip",
      status: "complete",
      finishedAtMs: 1760000000000,
      inserted: 1000,
    },
    lastRecordDay: "2026-11-10",
  },
}

const profileGet = {
  profile: {
    name: "Sam",
    sex: "other",
    heightCm: 178,
    timezone: "Europe/Berlin",
    units: "metric",
    goalWeightKg: 75,
    workScheduleJson: JSON.stringify({
      days: [{ weekday: 2, start: "10:00", end: "18:00" }],
    }),
  },
  age: 34,
  suggestedTargets: { ...macros, kcal: 2200, proteinG: 140 },
}

const nutritionSummary = {
  days: 2,
  targets,
  perDay: [
    { ...macros, day: "2026-11-09", entries: 3, targetKcal: 2200 },
    { ...macros, day: "2026-11-10", entries: 2, targetKcal: 2200 },
  ],
}

const recordTypes = [
  {
    typeIdentifier: "HKQuantityTypeIdentifierStepCount",
    unit: "count",
    count: 456,
    firstDay: "2026-01-01",
    lastDay: "2026-11-10",
    sum: 12345,
    avg: 27,
    max: 900,
  },
  {
    typeIdentifier: "HKQuantityTypeIdentifierBodyMass",
    unit: "kg",
    count: 40,
    firstDay: "2026-02-01",
    lastDay: "2026-11-10",
    sum: 3296,
    avg: 82.4,
    max: 84.1,
  },
]

const records = {
  type: "HKQuantityTypeIdentifierStepCount",
  rows: [
    {
      day: "2026-11-10",
      startDate: "2026-11-10 08:00:00 +0100",
      endDate: "2026-11-10 18:00:00 +0100",
      value: 8123,
      unit: "count",
      sourceName: "Watch",
    },
  ],
}

const uploads = [
  {
    filename: "export.zip",
    bytes: 410000000,
    status: "complete",
    recordsInserted: 1000,
    recordsDuplicates: 25,
    message: null,
    createdAtMs: 1760000000000,
    finishedAtMs: 1760000100000,
  },
]

const supplementList = {
  supplements: [
    {
      id: 1,
      name: "Vitamin D",
      dose: 1,
      unit: "capsule",
      scheduleJson: JSON.stringify({ time: "08:00", days: null }),
      active: 1,
    },
  ],
  checklist: {
    day: "2026-11-10",
    items: [
      {
        supplement: { name: "Vitamin D", dose: 1, unit: "capsule" },
        schedule: { time: "08:00", days: null },
        logged: true,
      },
    ],
    taken: 5,
    total: 5,
  },
}

const supplementHistory = [
  {
    day: "2026-11-10",
    taken: 2,
    items: [
      { name: "Vitamin D", dose: 1, unit: "capsule", takenAtMs: 1760000000000 },
      { name: "Magnesium", dose: 1, unit: "tablet", takenAtMs: 1760003600000 },
    ],
  },
]

const workouts = [
  {
    day: "2026-11-09",
    startDate: "2026-11-09T07:00:00Z",
    type: "HKWorkoutActivityTypeTraditionalStrengthTraining",
    minutes: 45,
    km: 8,
    kcal: 420,
    paceMinPerKm: 5.625,
    speedKmh: 10.7,
    avgHr: 148,
    minHr: 120,
    maxHr: 170,
    sourceName: "Watch",
  },
]

const measurements = [
  {
    id: 1,
    day: "2026-11-09",
    takenAtMs: 1760000000000,
    value: 82.8,
    unit: "kg",
    source: "manual",
    note: null,
  },
  {
    id: 2,
    day: "2026-11-10",
    takenAtMs: 1760086400000,
    value: 82.4,
    unit: "kg",
    source: "apple",
    note: "Morning",
  },
]

const foods = [
  {
    id: 1,
    name: "Oats",
    brand: "Example",
    servingGrams: 40,
    kcalPer100g: 375,
    proteinPer100g: 13,
    carbsPer100g: 60,
    fatPer100g: 7,
    fibrePer100g: 10,
    sodiumPer100g: 5,
    source: "manual",
  },
]

const metrics = {
  metric: "steps",
  unit: "count",
  points: [
    { day: "2026-11-09", value: 7000, source: "Watch" },
    { day: "2026-11-10", value: 8123, source: "Watch" },
  ],
}

function view(name, value, status) {
  const output = typeof value === "string" ? value : JSON.stringify(value)
  return healthvaultToolView(`healthvault_${name}`, output, status)
}

function table(viewValue, caption) {
  return viewValue.blocks.find(
    (block) => block.kind === "table" && (!caption || block.caption.includes(caption))
  )
}

test("recognizes only the healthvault tool namespace", () => {
  expect(healthvaultToolName("healthvault_nutrition_day")).toBe("nutrition_day")
  expect(healthvaultToolName("healthvault_context")).toBe("context")
  expect(healthvaultToolName("shell")).toBeNull()
  expect(healthvaultToolName("healthvault_")).toBeNull()
  expect(isHealthvaultTool("healthvault_food_search")).toBe(true)
  expect(isHealthvaultTool("healthvaultish")).toBe(false)
})

test("formats primitives and drops non-finite numbers", () => {
  expect(healthvaultNumber(1699, 0)).toBe("1,699")
  expect(healthvaultNumber(Number.POSITIVE_INFINITY, 0)).toBe("")
  expect(healthvaultNumber("not a number", 0)).toBe("")
  expect(healthvaultTextValue("<b>x</b>")).toBe("<b>x</b>")
})

test("parses raw JSON and unwraps ok/result wrappers without evaluating", () => {
  expect(parseHealthvaultOutput(JSON.stringify({ deleted: true }))).toEqual({
    ok: true,
    value: { deleted: true },
  })
  expect(
    parseHealthvaultOutput(
      JSON.stringify({ ok: true, tool: "meal_delete", result: { deleted: true } })
    )
  ).toEqual({ ok: true, value: { deleted: true } })
  expect(
    parseHealthvaultOutput(
      JSON.stringify({ ok: false, error: "not found" })
    )
  ).toEqual({ ok: false, reason: "tool-error", message: "not found" })
  expect(parseHealthvaultOutput("")).toMatchObject({
    ok: false,
    reason: "empty-output",
  })
  expect(parseHealthvaultOutput("{nope")).toMatchObject({
    ok: false,
    reason: "invalid-json",
  })
})

test("builds the context summary from output rather than JSON", () => {
  const value = view("context", context)
  expect(value.kind).toBe("context")
  expect(value.summary).toBe("context · 1,699 kcal · 5/5 supplements")
  expect(table(value, "Weight trend")).toBeTruthy()
  expect(table(value, "Workouts")).toBeTruthy()
  expect(table(value, "Breakfast")?.rows[0][0]).toBe("Oats")
})

test("builds nutrition day macro cards and meal tables", () => {
  const value = view("nutrition_day", nutritionDay)
  expect(value.kind).toBe("nutrition-day")
  expect(value.summary).toBe("nutrition_day · 1,842 kcal · 120 g protein")
  const macrosBlock = value.blocks.find((block) => block.kind === "stats")
  expect(macrosBlock.items).toContainEqual({
    label: "Calories",
    value: "1,842 / 2,200 kcal",
  })
  expect(table(value, "Breakfast")?.rows).toHaveLength(1)
  const leftover = nutritionDay.remaining
  expect(leftover.kcal).toBe(358)
})

test("builds profile, nutrition summary, records, uploads, supplements, workouts, measurements, foods and metrics", () => {
  const families = [
    ["profile_get", profileGet, "profile"],
    ["nutrition_summary", nutritionSummary, "nutrition-summary"],
    ["record_types", recordTypes, "record-types"],
    ["records_recent", records, "records"],
    ["uploads_recent", uploads, "uploads"],
    ["supplement_list", supplementList, "supplements"],
    ["supplement_history", supplementHistory, "supplement-history"],
    ["workouts_recent", workouts, "workouts"],
    ["measurement_history", measurements, "measurements"],
    ["food_search", foods, "foods"],
    ["metrics_series", metrics, "metrics"],
  ]
  for (const [name, value, kind] of families) {
    const parsed = view(name, value)
    expect(parsed.kind).toBe(kind)
    expect(parsed.blocks.length).toBeGreaterThan(0)
  }

  expect(view("nutrition_summary", nutritionSummary).summary).toContain("2 days")
  expect(table(view("record_types", recordTypes), "Record types")?.rows[0][0]).toBe(
    "Step Count"
  )
  expect(table(view("supplement_list", supplementList), "Checklist")).toBeTruthy()
  expect(table(view("metrics_series", metrics), "Values")?.rows[1][1]).toBe("8,123")
  expect(table(view("workouts_recent", workouts), "Workouts")?.rows[0][1]).toBe(
    "Traditional Strength Training"
  )
})

test("builds compact result cards for writes and deletes", () => {
  expect(view("measurement_delete", { deleted: true }).summary).toBe(
    "measurement_delete · deleted"
  )
  expect(view("copy_day", { copied: 2, toDay: "2026-11-11" }).summary).toBe(
    "copy_day · 2 copied"
  )
  expect(
    view("supplement_delete", { deleted: false, archived: true }).summary
  ).toBe("supplement_delete · archived")
  expect(
    view("supplement_log", {
      logged: true,
      log: { day: "2026-11-10", dose: 1, unit: "capsule" },
      supplement: { name: "Vitamin D" },
    }).summary
  ).toBe("supplement_log · logged")
  expect(
    view("measurement_add", {
      kind: "weight",
      value: 82.4,
      unit: "kg",
      day: "2026-11-10",
    }).summary
  ).toBe("measurement_add · Weight 82.4 kg")
  expect(
    view("nutrition_target_set", targets).summary
  ).toBe("nutrition_target_set · 2,200 kcal target")
  expect(
    view("meal_log", { day: "2026-11-10", meal: "lunch", entries: breakfast })
      .summary
  ).toBe("meal_log · 1 entry")
  const mealLog = view("meal_log", {
    day: "2026-11-10",
    meal: "lunch",
    entries: [...breakfast, ...breakfast, ...breakfast],
  })
  expect(mealLog.summary).toBe("meal_log · 3 entries")
})

test("caps table rows and reports the remainder", () => {
  const types = Array.from({ length: 30 }, (_, index) => ({
    typeIdentifier: `HKQuantityTypeIdentifierType${index}`,
    unit: "count",
    count: index,
  }))
  const value = view("record_types", types)
  const recordTable = table(value, "Record types")
  expect(recordTable.rows).toHaveLength(25)
  expect(recordTable.moreRows).toBe(5)
  expect(value.summary).toBe("record_types · 30 types")
})

test("falls back for malformed JSON, unknown shapes and error status", () => {
  expect(view("context", "{not json")).toMatchObject({
    kind: "fallback",
    reason: "invalid-json",
  })
  expect(view("context", "")).toMatchObject({
    kind: "fallback",
    reason: "empty-output",
  })
  expect(view("context", { ok: false, error: "service down" })).toMatchObject({
    kind: "fallback",
    reason: "tool-error",
    message: "service down",
  })
  expect(view("context", context, "error")).toMatchObject({
    kind: "fallback",
    reason: "error-status",
  })
  expect(view("context", 42)).toMatchObject({
    kind: "fallback",
    reason: "unknown-shape",
  })
  expect(view("nutrition_day", { totals: {} })).toMatchObject({
    kind: "fallback",
    reason: "unknown-shape",
  })
})

test("keeps dangerous strings as plain text and never interprets URLs", () => {
  const dangerous = '<img src=x onerror="alert(1)">'
  const food = {
    id: 1,
    name: dangerous,
    source: "javascript:alert(1)",
    servingGrams: 100,
    kcalPer100g: 100,
  }
  const value = view("food_search", [food])
  const rows = table(value, "Foods").rows
  expect(rows[0][0]).toBe(dangerous)
  expect(rows[0][7]).toBe("javascript:alert(1)")
  expect(value.summary).not.toContain("<")
  expect(healthvaultTextValue(dangerous)).toBe(dangerous)
})

test("drops Infinity parsed from JSON", () => {
  const output = '{"metric":"steps","unit":"count","points":[{"day":"2026-11-10","value":1e999}]}'
  const value = healthvaultToolView("healthvault_metrics_series", output, "completed")
  expect(value.kind).toBe("metrics")
  const values = table(value, "Values").rows[0]
  expect(values[1]).toBe("")
  expect(JSON.stringify(value)).not.toContain("Infinity")
})

test("summary helper and toolCallSummary use the parsed output", () => {
  const output = JSON.stringify(context)
  expect(healthvaultToolSummary("healthvault_context", output)).toBe(
    "context · 1,699 kcal · 5/5 supplements"
  )
  expect(
    toolCallSummary("healthvault_context", undefined, output, "completed")
  ).toBe("context · 1,699 kcal · 5/5 supplements")
  expect(toolCallSummary("shell", { command: "echo hi" })).toBe("echo hi")
  expect(
    healthvaultToolSummary("healthvault_context", undefined, "running")
  ).toBe("context")
})
