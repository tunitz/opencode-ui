import { useEffect, useMemo, useRef, useState } from "react"
import { ArtifactDialog, ArtifactRow } from "@/components/tool-artifacts"
import { invalidateProjectArtifactCache, projectArtifactHrefs, resolveProjectArtifacts, uniqueProjectArtifacts, type ProjectArtifactResult } from "@/lib/project-artifacts"
import type { StreamStatus } from "@/lib/use-opencode"

export function ProjectArtifacts({ sessionID, messageID, text, streamStatus }: { sessionID: string; messageID: string; text: string; streamStatus: StreamStatus }) {
  const hrefs = useMemo(() => projectArtifactHrefs(text), [text])
  const [state, setState] = useState<{ key: string; results: ProjectArtifactResult[] }>({ key: "", results: [] })
  const [selected, setSelected] = useState<string | null>(null)
  const previousStream = useRef(streamStatus)
  const key = JSON.stringify([sessionID, messageID, text])
  useEffect(() => {
    const reconnected = previousStream.current !== "ready" && streamStatus === "ready"
    previousStream.current = streamStatus
    if (reconnected) invalidateProjectArtifactCache(sessionID, messageID, hrefs)
    if (!hrefs.length) return
    if (streamStatus !== "ready") return
    const controller = new AbortController()
    void resolveProjectArtifacts(sessionID, messageID, hrefs, controller.signal).then((results) => {
      if (!controller.signal.aborted) setState({ key, results })
    })
    return () => controller.abort()
  }, [sessionID, messageID, hrefs, key, streamStatus])
  const results = state.key === key ? state.results : []
  const artifacts = uniqueProjectArtifacts(results)
  return <>
    <ArtifactRow artifacts={artifacts} onOpen={setSelected} label={`${artifacts.length} project attachment${artifacts.length === 1 ? "" : "s"}`} />
    {artifacts.length > 0 ? <p className="text-xs text-muted-foreground">Project attachments show the current files, not a snapshot from this response.</p> : null}
    {results.filter((result) => result.status !== "ready").map((result) => <p key={result.href} className="text-xs text-muted-foreground break-all" role="status"><bdi>{result.href}: {result.status === "outside" ? "Outside the project" : "Attachment unavailable"}</bdi></p>)}
    <ArtifactDialog artifacts={artifacts} selectedKey={selected} onSelect={setSelected} onClose={() => setSelected(null)} />
  </>
}
