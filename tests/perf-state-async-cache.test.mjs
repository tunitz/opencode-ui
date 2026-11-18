import { expect, test } from "bun:test"
import { createAsyncCache } from "../src/lib/async-cache.ts"

test("stale values are served immediately and refreshed in the background", async () => {
  const cache = createAsyncCache(20)
  let calls = 0
  const load = async () => {
    calls += 1
    await Bun.sleep(5)
    return calls
  }

  expect(await cache.get("/repo", load)).toBe(1)
  await Bun.sleep(30)

  // The first post-TTL read returns the stale value without waiting.
  const stale = await cache.get("/repo", load)
  expect(stale).toBe(1)
  // The background refresh has settled by the time the next read runs.
  await Bun.sleep(15)
  expect(await cache.get("/repo", load)).toBe(2)
  expect(calls).toBe(2)
})

test("a burst of stale reads shares one background refresh", async () => {
  const cache = createAsyncCache(20)
  let calls = 0
  let finishRefresh
  const refresh = new Promise((done) => {
    finishRefresh = done
  })
  const load = () => {
    calls += 1
    return refresh
  }

  await cache.get("/repo", async () => {
    calls += 1
    return 1
  })
  await Bun.sleep(30)

  // Hold the refresh open so all three readers observe the same in-flight
  // promise: first gets stale immediately, the rest join and see fresh.
  const reads = Promise.all([
    cache.get("/repo", load),
    cache.get("/repo", load),
    cache.get("/repo", load),
  ])
  finishRefresh(2)
  expect(await reads).toEqual([1, 2, 2])
  expect(calls).toBe(2)
})

test("peek keeps the stale value while a refresh is in flight", async () => {
  const cache = createAsyncCache(20)
  await cache.get("/repo", async () => "old")
  await Bun.sleep(30)

  let resolve
  const refresh = new Promise((done) => {
    resolve = done
  })
  void cache.get("/repo", () => refresh)
  expect(cache.peek("/repo")).toBe("old")
  resolve("new")
  await Bun.sleep(5)
  expect(cache.peek("/repo")).toBe("new")
})

test("a failed background refresh evicts the entry and is not unhandled", async () => {
  const cache = createAsyncCache(20)
  await cache.get("/repo", async () => "old")
  await Bun.sleep(30)

  let calls = 0
  const load = async () => {
    calls += 1
    if (calls === 1) throw new Error("offline")
    return "new"
  }
  expect(await cache.get("/repo", load)).toBe("old")
  await Bun.sleep(10)
  expect(cache.peek("/repo")).toBeUndefined()
  expect(await cache.get("/repo", load)).toBe("new")
})
