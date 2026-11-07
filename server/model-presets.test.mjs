import { expect, test } from "bun:test"
import { readModelPresets, writeModelPresets } from "../src/lib/model-presets"

test("presets persist locally, preserve variant, and reject malformed stored entries", () => {
  let value = null
  globalThis.localStorage = { getItem: () => value, setItem: (_, next) => { value = next } }
  const preset = { name: "Review", agent: "review", model: { providerID: "p", id: "m", variant: "high" } }
  expect(writeModelPresets([preset])).toBe(true)
  expect(readModelPresets()).toEqual([preset])
  value = JSON.stringify([preset, { name: "broken", model: {} }, null])
  expect(readModelPresets()).toEqual([preset])
  value = "{bad"
  expect(readModelPresets()).toEqual([])
  globalThis.localStorage = { getItem: () => { throw Error() }, setItem: () => { throw Error() } }
  expect(readModelPresets()).toEqual([])
  expect(writeModelPresets([preset])).toBe(false)
  delete globalThis.localStorage
})
