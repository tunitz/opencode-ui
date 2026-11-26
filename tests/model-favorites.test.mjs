import { expect, test } from "bun:test"
import {
  modelFavoritesKey,
  parseModelFavorites,
  readModelFavorites,
  writeModelFavorites,
} from "../src/lib/model-favorites"

const storage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test("favorites are scoped per browser origin", () => {
  expect(modelFavoritesKey("http://a.test:5174")).not.toBe(
    modelFavoritesKey("http://b.test:5174")
  )
  const store = storage()
  writeModelFavorites(store, "http://a.test:5174", ["a/model"])
  expect(readModelFavorites(store, "http://a.test:5174")).toEqual(["a/model"])
  expect(readModelFavorites(store, "http://b.test:5174")).toEqual([])
})

test("favorite parsing is defensive and de-duplicates", () => {
  expect(parseModelFavorites(null)).toEqual([])
  expect(parseModelFavorites("not json")).toEqual([])
  expect(parseModelFavorites('{"a":1}')).toEqual([])
  expect(parseModelFavorites('["a/model",5,"a/model","b/model"]')).toEqual([
    "a/model",
    "b/model",
  ])
})

test("writes honor a failed storage backend", () => {
  expect(
    writeModelFavorites(
      { setItem: () => { throw new Error("quota") } },
      "http://a.test",
      ["a/model"]
    )
  ).toBe(false)
})
