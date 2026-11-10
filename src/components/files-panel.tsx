import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  FileQuestionIcon,
  FileTextIcon,
  FolderIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FileDiffInfo, SessionInfo } from "@/lib/opencode"
import {
  MAX_FILE_PREVIEW_BYTES,
  decodeFilePreview,
  diffTotals,
  formatFileSize,
  fsFindUrl,
  fsListUrl,
  fsReadUrl,
  inferMime,
  parentPath,
  parseContentRange,
  pathSegments,
  renderPatch,
  vcsDiffUrl,
  type ProjectEntry,
} from "@/lib/files"
import type { OpenCodeController } from "@/lib/use-opencode"
import { insertProjectReference, isSafeReferencePath } from "@/lib/file-references"
import { readCurrentKeybindings } from "@/lib/use-keybindings"
import { matchesKeybinding } from "@/lib/keybindings"
import { cn } from "@/lib/utils"

type LoadStatus = "idle" | "loading" | "ready" | "error"

export type InspectorPanelHandle = {
  refresh: () => Promise<string | null | undefined>
}

async function apiJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === "string" && body.message.trim()) {
        message = body.message
      }
    } catch {
      // The status is enough when the error body is not JSON.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

function EntryButton({
  entry,
  onOpen,
  onInsert,
}: {
  entry: ProjectEntry
  onOpen: (entry: ProjectEntry) => void
  onInsert: (path: string) => void
}) {
  const name = entry.path.split("/").filter(Boolean).at(-1) ?? entry.path
  return (
    <li className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        aria-label={`${entry.type === "directory" ? "Open folder" : "Open file"} ${entry.path}`}
        onClick={() => onOpen(entry)}
        className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 py-1.5 text-start font-normal"
      >
        {entry.type === "directory" ? (
          <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span dir="ltr" className="min-w-0 flex-1 truncate text-[13px]">
          {name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {entry.type}
        </span>
      </Button>
      {entry.type === "file" ? (
        <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label={`Insert reference to ${entry.path}`} onClick={() => onInsert(entry.path)}>
          <PlusIcon aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </li>
  )
}

function ProjectFileList({
  title,
  entries,
  empty,
  onOpen,
  onInsert,
}: {
  title: string
  entries: ProjectEntry[]
  empty: string
  onOpen: (entry: ProjectEntry) => void
  onInsert: (path: string) => void
}) {
  return (
    <section className="space-y-1" aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((entry) => (
            <EntryButton key={`${entry.type}:${entry.path}`} entry={entry} onOpen={onOpen} onInsert={onInsert} />
          ))}
        </ul>
      )}
    </section>
  )
}

type FileView = {
  path: string
  mime: string
  size: number | null
  text: string
  binary: boolean
  truncated: boolean
}

export function FilesPanel({
  nav,
  session,
  refreshRef,
  initialPath,
}: {
  nav: OpenCodeController
  session: SessionInfo
  refreshRef?: { current: InspectorPanelHandle | null }
  initialPath?: string
}) {
  const directory = session.location?.directory ?? null
  const sessionID = session.id
  const [cwd, setCwd] = useState("")
  const [entries, setEntries] = useState<ProjectEntry[]>([])
  const [entriesContext, setEntriesContext] = useState<string | null>(null)
  const [listStatus, setListStatus] = useState<LoadStatus>("idle")
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [searchEntries, setSearchEntries] = useState<ProjectEntry[] | null>(null)
  const [searchStatus, setSearchStatus] = useState<LoadStatus>("idle")
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null)
  const [view, setView] = useState<FileView | null>(null)
  const [viewPath, setViewPath] = useState<string | null>(null)
  const [viewStatus, setViewStatus] = useState<LoadStatus>("idle")
  const [viewError, setViewError] = useState<string | null>(null)
  const [attachingPath, setAttachingPath] = useState<string | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const request = useRef(0)
  const viewRequest = useRef(0)
  const searchRequest = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const viewAbortRef = useRef<AbortController | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)

  const loadDirectory = useCallback(
    async (path: string): Promise<string | null | undefined> => {
      if (!directory) {
        setListStatus("error")
        setListError("This session has no project directory.")
        return "This session has no project directory."
      }
      const requestID = ++request.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setListStatus("loading")
      setListError(null)
      try {
        const body = await apiJson<{ data: ProjectEntry[] }>(
          fsListUrl(directory, path),
          controller.signal
        )
        if (requestID !== request.current) return undefined
        setEntries(body.data ?? [])
        setEntriesContext(JSON.stringify([sessionID, directory, path]))
        setListStatus("ready")
        return null
      } catch (error) {
        if (controller.signal.aborted || requestID !== request.current) return undefined
        const failure = error instanceof Error ? error.message : String(error)
        setListStatus("error")
        setListError(failure)
        return failure
      }
    },
    [directory, sessionID]
  )

  const cancelRequests = useCallback(() => {
    request.current++
    viewRequest.current++
    searchRequest.current++
    abortRef.current?.abort()
    viewAbortRef.current?.abort()
    searchAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setCwd("")
        setView(null)
        setViewPath(null)
        setViewStatus("idle")
        setViewError(null)
        setQuery("")
        setSearchEntries(null)
        setSearchedQuery(null)
        setSearchStatus("idle")
        setSearchError(null)
        void loadDirectory("")
        if (initialPath) void openFile(initialPath)
      }
    })
    return () => {
      cancelled = true
      cancelRequests()
    }
  // initialPath is fixed for this mounted panel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelRequests, loadDirectory, sessionID, initialPath])

  const openEntry = (entry: ProjectEntry) => {
    setAttachError(null)
    if (entry.type === "directory") {
      setCwd(entry.path)
      setSearchEntries(null)
      setSearchedQuery(null)
      searchRequest.current++
      searchAbortRef.current?.abort()
      setSearchStatus("idle")
      setQuery("")
      closePreview()
      void loadDirectory(entry.path)
      return
    }
    void openFile(entry.path)
  }

  async function openFile(path: string): Promise<string | null | undefined> {
    if (!directory) return "This session has no project directory."
    setViewPath(path)
    const requestID = ++viewRequest.current
    viewAbortRef.current?.abort()
    const controller = new AbortController()
    viewAbortRef.current = controller
    setViewStatus("loading")
    setViewError(null)
    // Keep a valid preview of the same file visible while it refreshes.
    setView((current) => (current?.path === path ? current : null))
    if (!isSafeReferencePath(path)) {
      const failure = "Invalid project file path."
      setViewStatus("error")
      setViewError(failure)
      return failure
    }
    try {
      const response = await fetch(fsReadUrl(directory, path), {
        headers: { Range: `bytes=0-${MAX_FILE_PREVIEW_BYTES - 1}` },
        signal: controller.signal,
      })
      const range = parseContentRange(response.headers.get("content-range"))
      const declaredLength = Number(response.headers.get("content-length"))
      const total =
        range.total !== undefined
          ? range.total
          : Number.isFinite(declaredLength) && declaredLength >= 0
            ? declaredLength
            : null
      if (response.status === 416 && total === 0) {
        if (requestID !== viewRequest.current) return undefined
        setView({
          path,
          mime: inferMime(path),
          size: 0,
          text: "",
          binary: false,
          truncated: false,
        })
        setViewStatus("ready")
        return null
      }
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "File not found."
            : `File request failed (${response.status}).`
        )
      }
      const chunks: Uint8Array[] = []
      let received = 0
      const reader = response.body?.getReader()
      if (reader) {
        while (received < MAX_FILE_PREVIEW_BYTES) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          const slice = value.subarray(
            0,
            Math.max(0, MAX_FILE_PREVIEW_BYTES - received)
          )
          chunks.push(slice)
          received += slice.byteLength
          if (received >= MAX_FILE_PREVIEW_BYTES) {
            await reader.cancel()
            break
          }
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer())
        chunks.push(bytes.subarray(0, MAX_FILE_PREVIEW_BYTES))
        received = Math.min(bytes.byteLength, MAX_FILE_PREVIEW_BYTES)
      }
      if (requestID !== viewRequest.current) return undefined
      const bytes = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      const preview = decodeFilePreview(bytes, total)
      const headerMime = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
      setView({
        path,
        mime: headerMime && /^[\w.+-]+\/[\w.+-]+$/.test(headerMime)
          ? headerMime
          : inferMime(path),
        size: total,
        text: preview.text,
        binary: preview.binary,
        truncated: preview.truncated,
      })
      setViewStatus("ready")
      return null
    } catch (error) {
      if (controller.signal.aborted || requestID !== viewRequest.current) return undefined
      const failure = error instanceof Error ? error.message : String(error)
      setViewStatus("error")
      setViewError(failure)
      return failure
    }
  }

  async function search(): Promise<string | null | undefined> {
    if (!directory) return "This session has no project directory."
    const text = query.trim()
    const requestID = ++searchRequest.current
    searchAbortRef.current?.abort()
    if (!text) {
      setSearchEntries(null)
      setSearchedQuery(null)
      setSearchStatus("idle")
      setSearchError(null)
      return null
    }
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchEntries(null)
    setSearchedQuery(text)
    setSearchStatus("loading")
    setSearchError(null)
    try {
      const body = await apiJson<{ data: ProjectEntry[] }>(
          fsFindUrl(directory, text), controller.signal
      )
      if (controller.signal.aborted || requestID !== searchRequest.current) return undefined
      setSearchEntries(body.data ?? [])
      setSearchStatus("ready")
      return null
    } catch (error) {
      if (controller.signal.aborted || requestID !== searchRequest.current) return undefined
      const failure = error instanceof Error ? error.message : String(error)
      setSearchStatus("error")
      setSearchError(failure)
      return failure
    }
  }

  async function refresh(): Promise<string | null | undefined> {
    if (viewPath) return openFile(viewPath)
    if (searchedQuery !== null && query.trim() === searchedQuery) return search()
    return loadDirectory(cwd)
  }

  useEffect(() => {
    if (!refreshRef) return
    refreshRef.current = { refresh }
    return () => {
      refreshRef.current = null
    }
  })

  async function attach(path: string) {
    setAttachError(null)
    setAttachingPath(path)
    const failure = await nav.attachProjectFile(path)
    setAttachingPath(null)
    setAttachError(failure)
  }

  const attached = new Set(
    nav.attachments
      .map((attachment) => attachment.projectPath)
      .filter((path): path is string => Boolean(path))
  )
  const segments = pathSegments(cwd)
  const currentLabel = cwd || "Project root"
  const currentEntries = entriesContext === JSON.stringify([sessionID, directory, cwd])

  function closePreview() {
    viewRequest.current++
    viewAbortRef.current?.abort()
    setView(null)
    setViewPath(null)
    setViewStatus("idle")
    setViewError(null)
  }

  return (
    <div className="min-w-0 space-y-4">
      {attachError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {attachError}
        </p>
      ) : null}

      {view ? (
        <section className="space-y-2" aria-label={`File ${view.path}`}>
          <div className="flex items-start gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-0 flex-1 justify-start gap-2 px-2 text-xs"
              onClick={closePreview}
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              <span className="truncate" dir="ltr">{view.path}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 px-3 text-xs"
              aria-label={`Attach ${view.path}`}
              disabled={attached.has(view.path) || attachingPath === view.path}
              onClick={() => void attach(view.path)}
            >
              <PaperclipIcon aria-hidden="true" className="size-4" />
              {attached.has(view.path) ? "Attached" : "Attach"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {view.mime} · {formatFileSize(view.size)} · read-only
            {view.truncated ? ` · showing the first ${formatFileSize(MAX_FILE_PREVIEW_BYTES)}` : ""}
          </p>
          {viewStatus === "loading" ? (
            <p role="status" className="text-xs text-muted-foreground">Refreshing file preview…</p>
          ) : null}
          {viewStatus === "error" ? (
            <div role="alert" className="space-y-2 text-xs text-destructive">
              <p className="break-words">Refresh failed: {viewError}. Showing the previous preview.</p>
              <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => void openFile(view.path)}>
                Retry preview
              </Button>
            </div>
          ) : null}
          {view.binary ? (
            <p role="status" className="rounded-xl border border-border/70 p-3 text-xs text-muted-foreground">
              Binary file. A safe text preview is unavailable.
            </p>
          ) : (
            <pre
              dir="ltr"
              tabIndex={0}
              aria-label={`File content ${view.path}`}
              className="max-h-[45svh] overflow-auto rounded-xl border border-border/70 bg-muted/40 p-3 font-mono text-[13px] leading-5 whitespace-pre"
            >
              {view.text}
            </pre>
          )}
        </section>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void search()
            }}
          >
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                searchRequest.current++
                searchAbortRef.current?.abort()
                setSearchEntries(null)
                setSearchedQuery(null)
                setSearchStatus("idle")
                setSearchError(null)
              }}
              placeholder="Find project files"
              aria-label="Find project files"
              className="h-11 min-w-0 flex-1 text-base md:text-sm"
            />
            <Button type="submit" variant="outline" className="h-11 shrink-0 px-3" aria-label="Search project files">
              <SearchIcon aria-hidden="true" className="size-4" />
            </Button>
          </form>

          {searchStatus === "loading" ? (
            <p role="status" className="text-xs text-muted-foreground">Searching for “{searchedQuery}”…</p>
          ) : null}
          {searchStatus === "error" ? (
            <p role="alert" className="text-xs break-words text-destructive">{searchError}</p>
          ) : null}
          {searchStatus === "loading" || searchStatus === "error" ? null : searchEntries ? (
            <>
            <p className="text-xs text-muted-foreground">Showing up to 50 results.</p>
            <ProjectFileList
              title={`Search results for “${searchedQuery}”`}
              entries={searchEntries}
              empty="No matching files."
              onOpen={openEntry}
              onInsert={(path) => insertProjectReference(sessionID, path)}
            />
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 min-w-0 flex-1 justify-start gap-2 px-2 text-xs"
                  disabled={!cwd}
                  onClick={() => {
                    const parent = parentPath(cwd)
                    setCwd(parent)
                    closePreview()
                    void loadDirectory(parent)
                  }}
                >
                  <ArrowLeftIcon aria-hidden="true" className="size-4" />
                  <span className="truncate" dir="ltr">{currentLabel}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 px-3 text-xs"
                  aria-label="Refresh project files"
                  onClick={() => void loadDirectory(cwd)}
                >
                  <RefreshCwIcon aria-hidden="true" className="size-4" />
                </Button>
              </div>
              {segments.length > 0 ? (
                <p className="text-[11px] break-words text-muted-foreground" dir="ltr">
                  {segments.join(" / ")}
                </p>
              ) : null}
              {listStatus === "loading" ? (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                  Loading files…
                </p>
              ) : null}
              {listStatus === "error" ? (
                <div role="alert" className="space-y-2 text-xs text-destructive">
                  <p className="break-words">{listError}</p>
                  <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => void loadDirectory(cwd)}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {currentEntries && listStatus === "ready" ? (
                <ProjectFileList
                  title="Project files"
                  entries={entries}
                  empty="This directory is empty."
                  onOpen={openEntry}
                  onInsert={(path) => insertProjectReference(sessionID, path)}
                />
              ) : null}
            </>
          )}
          {viewPath && (viewStatus === "loading" || viewStatus === "error") ? (
            <Button type="button" variant="outline" className="h-11" onClick={closePreview}>
              <ArrowLeftIcon aria-hidden="true" className="size-4" /> Back to files
            </Button>
          ) : null}
          {viewStatus === "loading" ? (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              Reading file…
            </p>
          ) : null}
          {viewStatus === "error" ? (
            <div role="alert" className="space-y-2 text-xs text-destructive">
              <p className="break-words">{viewError}</p>
              <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => {
                if (viewPath) void openFile(viewPath)
              }}>
                Retry
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function DiffCounts({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  return (
    <span
      data-diff-counts
      className="inline-flex items-center gap-1 tabular-nums"
      aria-label={`${additions} added lines, ${deletions} deleted lines`}
    >
      <span className={additions === 0 ? "text-muted-foreground" : "text-diff-added"}>
        +{additions}
      </span>
      <span className={deletions === 0 ? "text-muted-foreground" : "text-diff-removed"}>
        −{deletions}
      </span>
    </span>
  )
}

export function countDiffMatches(patch: string, find: string): number {
  const query = find.trim()
  if (!query) return 0
  const needle = query.toLocaleLowerCase()
  return renderPatch(patch).lines.reduce((total, line) => {
    const text = line.text.toLocaleLowerCase()
    let count = 0
    let index = text.indexOf(needle)
    while (index >= 0) {
      count += 1
      index = text.indexOf(needle, index + needle.length)
    }
    return total + count
  }, 0)
}

function HighlightedLine({
  text,
  find,
  startIndex,
  activeMatch,
}: {
  text: string
  find: string
  startIndex: number
  activeMatch: number
}) {
  const query = find.trim()
  if (!query) return <>{text || " "}</>
  const lower = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0
  let match = startIndex
  let index = lower.indexOf(needle)
  while (index >= 0) {
    if (index > cursor) parts.push(text.slice(cursor, index))
    const selected = match === activeMatch
    parts.push(
      <mark
        key={`${match}:${index}`}
        data-diff-match={match}
        className={cn(
          "rounded-sm bg-amber-300/70 text-foreground dark:bg-amber-400/40",
          selected && "outline-2 outline-amber-500"
        )}
      >
        {text.slice(index, index + needle.length)}
      </mark>
    )
    match += 1
    cursor = index + needle.length
    index = lower.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts.length ? parts : " "}</>
}

function DiffPatch({
  file,
  find = "",
  activeMatch = 0,
}: {
  file: FileDiffInfo
  find?: string
  activeMatch?: number
}) {
  const rendered = useMemo(() => renderPatch(file.patch), [file.patch])
  if (!file.patch.trim()) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        No textual patch is available for this file.
      </p>
    )
  }
  const matchStarts: number[] = []
  const needle = find.trim().toLocaleLowerCase()
  let matchCursor = 0
  for (const line of rendered.lines) {
    matchStarts.push(matchCursor)
    if (needle) {
      matchCursor += line.text.toLocaleLowerCase().split(needle).length - 1
    }
  }
  return (
    <>
      {rendered.truncated ? (
        <p role="status" className="text-[11px] text-muted-foreground">
          Patch preview is truncated for display.
        </p>
      ) : null}
      <pre
        dir="ltr"
        tabIndex={0}
        aria-label={`Diff for ${file.file}`}
        className="max-h-[45svh] overflow-auto rounded-xl border border-border/70 bg-muted/40 p-3 font-mono text-[13px] leading-5 whitespace-pre"
      >
        {rendered.lines.map((line, lineIndex) => {
          const start = matchStarts[lineIndex] ?? 0
          return (
            <span
              key={line.key}
              className={cn(
                "block",
                line.kind === "addition" && "bg-diff-added/10 text-diff-added",
                line.kind === "deletion" && "bg-diff-removed/10 text-diff-removed",
                line.kind === "hunk" && "text-sky-700 dark:text-sky-300",
                line.kind === "meta" && "text-muted-foreground"
              )}
            >
              <HighlightedLine
                text={line.text}
                find={find}
                startIndex={start}
                activeMatch={activeMatch}
              />
            </span>
          )
        })}
      </pre>
    </>
  )
}

export function ChangesPanel({
  nav,
  session,
  refreshRef,
  onOpenFile,
}: {
  nav: OpenCodeController
  session: SessionInfo
  refreshRef?: { current: InspectorPanelHandle | null }
  onOpenFile?: (path: string) => void
}) {
  const directory = session.location?.directory ?? null
  const scope = nav?.changesScope ?? "working"
  const focusPath = nav?.diffFocusPath ?? null
  const loadTurnDiff = nav?.loadTurnDiff
  const context = JSON.stringify([session.id, directory, scope])
  const [files, setFiles] = useState<FileDiffInfo[]>([])
  const [filesContext, setFilesContext] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null | undefined>(undefined)
  const [reloadKey, setReloadKey] = useState(0)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [find, setFind] = useState("")
  const [activeMatch, setActiveMatch] = useState(0)
  const findRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const loadDiff = useCallback(async (): Promise<string | null | undefined> => {
    const requestID = ++request.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus("loading")
    setError(null)
    setFallbackReason(null)

    if (scope === "turn") {
      // Native session diff with no explicit boundary means the latest turn;
      // a loaded message id would point at the wrong turn while a new prompt
      // is still running.
      if (!loadTurnDiff) {
        setFallbackReason("Turn diff is unavailable in this host. Showing the working tree.")
      } else {
        const result = await loadTurnDiff(session.id)
        if (requestID !== request.current) return undefined
        if (result.ok) {
          setFiles(result.files)
          setFilesContext(context)
          setSelectedPath((current) =>
            current && result.files.some((file) => file.file === current)
              ? current
              : (focusPath && result.files.some((file) => file.file === focusPath)
                  ? focusPath
                  : (result.files[0]?.file ?? null))
          )
          setStatus("ready")
          return null
        }
        setFallbackReason(
          `Turn diff unavailable: ${result.reason}. Showing the working tree.`
        )
      }
    }

    const url = directory ? vcsDiffUrl(directory) : null

    if (!url) {
      const message = "This session has no project directory for a working-tree diff."
      setBranch(null)
      setStatus("error")
      setError(message)
      return message
    }

    setBranch(undefined)
    const branchQuery = new URLSearchParams({ "location[directory]": directory! })
    void apiJson<{ data: { branch?: { current?: string } } }>(
      `/api/vcs?${branchQuery.toString()}`,
      controller.signal
    ).then((body) => {
      if (requestID === request.current) setBranch(body.data?.branch?.current || null)
    }).catch(() => {
      if (requestID === request.current && !controller.signal.aborted) setBranch(null)
    })

    try {
      const body = await apiJson<{ data: FileDiffInfo[] }>(url, controller.signal)
      if (requestID !== request.current) return undefined
      const next = body.data ?? []
      setFiles(next)
      setFilesContext(context)
      setSelectedPath((current) =>
        current && next.some((file) => file.file === current)
          ? current
          : (focusPath && next.some((file) => file.file === focusPath)
              ? focusPath
              : (next[0]?.file ?? null))
      )
      setStatus("ready")
      return null
    } catch (failure) {
      if (controller.signal.aborted || requestID !== request.current) return undefined
      const message = failure instanceof Error ? failure.message : String(failure)
      setStatus("error")
      setError(message)
      return message
    }
  }, [context, directory, focusPath, loadTurnDiff, scope, session.id])

  const cancelRequest = useCallback(() => {
    request.current++
    abortRef.current?.abort()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void loadDiff() })
    return () => {
      cancelled = true
      cancelRequest()
    }
  }, [cancelRequest, loadDiff, reloadKey])

  useEffect(() => {
    if (!refreshRef) return
    refreshRef.current = { refresh: loadDiff }
    return () => {
      refreshRef.current = null
    }
  })

  const visibleFiles = filesContext === context ? files : []
  const totals = diffTotals(visibleFiles)
  const selected = visibleFiles.find((file) => file.file === selectedPath) ?? null
  const matchCount = selected ? countDiffMatches(selected.patch, find) : 0

  useEffect(() => {
    if (!find.trim()) return
    const container = document.querySelector<HTMLElement>(
      `[data-diff-match="${Math.min(activeMatch, Math.max(0, matchCount - 1))}"]`
    )
    container?.scrollIntoView({ block: "nearest" })
  }, [activeMatch, find, matchCount])

  function stepMatch(direction: 1 | -1) {
    if (matchCount === 0) return
    setActiveMatch((current) => (current + direction + matchCount) % matchCount)
  }

  return (
    <div
      className="space-y-3"
      data-diff-scope
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        const binding = readCurrentKeybindings().find(
          (candidate) => candidate.command === "find.open"
        )
        const platform = navigator.platform.toLowerCase().includes("mac") ? "mac" : "other"
        if (binding && matchesKeybinding(event.nativeEvent, binding, platform)) {
          event.preventDefault()
          findRef.current?.focus()
        }
      }}
    >
      <div
        role="group"
        aria-label="Diff scope"
        className="flex gap-1 rounded-full bg-muted p-1"
      >
        <Button
          type="button"
          variant={scope === "working" ? "secondary" : "ghost"}
          aria-pressed={scope === "working"}
          className="h-11 min-w-0 flex-1 rounded-full px-3 text-xs"
          onClick={() => nav?.setChangesScope("working")}
        >
          Working tree
        </Button>
        <Button
          type="button"
          variant={scope === "turn" ? "secondary" : "ghost"}
          aria-pressed={scope === "turn"}
          className="h-11 min-w-0 flex-1 rounded-full px-3 text-xs"
          onClick={() => nav?.setChangesScope("turn")}
        >
          This turn
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Branch: <span dir="auto" className="font-medium text-foreground">{branch === undefined ? "Loading…" : branch ?? "Unavailable"}</span>
      </p>
      <p className="text-[11px] text-muted-foreground">
        {scope === "working"
          ? "VCS HEAD to working copy — not the session turn."
          : "Native session diff for the latest turn."}
      </p>
      {fallbackReason ? (
        <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-foreground">
          {fallbackReason}
        </p>
      ) : null}

      <form
        className="flex w-full items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          stepMatch(1)
        }}
      >
        <Input
          ref={findRef}
          data-diff-find
          value={find}
          onChange={(event) => {
            setFind(event.target.value)
            setActiveMatch(0)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              stepMatch(event.shiftKey ? -1 : 1)
            }
          }}
          placeholder="Find in diff"
          aria-label="Find in diff"
          className="h-11 w-0 min-w-0 flex-1 text-base md:text-sm"
        />
        {find.trim() ? (
          <span className="shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
            {matchCount ? activeMatch + 1 : 0}/{matchCount}
          </span>
        ) : null}
        <Button type="button" variant="outline" size="icon-lg" className="size-11 shrink-0 rounded-lg p-0" aria-label="Previous diff match" disabled={matchCount === 0} onClick={() => stepMatch(-1)}>
          <ArrowUpIcon aria-hidden="true" className="size-5" />
        </Button>
        <Button type="button" variant="outline" size="icon-lg" className="size-11 shrink-0 rounded-lg p-0" aria-label="Next diff match" disabled={matchCount === 0} onClick={() => stepMatch(1)}>
          <ArrowDownIcon aria-hidden="true" className="size-5" />
        </Button>
      </form>

      {status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          {visibleFiles.length > 0 ? "Refreshing diff; showing previous results…" : "Loading diff…"}
        </p>
      ) : null}
      {status === "error" ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p className="break-words">{error}</p>
          {visibleFiles.length > 0 ? <p>Showing previous results for this working tree.</p> : null}
          <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => {
            setStatus("loading")
            setError(null)
            setReloadKey((current) => current + 1)
          }}>
            Retry
          </Button>
        </div>
      ) : null}
      {status === "ready" && filesContext === context && visibleFiles.length === 0 ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileQuestionIcon aria-hidden="true" className="size-4" />
          {scope === "turn" ? "No changes in this turn." : "No changes in this working tree."}
        </p>
      ) : null}
      {visibleFiles.length > 0 ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            {visibleFiles.length} file{visibleFiles.length === 1 ? "" : "s"} · <DiffCounts additions={totals.additions} deletions={totals.deletions} />
          </p>
          <ul className="space-y-1" aria-label="Changed files">
            {visibleFiles.map((file) => (
              <li key={file.file}>
                <Button
                  type="button"
                  variant={selectedPath === file.file ? "secondary" : "ghost"}
                  aria-pressed={selectedPath === file.file}
                  className="h-auto min-h-11 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-start font-normal"
                  onClick={() => {
                    setSelectedPath(file.file)
                    setActiveMatch(0)
                  }}
                >
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase">
                    {file.status}
                  </span>
                  <span dir="ltr" className="min-w-0 flex-1 truncate text-[12px]">
                    {file.file}
                  </span>
                  <span className="shrink-0 text-[10px]">
                    <DiffCounts additions={file.additions} deletions={file.deletions} />
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          {selected ? (
            <section className="space-y-2" aria-label={`Diff ${selected.file}`}>
              <h3 dir="ltr" className="text-xs font-medium break-words">{selected.file}</h3>
              {onOpenFile && selected.status !== "deleted" && isSafeReferencePath(selected.file) ? (
                <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => onOpenFile(selected.file)}>
                  Open read-only file
                </Button>
              ) : null}
              <DiffPatch file={selected} find={find} activeMatch={activeMatch} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
