import { expect, test } from "bun:test"

import {
  matchesPickerOption,
  matchesPickerSearchKey,
  pickerOptionSearchKey,
} from "../src/components/ui/picker-select"

const option = {
  label: "GPT-5 Codex",
  detail: "openai/gpt-5-codex",
  value: "openai/gpt-5-codex",
}

test("pickerOptionSearchKey lowercases and joins all searchable fields once", () => {
  expect(pickerOptionSearchKey(option)).toBe(
    "gpt-5 codex openai/gpt-5-codex openai/gpt-5-codex"
  )
  expect(
    pickerOptionSearchKey({ label: "Solo", detail: undefined, value: "solo" })
  ).toBe("solo solo")
})

test("precomputed key matches are case-insensitive and AND across words", () => {
  const key = pickerOptionSearchKey(option)
  expect(matchesPickerSearchKey(key, "")).toBe(true)
  expect(matchesPickerSearchKey(key, "   ")).toBe(true)
  expect(matchesPickerSearchKey(key, "CODEX")).toBe(true)
  expect(matchesPickerSearchKey(key, "openai codex")).toBe(true)
  expect(matchesPickerSearchKey(key, "codex claude")).toBe(false)
  expect(matchesPickerSearchKey(key, "missing")).toBe(false)
})

test("matchesPickerOption keeps its original semantics via the precomputed key", () => {
  const key = pickerOptionSearchKey(option)
  for (const query of [
    "",
    "gpt",
    "GPT-5",
    "openai codex",
    "codex openai",
    "anthropic",
    "gpt claude",
  ]) {
    expect(matchesPickerOption(option, query)).toBe(
      matchesPickerSearchKey(key, query)
    )
  }
})
