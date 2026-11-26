import { useEffect, useState } from "react"
import { GitCompareArrowsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { diffTotals, vcsDiffUrl } from "@/lib/files"
import type { FileDiffInfo } from "@/lib/opencode"

type Snapshot = { key: string; files: FileDiffInfo[] } | null
type BranchSnapshot = { key: string; branch: string | null } | null

const SHORTCUT_BAND_QUERY = "(min-width: 640px) and (max-width: 767px)"

function useShortcutVisible(): boolean {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return true
    }
    return window.matchMedia(SHORTCUT_BAND_QUERY).matches
  })
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const media = window.matchMedia(SHORTCUT_BAND_QUERY)
    const sync = () => setVisible(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])
  return visible
}

/** A point-in-time VCS HEAD-to-working-copy summary, not session attribution. */
export function WorkingTreeShortcut({ sessionID, directory, onOpen }: {
  sessionID: string
  directory: string | null
  onOpen: () => void
}) {
  const visible = useShortcutVisible()
  const key = JSON.stringify([sessionID, directory])
  const [snapshot, setSnapshot] = useState<Snapshot>(null)
  const [branchSnapshot, setBranchSnapshot] = useState<BranchSnapshot>(null)
  const [state, setState] = useState<{ key: string; status: "loading" | "ready" | "unavailable" }>({ key, status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    if (!directory || !visible) return () => controller.abort()

    const branchQuery = new URLSearchParams({ "location[directory]": directory })
    void fetch(`/api/vcs?${branchQuery.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Branch unavailable")
        const body: unknown = await response.json()
        const current = (body as { data?: { branch?: { current?: unknown } } } | null)?.data?.branch?.current
        if (!controller.signal.aborted) {
          setBranchSnapshot({ key, branch: typeof current === "string" && current ? current : null })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setBranchSnapshot({ key, branch: null })
      })

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
  }, [directory, key, visible])

  const status = !directory ? "unavailable" : state.key === key ? state.status : "loading"
  const files = snapshot?.key === key ? snapshot.files : null
  const branch = branchSnapshot?.key === key ? branchSnapshot.branch : null
  const totals = files ? diffTotals(files) : null
  const fileCount = files?.length ?? 0
  const label =
    status === "loading"
      ? "Working tree: loading"
      : status === "unavailable"
        ? "Working tree unavailable"
        : files?.length === 0
          ? `Working tree${branch ? ` on ${branch}` : ""}: clean`
          : `Working tree${branch ? ` on ${branch}` : ""}: ${files?.length} ${files?.length === 1 ? "file" : "files"}, ${totals?.additions} added, ${totals?.deletions} deleted`
  const stateText =
    status === "loading"
      ? "…"
      : status === "unavailable"
        ? "—"
        : null

  return (
    <Button type="button" variant="ghost" onClick={onOpen} className="hidden h-11 min-w-11 shrink-0 gap-1 px-2 text-xs md:text-[13px] sm:inline-flex" aria-label={`${label}. Open the session inspector to refresh.`} title={`${label}. Open the session inspector to refresh.`}>
      <GitCompareArrowsIcon aria-hidden="true" className="size-4" />
      <span aria-hidden="true" className="hidden max-w-[18rem] truncate sm:inline">
        {stateText ?? (
          <>
            {branch ? <>{branch} · </> : null}
            {fileCount === 0 ? (
              "Clean"
            ) : (
              <>
                {fileCount} {fileCount === 1 ? "file" : "files"} ·{" "}
                <span className="text-diff-added">+{totals?.additions}</span> ·{" "}
                <span className="text-diff-removed">−{totals?.deletions}</span>
              </>
            )}
          </>
        )}
      </span>
    </Button>
  )
}
