import { useState } from "react"
import { Button } from "@/components/ui/button"
import { uiSync } from "@/lib/ui-sync"
import { collectUiSyncSnapshot, uiSyncStorageUpdates } from "@/lib/ui-sync-adapter"
import type { UiSyncSnapshot } from "@/lib/ui-sync-contract"

type Operation = { kind: "upload"; revision: string | null } | { kind: "download"; snapshot: UiSyncSnapshot } | { kind: "delete"; revision: string; otherVersion: boolean }

/** Manual actions are the opt-in: no background reads, writes or automatic reload. */
export function UiSyncSettings({ backendVersion }: { backendVersion: string | null }) {
  const [operation, setOperation] = useState<Operation | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function prepare(kind: Operation["kind"]) {
    if (!backendVersion) return
    setBusy(true); setMessage(null); setOperation(null)
    try {
      const existing = kind === "delete" ? await uiSync.inspect() : await uiSync.download(backendVersion)
      if (kind === "upload") setOperation({ kind, revision: existing?.revision ?? null })
      else if (!existing) setMessage("No shared snapshot exists for this backend.")
      else if (kind === "download") setOperation({ kind, snapshot: existing.snapshot })
      else setOperation({ kind, revision: existing.revision, otherVersion: existing.snapshot.backendVersion !== backendVersion })
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sync is unavailable.") }
    finally { setBusy(false) }
  }
  async function confirm() {
    if (!operation || !backendVersion) return
    setBusy(true); setMessage(null)
    try {
      if (operation.kind === "upload") {
        await uiSync.upload(collectUiSyncSnapshot(localStorage, location.origin, backendVersion), operation.revision)
        setMessage("Shared snapshot saved. Other devices can explicitly import it.")
      } else if (operation.kind === "delete") {
        await uiSync.remove(operation.revision)
        setMessage("Shared snapshot deleted. Browser-local settings were not changed.")
      } else {
        const updates = uiSyncStorageUpdates(operation.snapshot, location.origin, backendVersion)
        const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, localStorage.getItem(key)]))
        try { for (const [key, value] of Object.entries(updates)) localStorage.setItem(key, value) }
        catch (error) {
          for (const [key, value] of Object.entries(previous)) {
            try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* Storage may remain unavailable. */ }
          }
          throw error
        }
        setMessage("Settings imported. Reload this page when ready to apply them; unsent attachments may be lost on reload.")
      }
      setOperation(null)
    } catch (error) {
      setOperation(null)
      setMessage(`${error instanceof Error ? error.message : "Sync failed."} If the snapshot changed, try again. Browser storage may be partially updated if it became unavailable.`)
    } finally { setBusy(false) }
  }
  return <section aria-label="Cross-device preferences" className="mt-5 flex flex-col gap-3">
    <h3 className="text-sm font-medium">Cross-device preferences</h3>
    <p className="text-xs text-muted-foreground">Optional manual sharing of theme, defaults, presets, session pins and labels. Anyone with access to this UI can read or replace the shared snapshot. Do not put secrets or session content in labels or preset names. Drafts, messages, attachments and credentials are not shared.</p>
    {!backendVersion ? <p className="text-xs text-muted-foreground">Connect to the engine before sharing preferences.</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11" disabled={busy || !backendVersion} onClick={() => void prepare("upload")}>Share this device</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy || !backendVersion} onClick={() => void prepare("download")}>Import shared settings</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy || !backendVersion} onClick={() => void prepare("delete")}>Delete shared snapshot</Button>
    </div>
    {operation ? <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-xs">{operation.kind === "upload" ? "Confirm replacing the shared snapshot with this device's settings." : operation.kind === "download" ? "Confirm replacing this browser's shared preference categories. Reload later to apply them." : operation.otherVersion ? "This snapshot belongs to a different backend version. Confirm deleting it for every device." : "Confirm deleting the shared snapshot for every device."}</p>
      <div className="flex gap-2"><Button type="button" className="min-h-11" disabled={busy} onClick={() => void confirm()}>Confirm {operation.kind}</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setOperation(null)}>Cancel</Button></div>
    </div> : null}
    {message ? <p role="status" className="text-xs break-words">{message}</p> : null}
  </section>
}
