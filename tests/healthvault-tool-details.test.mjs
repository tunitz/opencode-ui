import { expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

import { HealthvaultToolDetails } from "../src/components/healthvault-tool-details"

const macros = {
  kcal: 1842,
  proteinG: 120,
  carbsG: 190,
  fatG: 58,
  fibreG: 31,
  sodiumMg: 2100,
}

const food = (name) => ({
  id: 1,
  name,
  brand: "Example",
  servingGrams: 40,
  kcalPer100g: 375,
  proteinPer100g: 13,
  carbsPer100g: 60,
  fatPer100g: 7,
  source: "javascript:alert(1)",
})

async function render(element) {
  let root
  await act(async () => {
    root = create(element)
  })
  return root
}

test("renders a HealthVault card with an accessible table", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const output = JSON.stringify([food("Oats")])
  const root = await render(
    React.createElement(HealthvaultToolDetails, {
      name: "healthvault_food_search",
      output,
      status: "completed",
    })
  )
  try {
    const trees = root.root.findAllByType("table")
    expect(trees).toHaveLength(1)
    expect(trees[0].props["aria-label"]).toBe("Foods")
    const headers = root.root.findAllByType("th")
    expect(
      headers
        .map((header) => header.findAllByType("div").at(-1)?.children.join("") ?? "")
        .join(" ")
    ).toContain("Food")
    const rendered = JSON.stringify(root.toJSON())
    expect(rendered).toContain("food_search · 1 food")
    expect(rendered).toContain("Oats")
  } finally {
    await act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test("escapes dangerous cell text and never creates elements from it", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const dangerous = '<img src=x onerror="alert(1)">'
  const root = await render(
    React.createElement(HealthvaultToolDetails, {
      name: "healthvault_food_search",
      output: JSON.stringify([food(dangerous)]),
      status: "completed",
    })
  )
  try {
    expect(root.root.findAllByType("img")).toHaveLength(0)
    const rendered = JSON.stringify(root.toJSON())
    expect(rendered).toContain("onerror")
    expect(rendered).toContain("javascript:alert(1)")
  } finally {
    await act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test("renders macro cards and meal tables for a nutrition day", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const nutrition = {
    day: "2026-11-10",
    targets: { ...macros, kcal: 2200, proteinG: 140 },
    totals: macros,
    remaining: { kcal: 358, proteinG: 20, carbsG: 40, fatG: 12 },
    meals: {
      breakfast: [
        {
          name: "Oats",
          grams: 80,
          kcal: 300,
          proteinG: 10,
          carbsG: 50,
          fatG: 6,
        },
      ],
      lunch: [],
      dinner: [],
      snack: [],
    },
    entries: [],
    estimatedEntries: 0,
  }
  const root = await render(
    React.createElement(HealthvaultToolDetails, {
      name: "healthvault_nutrition_day",
      output: JSON.stringify(nutrition),
      status: "completed",
    })
  )
  try {
    expect(root.root.findAllByType("table")).toHaveLength(1)
    expect(JSON.stringify(root.toJSON())).toContain("1,842 / 2,200 kcal")
  } finally {
    await act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test("shows the row remainder and falls back to the supplied raw detail", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const types = Array.from({ length: 30 }, (_, index) => ({
    typeIdentifier: `HKQuantityTypeIdentifierType${index}`,
    unit: "count",
    count: index,
  }))
  const root = await render(
    React.createElement(HealthvaultToolDetails, {
      name: "healthvault_record_types",
      output: JSON.stringify(types),
      status: "completed",
    })
  )
  try {
    const remainder = root.root
      .findAllByType("p")
      .some((paragraph) => paragraph.children.join("") === "5 more rows")
    expect(remainder).toBe(true)
  } finally {
    await act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fallbackRoot = await render(
    React.createElement(HealthvaultToolDetails, {
      name: "healthvault_context",
      output: "{not json",
      status: "completed",
      fallback: React.createElement("pre", { id: "raw-output" }, "{not json"),
    })
  )
  try {
    expect(fallbackRoot.root.findByProps({ id: "raw-output" })).toBeTruthy()
    expect(fallbackRoot.root.findAllByType("table")).toHaveLength(0)
  } finally {
    await act(async () => fallbackRoot.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
