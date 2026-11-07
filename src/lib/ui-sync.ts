import { uiSyncSnapshotSchema, type UiSyncSnapshot } from "./ui-sync-contract"

/** Explicit, user-initiated operations only. No automatic reads or writes.
 * Upload replaces the complete shared snapshot with optimistic concurrency.
 * Callers must select non-secret metadata, and explicitly apply downloads.
 */
export const uiSync = {
  async inspect(): Promise<{ snapshot: UiSyncSnapshot; revision: string } | null> {
    const response = await fetch("/api/ui/sync", { cache: "no-store" })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Sync download failed (${response.status})`)
    const snapshot = uiSyncSnapshotSchema.parse(await response.json())
    const revision = response.headers.get("etag")
    if (!revision) throw new Error("Sync revision missing")
    return { snapshot, revision }
  },
  async download(backendVersion: string): Promise<{ snapshot: UiSyncSnapshot; revision: string } | null> {
    const result = await uiSync.inspect()
    if (result && result.snapshot.backendVersion !== backendVersion) throw new Error("Sync backend version mismatch")
    return result
  },
  async upload(snapshot: UiSyncSnapshot, revision: string | null): Promise<void> {
    const value = uiSyncSnapshotSchema.parse(snapshot)
    const response = await fetch("/api/ui/sync", {
      method: "PUT", headers: { "content-type": "application/json", ...(revision === null ? { "if-none-match": "*" } : { "if-match": revision }) }, body: JSON.stringify(value),
    })
    if (!response.ok) throw new Error(`Sync upload failed (${response.status})`)
  },
  async remove(revision: string): Promise<void> {
    const response = await fetch("/api/ui/sync", { method: "DELETE", headers: { "if-match": revision } })
    if (!response.ok) throw new Error(`Sync removal failed (${response.status})`)
  },
}
