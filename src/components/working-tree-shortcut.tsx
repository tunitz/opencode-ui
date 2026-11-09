import { useEffect, useState } from "react"
import { GitCompareArrowsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { diffTotals, vcsDiffUrl } from "@/lib/files"
import type { FileDiffInfo } from "@/lib/opencode"

type Snapshot = { key: string; files: FileDiffInfo[] } | null

/** A point-in-time VCS HEAD-to-working-copy summary, not session attribution. */
export function WorkingTreeShortcut({ sessionID, directory, onOpen }: {
  sessionID: string
  directory: string | null
  onOpen: () => void
}) {
  const key = JSON.stringify([sessionID, directory])
  const [snapshot, setSnapshot] = useState<Snapshot>(null)
  const [state, setState] = useState<{ key: string; status: "loading" | "ready" | "unavailable" }>({ key, status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    if (!directory) return () => controller.abort()
    void fetch(vcsDiffUrl(directory), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Diff unavailable")
        const body: unknown = await response.json()
        const data = (body as { data?: unknown } | null)?.data
        if (!Array.isArray(data) || !data.every((file) => file && typeof file.file === "string" && Number.isFinite(file.additions) && file.additions >= 0 && Number.isFinite(file.deletions) && file.deletions >= 0)) throw new Error("Invalid diff")
        if (!controller.signal.aborted) {
          setSnapshot({ key, files: data as FileDiffInfo[] })
          setState({ key, status: "ready" })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, status: "unavailable" })
      })
    return () => controller.abort()
  }, [directory, key])

  const status = !directory ? "unavailable" : state.key === key ? state.status : "loading"
  const files = snapshot?.key === key ? snapshot.files : null
  const totals = files ? diffTotals(files) : null
  const label = status === "loading" ? "Working tree: loading" : status === "unavailable" ? "Working tree unavailable" : files?.length === 0 ? "Working tree: no changes" : `Working tree: ${files?.length} ${files?.length === 1 ? "file" : "files"}, ${totals?.additions} added, ${totals?.deletions} deleted`

  return (
    <Button type="button" variant="ghost" onClick={onOpen} className="hidden h-11 min-w-11 shrink-0 gap-1 px-2 text-xs sm:inline-flex" aria-label={`${label}. Snapshot may be stale; open working tree inspector to refresh.`} title={`${label}. Snapshot may be stale; open working tree inspector to refresh.`}>
      <GitCompareArrowsIcon aria-hidden="true" className="size-4" />
      <span aria-hidden="true" className="hidden sm:inline">{status === "loading" ? "…" : status === "unavailable" ? "—" : files?.length === 0 ? "Clean · snapshot" : `${files?.length} · +${totals?.additions} −${totals?.deletions} · snapshot`}</span>
    </Button>
  )
}
