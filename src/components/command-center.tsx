import { useEffect, useMemo, useRef, useState } from "react"
import { SearchIcon } from "lucide-react"

import { projectName } from "@/components/project-select"
import { SettingsDialog } from "@/components/settings-dialog"
import { IntegrationCommandDialogs } from "@/components/integration-command-dialogs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import type { OpenCodeController } from "@/lib/use-opencode"
import { isCommandShortcut, isComposerFocusShortcut } from "@/lib/command-center-shortcuts"
export { isCommandShortcut, isComposerFocusShortcut } from "@/lib/command-center-shortcuts"

type Entry = { id: string; label: string; detail: string; run: () => void }

export function matchesCommand(
  entry: Pick<Entry, "label" | "detail">,
  query: string
) {
  const text = `${entry.label} ${entry.detail}`.toLocaleLowerCase()
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
}

export function CommandCenter({
  nav,
  closeNotes,
  focusComposer,
  openModelSettings,
}: {
  nav: OpenCodeController
  closeNotes: () => void
  focusComposer: () => void
  openModelSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [worktreesOpen, setWorktreesOpen] = useState(false)
  const [actionResult, setActionResult] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<(() => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null
      const blocked =
        open ||
        settingsOpen ||
        Boolean(
          target?.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm, [role="textbox"]'
          )
        ) ||
        Boolean(
          document.querySelector(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], dialog[open]'
          )
        )
      if (isCommandShortcut(event, blocked)) {
        event.preventDefault()
        setQuery("")
        setOpen(true)
      } else if (nav.activeSession && isComposerFocusShortcut(event, blocked)) {
        event.preventDefault()
        focusComposer()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, settingsOpen, nav.activeSession, focusComposer])

  const entries = useMemo<Entry[]>(
    () => [
      {
        id: "settings",
        label: "Open settings",
        detail: "Actions",
        run: () => setSettingsOpen(true),
      },
      {
        id: "refresh-sessions",
        label: "Refresh sessions",
        detail: "Actions",
        run: nav.refreshSessions,
      },
      ...(nav.activeSession?.projectID || nav.location?.project.id ? [{
        id: "worktrees",
        label: "Manage project worktrees",
        detail: nav.activeSession ? "Active session's project · isolation and existing worktrees" : "Selected project · isolation and existing worktrees",
        run: () => setWorktreesOpen(true),
      }] : []),
      {
        id: "all",
        label: "All projects",
        detail: "Projects",
        run: () => {
          closeNotes()
          nav.selectAllProjects()
        },
      },
      ...(nav.activeSession
        ? [{ id: "model-settings", label: "Open model settings", detail: "Session · agent, model and thinking", run: openModelSettings }, ...(["files", "changes"] as const).map((tab) => ({
            id: `inspector:${tab}`,
            label: tab === "files" ? "Open files" : "Open working tree",
            detail: "Session inspector",
            run: () => {
              closeNotes()
              nav.openInspector(tab)
            },
          }))]
        : []),
      ...nav.projects.map((project) => ({
        id: `project:${project.id}`,
        label: projectName(project),
        detail: `Project · ${project.canonical || project.id}`,
        run: () => {
          closeNotes()
          void nav.selectProject(project.id)
        },
      })),
      ...nav.sessions.map((session) => ({
        id: `session:${session.id}`,
        label: session.title?.trim() || "Untitled session",
        detail: `Session · ${projectName(nav.projects.find((project) => project.id === session.projectID) ?? { id: session.projectID, canonical: session.location?.directory, name: undefined })}`,
        run: () => {
          closeNotes()
          nav.selectSession(session.id)
        },
      })),
    ],
    [nav, closeNotes, openModelSettings]
  )
  const results = entries.filter((entry) => matchesCommand(entry, query))

  function choose(entry: Entry) {
    setPending(() => entry.run)
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-11 shrink-0"
        aria-label="Open command center"
        onClick={() => {
          setQuery("")
          setOpen(true)
        }}
      >
        <SearchIcon aria-hidden="true" className="size-5" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setPending(null)
            pending?.()
          }
        }}
      >
        <ResponsiveDialogContent
          className="flex max-h-[min(36rem,85vh)] flex-col gap-3 sm:max-w-lg"
          initialFocus={inputRef}
        >
          <DialogTitle>Command center</DialogTitle>
          <DialogDescription>
            Search loaded sessions and projects, or open an action. Ctrl or ⌘ K
            opens this when outside an input. Alt+Shift+C focuses the composer
            when a session is selected and no input or dialog is active.
          </DialogDescription>
          <Input
            ref={inputRef}
            aria-label="Search command center"
            placeholder="Search sessions, projects, and actions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === "ArrowDown") {
                event.preventDefault()
                listRef.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus()
              }
              if (event.key === "Enter" && results[0]) {
                event.preventDefault()
                choose(results[0])
              }
            }}
          />
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto"
            aria-label="Command results"
          >
            {results.length ? (
              results.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="flex min-h-11 w-full flex-col items-start justify-center rounded-md px-3 py-2 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => choose(entry)}
                >
                  <span className="w-full truncate font-medium" dir="auto">
                    {entry.label}
                  </span>
                  <span
                    className="w-full truncate text-xs text-muted-foreground"
                    dir="auto"
                  >
                    {entry.detail}
                  </span>
                </button>
              ))
            ) : (
              <p
                role="status"
                className="px-3 py-4 text-sm text-muted-foreground"
              >
                No matching loaded items.
              </p>
            )}
          </div>
        </ResponsiveDialogContent>
      </Dialog>
      <SettingsDialog
        nav={nav}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <IntegrationCommandDialogs kind={worktreesOpen ? "worktrees" : null} nav={nav} onClose={() => setWorktreesOpen(false)} onResult={(message) => setActionResult(message)} />
      {actionResult ? <p role="status" className="sr-only">{actionResult}</p> : null}
    </>
  )
}
