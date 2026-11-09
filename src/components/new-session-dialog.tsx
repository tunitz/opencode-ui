import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import { useEffect, useMemo, useState } from "react"
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, LoaderCircleIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { resolveNewSessionDefaults } from "@/lib/new-session-defaults"
import { newSessionProjectError } from "@/lib/new-session-target"
import { useTargetCatalog } from "@/lib/use-target-catalog"
import { openCode } from "@/lib/opencode"
import { childDirectory, directoryEntryName, parentDirectory } from "@/lib/directory-picker"
import { DEFAULT_SESSION_DIRECTORY, type OpenCodeController } from "@/lib/use-opencode"

const CREATE_REASON_ID = "new-session-create-reason"

type FolderState = "checking" | "available" | "unavailable"

type FolderProbe = { directory: string; available: boolean }
type DirectoryListing = { directory: string; entries: string[]; error: boolean }

function sourceLabel(source: string): string {
  if (source === "agent") return "agent config"
  if (source === "fallback") return "safe fallback"
  return "default"
}

export type NewSessionButtonProps = {
  nav: OpenCodeController
  onCreated?: () => void
}

export type NewSessionDialogProps = {
  nav: OpenCodeController
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDirectory?: string
  expectedProjectID?: string
  onCreated?: () => void
}

