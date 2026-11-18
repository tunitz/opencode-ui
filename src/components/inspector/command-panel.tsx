import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArchiveIcon,
  ArrowRightIcon,
  FileTextIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { openCode } from "@/lib/opencode"
import {
  COMMAND_MESSAGE_CAP,
  groupCommandItems,
  matchCommandItem,
  searchMessages,
  type CommandGroup,
  type CommandItem,
  type MessageSearchHit,
} from "@/lib/command-search"
import { fsFindUrl, type ProjectEntry } from "@/lib/files"
import type { OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"

type Entry = CommandItem & { run: () => void }

type MessageSearchState = {
  hits: MessageSearchHit[]
  searched: number
  capped: boolean
  status: "idle" | "loading" | "ready" | "error"
}

const EMPTY_MESSAGES: MessageSearchState = {
  hits: [],
  searched: 0,
  capped: false,
  status: "idle",
}

const GROUP_ICONS: Record<CommandGroup, typeof SearchIcon> = {
  Actions: SettingsIcon,
  Projects: FolderGit2Icon,
  Sessions: ArchiveIcon,
  Messages: FileTextIcon,
  Files: FileTextIcon,
}

export function CommandPanel({
  nav,
  mode,
  autoFocus,
  onClose,
  onOpenFile,
  onOpenSettings,
  onOpenWorktrees,
}: {
  nav: OpenCodeController
  mode: "sheet" | "sidebar"
  autoFocus: boolean
  onClose: () => void
  onOpenFile: (path: string) => void
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [nativeSessions, setNativeSessions] = useState<import("@/lib/opencode").SessionInfo[]>([])
  const [archivedResults, setArchivedResults] = useState<import("@/lib/opencode").SessionInfo[]>([])
  const [searchingSessions, setSearchingSessions] = useState(false)
  const [files, setFiles] = useState<ProjectEntry[]>([])
  const [fileStatus, setFileStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [messages, setMessages] = useState<MessageSearchState>(EMPTY_MESSAGES)
  const [sessionSearchError, setSessionSearchError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const trimmed = query.trim()
  const directory = nav.activeSession?.location?.directory ?? nav.location?.directory ?? null
  const activeSessionID = nav.activeSessionID
  const loadedMessages = nav.messages
  const searchSessions = nav.searchSessions

  useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [autoFocus])

  // Native session search (not a filter over only the loaded page). Archived
  // sessions are queried separately so results can be labeled honestly.
  useEffect(() => {
    const request = ++requestRef.current
    if (!trimmed) {
      void Promise.resolve().then(() => {
        if (request !== requestRef.current) return
        setNativeSessions([])
        setArchivedResults([])
        setSearchingSessions(false)
        setSessionSearchError(null)
      })
      return
    }
    void Promise.resolve().then(() => {
      if (request === requestRef.current) setSearchingSessions(true)
    })
    const timer = window.setTimeout(() => {
      void Promise.all([searchSessions(trimmed, false), searchSessions(trimmed, true)])
        .then(([active, archived]) => {
          if (request !== requestRef.current) return
          if (!active.ok || !archived.ok) {
            const failure = !active.ok ? active : archived
            setNativeSessions([])
            setArchivedResults([])
            setSessionSearchError(
              (!failure.ok && failure.error) || "Session search is unavailable."
            )
            return
          }
          setNativeSessions(active.sessions)
          setArchivedResults(archived.sessions)
          setSessionSearchError(null)
        })
        .catch(() => {
          if (request !== requestRef.current) return
          setSessionSearchError("Session search is unavailable.")
        })
        .finally(() => {
          if (request === requestRef.current) setSearchingSessions(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [searchSessions, trimmed])

  // Loaded history first, then paged native history with a hard 500-message cap.
  useEffect(() => {
    if (!trimmed || !activeSessionID) {
      void Promise.resolve().then(() => setMessages(EMPTY_MESSAGES))
      return
    }
    const controller = new AbortController()
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setMessages((current) => ({ ...current, status: "loading" }))
    })
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const loaded = searchMessages(loadedMessages, trimmed, COMMAND_MESSAGE_CAP)
          const seen = new Set(loadedMessages.map((message) => message.id))
          const hits = [...loaded.hits]
          let inspected = loaded.searched
          const capped = loaded.capped
          const sessionID = activeSessionID
          let cursor: string | undefined

          while (!capped && inspected < COMMAND_MESSAGE_CAP && sessionID && !controller.signal.aborted) {
            const response = await openCode.message.list(
              {
                sessionID,
                limit: Math.min(50, COMMAND_MESSAGE_CAP - inspected),
                order: "desc",
                ...(cursor ? { cursor } : {}),
              },
              { signal: controller.signal }
            )
            const fresh = response.data.filter((message) => !seen.has(message.id))
            for (const message of fresh) seen.add(message.id)
            const page = searchMessages(fresh, trimmed, COMMAND_MESSAGE_CAP - inspected)
            hits.push(...page.hits)
            inspected += page.searched
            cursor = response.cursor.next ?? undefined
            if (!cursor) break
          }

          if (cancelled || controller.signal.aborted) return
          setMessages({
            hits,
            searched: inspected,
            capped: inspected >= COMMAND_MESSAGE_CAP,
            status: "ready",
          })
        } catch {
          if (cancelled || controller.signal.aborted) return
          setMessages({ hits: [], searched: 0, capped: false, status: "error" })
        }
      })()
    }, 220)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [activeSessionID, loadedMessages, trimmed])

  // Project file search for the active directory.
  useEffect(() => {
    if (!trimmed || !directory) {
      void Promise.resolve().then(() => {
        setFiles([])
        setFileStatus("idle")
      })
      return
    }
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setFileStatus("loading")
    })
    const timer = window.setTimeout(() => {
      fetch(fsFindUrl(directory, trimmed), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("search failed")
          return (await response.json()) as { data: ProjectEntry[] }
        })
        .then((body) => {
          if (controller.signal.aborted) return
          setFiles((body.data ?? []).filter((entry) => entry.type === "file").slice(0, 20))
          setFileStatus("ready")
        })
        .catch(() => {
          if (!controller.signal.aborted) setFileStatus("error")
        })
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [directory, trimmed])

  const entries = useMemo<Entry[]>(() => {
    const actions: Entry[] = [
      {
        id: "action:settings",
        group: "Actions",
        label: "Open settings",
        detail: "Preferences and notifications",
        run: onOpenSettings,
      },
      {
        id: "action:worktrees",
        group: "Actions",
        label: "Manage project worktrees",
        detail: "Project isolation and existing worktrees",
        run: onOpenWorktrees,
      },
      {
        id: "action:refresh",
        group: "Actions",
        label: "Refresh sessions",
        detail: "Reload the native session list",
        run: nav.refreshSessions,
      },
      {
        id: "action:files",
        group: "Actions",
        label: "Open project files",
        detail: "Session inspector · Files",
        run: () => nav.openInspector("files"),
      },
      {
        id: "action:changes",
        group: "Actions",
        label: "Open changes",
        detail: "Session inspector · Changes",
        run: () => nav.openInspector("changes"),
      },
    ]

    const projectEntries: Entry[] = nav.projects.map((project) => ({
      id: `project:${project.id}`,
      group: "Projects",
      label: project.name?.trim() || project.canonical || project.id,
      detail: "Project",
      run: () => {
        onClose()
        void nav.selectProject(project.id)
      },
    }))

    const sessionEntries: Entry[] = [...nativeSessions, ...nav.sessions]
      .filter(
        (session, index, list) =>
          list.findIndex((entry) => entry.id === session.id) === index
      )
      .slice(0, 8)
      .map((session) => ({
        id: `session:${session.id}`,
        group: "Sessions",
        label: session.title?.trim() || "Untitled session",
        detail: "Session",
        run: () => {
          void nav.openSessionByID(session.id)
          if (mode === "sheet") onClose()
        },
      }))

    const archivedEntries: Entry[] = archivedResults.slice(0, 8).map((session) => ({
      id: `archived:${session.id}`,
      group: "Sessions",
      label: session.title?.trim() || "Untitled session",
      detail: "Archived session",
      archived: true,
      run: () => {
        void nav.openSessionByID(session.id)
        if (mode === "sheet") onClose()
      },
    }))

    const messageEntries: Entry[] = messages.hits.map((hit) => ({
      id: `message:${hit.messageID}`,
      group: "Messages",
      label: hit.snippet,
      detail: hit.role === "user" ? "You" : "Assistant",
      run: () => {
        void nav.revealMessage(hit.messageID)
        if (mode === "sheet") onClose()
      },
    }))

    const fileEntries: Entry[] = files.map((file) => ({
      id: `file:${file.path}`,
      group: "Files",
      label: file.path,
      detail: "Project file",
      run: () => {
        onOpenFile(file.path)
        if (mode === "sheet") onClose()
      },
    }))

    return [
      ...actions,
      ...projectEntries,
      ...sessionEntries,
      ...archivedEntries,
      ...messageEntries,
      ...fileEntries,
    ]
  }, [
    archivedResults,
    files,
    messages.hits,
    mode,
    nav,
    nativeSessions,
    onClose,
    onOpenFile,
    onOpenSettings,
    onOpenWorktrees,
  ])

  const results = useMemo(
    () => entries.filter((entry) => matchCommandItem(entry, query)),
    [entries, query]
  )
  const grouped = useMemo(
    () =>
      groupCommandItems(results).map((group) => ({
        group: group.group,
        items: group.items as Entry[],
      })),
    [results]
  )
  const flat = useMemo(() => grouped.flatMap((group) => group.items), [grouped])
  // Each grouped row used to call flat.indexOf(entry), turning the list into an
  // O(n²) scan on every render. The index is stable for a given flat list.
  const indexByEntry = useMemo(
    () => new Map(flat.map((entry, index) => [entry, index])),
    [flat]
  )
  const active = flat[Math.min(activeIndex, Math.max(0, flat.length - 1))] ?? null

  useEffect(() => {
    void Promise.resolve().then(() => setActiveIndex(0))
  }, [query])

  useEffect(() => {
    const button = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${Math.min(activeIndex, Math.max(0, flat.length - 1))}"]`
    )
    button?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, flat.length])

  function choose(entry: Entry | null) {
    if (!entry) return
    entry.run()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setActiveIndex((index) => (flat.length ? (index + 1) % flat.length : 0))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setActiveIndex((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0))
              } else if (event.key === "Enter") {
                event.preventDefault()
                choose(active)
              } else if (event.key === "Escape") {
                event.preventDefault()
                onClose()
              }
            }}
            aria-label="Search actions, sessions, messages, and files"
            placeholder="Search actions, sessions, messages, files"
            className="h-11 ps-9 text-base md:text-sm"
          />
        </div>
        <div className="mt-1.5 flex min-h-4 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {searchingSessions ? (
            <span role="status" className="flex items-center gap-1">
              <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin" />
              Searching sessions…
            </span>
          ) : null}
          {trimmed ? (
            <span role="status">
              Messages searched: {messages.searched}
              {messages.capped ? ` (limit ${COMMAND_MESSAGE_CAP})` : ""}
              {messages.status === "loading" ? " · loading…" : ""}
            </span>
          ) : null}
          {sessionSearchError ? <span role="alert">{sessionSearchError}</span> : null}
          {messages.status === "error" ? (
            <span role="alert">Message history search unavailable.</span>
          ) : null}
          {fileStatus === "error" ? <span role="alert">File search unavailable.</span> : null}
        </div>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        aria-label="Command results"
      >
        {flat.length === 0 && (searchingSessions || messages.status === "loading") ? (
          <div role="status" aria-label="Searching" className="flex flex-col gap-2 px-2 py-3">
            <span className="sr-only">Searching…</span>
            <Skeleton className="h-11 w-full" aria-hidden="true" />
            <Skeleton className="h-11 w-full" aria-hidden="true" />
            <Skeleton className="h-11 w-2/3" aria-hidden="true" />
          </div>
        ) : flat.length === 0 ? (
          <Empty className="border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SearchIcon /></EmptyMedia>
              <EmptyTitle>{trimmed ? "No matching results." : "Search actions, sessions, messages, and files."}</EmptyTitle>
              <EmptyDescription>
                {trimmed
                  ? "Try a shorter query or a different name."
                  : "Find actions, sessions, messages, and files in one place."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          grouped.map((group) => {
            const Icon = GROUP_ICONS[group.group]
            return (
              <section key={group.group} aria-label={group.group} className="mb-3">
                <h3 className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {group.group}
                </h3>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((entry) => {
                    const index = indexByEntry.get(entry) ?? 0
                    return (
                      <li key={entry.id}>
                        <Button
                          type="button"
                          variant={index === activeIndex ? "secondary" : "ghost"}
                          data-command-index={index}
                          onClick={() => choose(entry)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            "h-auto min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2 py-1.5 text-start font-normal"
                          )}
                        >
                          <span className="flex w-full min-w-0 items-center gap-2">
                            <Icon
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-medium">
                              {entry.label}
                            </span>
                            {entry.archived ? (
                              <Badge variant="outline">Archived</Badge>
                            ) : null}
                            <ArrowRightIcon
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                          </span>
                          <span
                            dir="auto"
                            className="line-clamp-2 w-full ps-6 text-[11px] text-muted-foreground"
                          >
                            {entry.detail}
                          </span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
