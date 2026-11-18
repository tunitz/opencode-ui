import { createAsyncCache } from "@/lib/async-cache"

/** Short-lived per-project worktree list cache for the management dialogs. */
export const worktreeCache = createAsyncCache<unknown>(15_000)

export function resetWorktreeCacheForTests(): void {
  worktreeCache.invalidate()
}