export function NewSessionDialog({
  nav,
  open,
  onOpenChange,
  initialDirectory = DEFAULT_SESSION_DIRECTORY,
  expectedProjectID,
  onCreated,
}: NewSessionDialogProps) {
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [probe, setProbe] = useState<FolderProbe | null>(null)
  const [directory, setDirectory] = useState(initialDirectory)
  const [listing, setListing] = useState<DirectoryListing | null>(null)

  const { createSession } = nav
  const targetCatalog = useTargetCatalog(open ? directory : null)

  const resolution = useMemo(() => {
    if (!selectedID) return null
    if (targetCatalog.status !== "ready") return null
    return resolveNewSessionDefaults({
      agents: targetCatalog.agents,
      models: targetCatalog.models,
      configEntries: nav.configEntries,
    })
  }, [selectedID, targetCatalog.agents, targetCatalog.models, targetCatalog.status, nav.configEntries])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    void openCode.location.get({ location: { directory } }).then((location) => {
      if (!cancelled) {
        setSelectedID(location.project.id)
        setProbe({ directory, available: true })
      }
    }).catch(() => {
      if (!cancelled) setProbe({ directory, available: false })
    })

    void openCode.file.list({ location: { directory } }).then((result) => {
      if (!cancelled) {
        const entries = result.data
          .filter((entry) => entry.type === "directory")
          .map((entry) => directoryEntryName(entry.path))
          .filter((path): path is string => path !== null && !path.startsWith("."))
          .sort((a, b) => a.localeCompare(b))
        setListing({ directory, entries, error: false })
      }
    }).catch(() => {
      if (!cancelled) setListing({ directory, entries: [], error: true })
    })

    return () => {
      cancelled = true
    }
  }, [open, directory])

  const folder: FolderState =
    !probe || probe.directory !== directory
      ? "checking"
      : probe.available ? "available" : "unavailable"

  const projectError = newSessionProjectError(selectedID, expectedProjectID)

  const reason =
    nav.connection !== "connected"
      ? "Not connected. Reconnect to create a session."
      : folder === "checking"
        ? "Checking session folder…"
        : folder === "unavailable"
          ? "Selected session folder unavailable."
          : projectError
            ? projectError
            : targetCatalog.status === "loading"
              ? "Loading the project’s Agent and Model catalog…"
              : targetCatalog.status === "error"
                ? "The project catalog could not be loaded."
                : resolution?.error
                  ? resolution.error
                  : null

  const canCreate =
    nav.connection === "connected" &&
    Boolean(selectedID) &&
    !projectError &&
    folder === "available" &&
    targetCatalog.status === "ready" &&
    Boolean(resolution?.model) &&
    !resolution?.error &&
    !nav.creating

  async function handleCreate() {
    if (!canCreate || !selectedID || !resolution?.model) {
      return
    }

    const created = await createSession(
      selectedID,
      { agentID: resolution.agentID, model: resolution.model },
      directory
    )

    if (!created) {
      return
    }

    onOpenChange(false)
    onCreated?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent forceRenderBackdrop showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto p-5">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            New session
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Session folder</p>
            <div className="mt-1 flex items-start gap-2">
              <FolderOpenIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p dir="ltr" className="min-w-0 font-mono text-xs break-all">{directory}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">An existing folder shares its files with other sessions using it. Choose a separate worktree folder for isolated file changes; worktrees still share machine resources such as network ports.</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Browse folders</p>
            <Button
              variant="outline"
              className="h-11 px-3"
              disabled={directory === "/" || nav.creating}
              onClick={() => setDirectory(parentDirectory(directory))}
            >
              ↑ Parent folder
            </Button>
          </div>
          <div aria-label="Folders in current directory" className="max-h-60 overflow-y-auto rounded-md border">
            {!listing || listing.directory !== directory ? (
              <p role="status" className="p-3 text-xs">Loading folders…</p>
            ) : listing.error ? (
              <p role="alert" className="p-3 text-xs text-destructive">Unable to list folders.</p>
            ) : listing.entries.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No visible subfolders.</p>
            ) : listing.entries.map((entry) => (
              <button
                key={entry}
                type="button"
                disabled={nav.creating}
                className="flex min-h-11 w-full items-center gap-3 border-b px-3 text-start text-sm last:border-b-0 hover:bg-accent focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                onClick={() => {
                  const child = childDirectory(directory, entry)
                  if (child) setDirectory(child)
                }}
              >
                <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-all">{entry}</span>
                <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
              </button>
            ))}
          </div>
          {resolution?.model ? (
            <div
              role="group"
              aria-label="New session defaults"
              className="space-y-0.5 text-[11px] leading-5 break-words text-muted-foreground"
            >
              <p>
                Agent: {resolution.agentID ?? "Backend default"}
              </p>
              <p dir="ltr">
                Model: {resolution.model.providerID}/{resolution.model.id}
                {` · ${sourceLabel(resolution.modelSource)}`}
              </p>
              <p>
                Thinking: {resolution.model.variant ?? "Default"}
              </p>
            </div>
          ) : null}
        </div>
        {reason ? (
          <p
            id={CREATE_REASON_ID}
            role={folder === "checking" ? "status" : undefined}
            className={
              folder === "unavailable" ||
              Boolean(projectError) ||
              targetCatalog.status === "error" ||
              Boolean(resolution?.error)
                ? "text-xs break-words text-destructive"
                : "text-xs break-words text-muted-foreground"
            }
          >
            {reason}
          </p>
        ) : null}
        {nav.createError ? (
          <p role="alert" className="text-xs break-words text-destructive">
            {nav.createError}
          </p>
        ) : null}
        <DialogFooter className="mt-0 flex-row justify-end gap-2">
          <DialogClose
            render={<Button variant="outline" className="h-11 px-4" />}
            disabled={nav.creating}
          >
            Cancel
          </DialogClose>
          <Button
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            aria-busy={nav.creating}
            aria-describedby={reason ? CREATE_REASON_ID : undefined}
            className="h-11 px-4"
          >
            {nav.creating ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : null}
            Create session
          </Button>
        </DialogFooter>
      </ResponsiveDialogContent>
    </Dialog>
  )
}

export function NewSessionButton({ nav, onCreated }: NewSessionButtonProps) {
  const [open, setOpen] = useState(false)
  const [sessionKey, setSessionKey] = useState(0)

  function handleOpen() {
    setSessionKey((current) => current + 1)
    setOpen(true)
  }

  return (
    <>
      <Button
        variant="ghost"
        onClick={handleOpen}
        disabled={nav.connection !== "connected"}
        className="h-11 w-full justify-start gap-2 rounded-lg border-0 px-2.5 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        New session
      </Button>
      <NewSessionDialog
        key={sessionKey}
        nav={nav}
        open={open}
        onOpenChange={setOpen}
        initialDirectory={DEFAULT_SESSION_DIRECTORY}
        onCreated={onCreated}
      />
    </>
  )
}
