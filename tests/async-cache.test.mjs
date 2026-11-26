import { expect, test } from "bun:test"
import { createAsyncCache } from "../src/lib/async-cache.ts"

test("deduplicates concurrent reads for the same key", async () => {
  const cache = createAsyncCache(1000)
  let calls = 0
  const load = async () => {
    calls += 1
    await Bun.sleep(5)
    return ["model"]
  }
  const [a, b] = await Promise.all([cache.get("/repo", load), cache.get("/repo", load)])
  expect(a).toEqual(["model"])
  expect(b).toEqual(["model"])
  expect(calls).toBe(1)
})

test("serves stale values immediately and revalidates in the background after TTL", async () => {
  const cache = createAsyncCache(30)
  let calls = 0
  const load = async () => {
    calls += 1
    await Bun.sleep(10)
    return calls
  }
  expect(await cache.get("/repo", load)).toBe(1)
  expect(await cache.get("/repo", load)).toBe(1)
  await Bun.sleep(40)
  // Stale-while-revalidate: the expired value is returned without waiting for
  // the refresh, and a single background refresh is shared with later callers.
  expect(await cache.get("/repo", load)).toBe(1)
  // Later callers join the single in-flight refresh and see the fresh value.
  expect(await cache.get("/repo", load)).toBe(2)
  expect(calls).toBe(2)
})

test("invalidation clears one key or all keys", async () => {
  const cache = createAsyncCache(10_000)
  await cache.get("/a", async () => "a")
  await cache.get("/b", async () => "b")
  cache.invalidate("/a")
  expect(cache.peek("/a")).toBeUndefined()
  expect(cache.peek("/b")).toBe("b")
  cache.invalidate()
  expect(cache.peek("/b")).toBeUndefined()
})

test("a failed load is not cached", async () => {
  const cache = createAsyncCache(10_000)
  let calls = 0
  const load = async () => {
    calls += 1
    if (calls === 1) throw new Error("offline")
    return "ok"
  }
  await expect(cache.get("/repo", load)).rejects.toThrow("offline")
  expect(await cache.get("/repo", load)).toBe("ok")
})
