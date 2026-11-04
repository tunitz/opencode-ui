import { useEffect, useMemo, useState } from "react"
import { NotebookPenIcon } from "lucide-react"
import {
  NotesPanel,
  type NotesAdapter,
  type NotesNote,
  type NotesSpace,
} from "@/components/notes-panel"
import { projectName } from "@/components/project-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import { openCode } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

type PluginNote = {
  id: string
  title: string
  body: string
  status: NotesNote["status"]
  pinned: boolean
  spaceID: string | null
  revision?: number
}
type PluginSpace = {
  id: string
  name: string
  project: { id: string } | null
  revision?: number
}

/** Optional client: the plugin remains the only source of notes data. */
export function NotesSidebar({ nav }: { nav: OpenCodeController }) {
  const directory = nav.activeSession?.location.directory ?? nav.directory
  const [availableDirectory, setAvailableDirectory] = useState<string | null>(
    null
  )
  const [open, setOpen] = useState(false)
  const [editingDirectory, setEditingDirectory] = useState<string | null>(null)

  useEffect(() => {
    if (!directory || nav.connection !== "connected") return
    let active = true
    void openCode.plugin.list({ location: { directory } }).then(
      (result) => {
        if (active)
          setAvailableDirectory(
            result.data.some(
              (plugin) =>
                plugin.id === "opencode-notes" &&
                plugin.state.status === "active"
            )
              ? directory
              : null
          )
      },
      () => {
        if (active) setAvailableDirectory(null)
      }
    )
    return () => {
      active = false
    }
  }, [directory, nav.connection, nav.streamStatus])

  const adapter = useMemo<NotesAdapter>(() => {
    const location = { directory: editingDirectory ?? directory }
    const spaceProjects = new Map<string, string | null>()
    let changeCounter = 0
    const call = async (
      method: string,
      input: Record<string, string | number | boolean | null | { id: string }>
    ) => {
      const result = await openCode.rpc.call({
        rpcID: "opencode-notes",
        method,
        input,
        location,
      })
      return result.output
    }
    return {
      async list() {
        const started = changeCounter
        const [spacesResult, first] = await Promise.all([
          call("spaces", {}) as Promise<{ spaces: PluginSpace[] }>,
          call("list", { limit: 1000, offset: 0 }) as Promise<{
            notes: PluginNote[]
            total: number
          }>,
        ])
        const notes = [...first.notes]
        while (notes.length < first.total) {
          const page = (await call("list", {
            limit: 1000,
            offset: notes.length,
          })) as { notes: PluginNote[]; total: number }
          if (!page.notes.length)
            throw new Error(
              "The complete notes list could not be loaded. Refresh and try again."
            )
          notes.push(...page.notes)
        }
        if (
          changeCounter !== started ||
          new Set(notes.map((note) => note.id)).size !== notes.length
        ) {
          throw new Error("Notes changed while loading. Refresh to try again.")
        }
        if (
          notes.some((note) => typeof note.revision !== "number") ||
          spacesResult.spaces.some(
            (space) => typeof space.revision !== "number"
          )
        ) {
          throw new Error(
            "This notes plugin version does not support safe editing. Update the plugin."
          )
        }
        for (const space of spacesResult.spaces)
          spaceProjects.set(space.id, space.project?.id ?? null)
        return {
          notes: notes.map((note) => ({ ...note, content: note.body })),
          spaces: spacesResult.spaces.map((space): NotesSpace => ({
            id: space.id,
            name: space.name,
            projectID: space.project?.id ?? null,
            revision: space.revision,
          })),
          projects: nav.projects.map((project) => ({
            id: project.id,
            name: projectName(project),
          })),
        }
      },
      createNote: (input) =>
        call("create", {
          title: input.title,
          body: input.content,
          status: input.status,
          pinned: input.pinned,
          spaceID: input.spaceID,
        }),
      updateNote: (noteID, input, revision) =>
        call("update", {
          noteID,
          title: input.title,
          body: input.content,
          status: input.status,
          pinned: input.pinned,
          spaceID: input.spaceID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        }),
      deleteNote: (noteID, revision) =>
        call("delete", {
          noteID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        }),
      createSpace: (input) =>
        call("createSpace", {
          name: input.name,
          kind: "planning",
          project: input.projectID ? { id: input.projectID } : null,
        }),
      updateSpace: (spaceID, input, revision) => {
        if (!spaceProjects.has(spaceID))
          return Promise.reject(
            new Error("Refresh the space before editing it.")
          )
        return call("updateSpace", {
          spaceID,
          name: input.name,
          ...(spaceProjects.get(spaceID) !== input.projectID
            ? { project: input.projectID ? { id: input.projectID } : null }
            : {}),
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        })
      },
      deleteSpace: (spaceID, revision) =>
        call("deleteSpace", {
          spaceID,
          ...(typeof revision === "number"
            ? { expectedRevision: revision }
            : {}),
        }),
      subscribe(onChange) {
        const controller = new AbortController()
        void (async () => {
          try {
            for await (const event of openCode.event.subscribe({
              signal: controller.signal,
            })) {
              if (
                event.type === "rpc.opencode-notes.changed" ||
                event.type === "server.connected"
              ) {
                changeCounter++
                onChange()
              }
            }
          } catch {
            /* The next connection refresh reloads the snapshot. */
          }
        })()
        return () => controller.abort()
      },
    }
  }, [directory, editingDirectory, nav.projects])

  if (
    !open &&
    (!directory ||
      availableDirectory !== directory ||
      nav.connection !== "connected")
  )
    return null
  return (
    <>
      <Button
        variant="ghost"
        className="h-11 w-full justify-start gap-2"
        onClick={() => {
          setEditingDirectory(directory)
          setOpen(true)
        }}
      >
        <NotebookPenIcon aria-hidden="true" /> Notes &amp; plans
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Notes &amp; plans</DialogTitle>
            <DialogDescription>
              Manage your saved notes and project plans.
            </DialogDescription>
          </DialogHeader>
          {nav.connection !== "connected" && (
            <p role="status">
              Connection unavailable. Your open draft is retained; reconnect
              before saving.
            </p>
          )}
          {directory !== editingDirectory && (
            <p role="status">
              This editor remains connected to the project where it was opened.
            </p>
          )}
          {open && (
            <NotesPanel adapter={adapter} refreshKey={nav.streamStatus} />
          )}
        </ResponsiveDialogContent>
      </Dialog>
    </>
  )
}
