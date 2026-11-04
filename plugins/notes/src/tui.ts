import type { Plugin } from "@opencode/plugin/tui"
import { NOTES_RPC } from "./rpc.js"
import {
  NOTE_STATUSES,
  SPACE_KINDS,
  type CreateNoteInput,
  type CreateSpaceInput,
  type DeleteNoteInput,
  type DeleteSpaceInput,
  type ListInput,
  type ListOutput,
  type Note,
  type NoteStatus,
  type ProjectLink,
  type Space,
  type SpaceKind,
  type SpacesInput,
  type SpacesOutput,
  type UpdateNoteInput,
  type UpdateSpaceInput,
} from "./types.js"

type TuiContext = Parameters<Plugin.Definition["setup"]>[0]

interface NotesClient {
  list(input?: ListInput): Promise<ListOutput>
  create(input: CreateNoteInput): Promise<{ note: Note }>
  update(input: UpdateNoteInput): Promise<{ note: Note }>
  delete(input: DeleteNoteInput): Promise<{ deleted: boolean }>
  spaces(input?: SpacesInput): Promise<SpacesOutput>
  createSpace(input: CreateSpaceInput): Promise<{ space: Space }>
  updateSpace(input: UpdateSpaceInput): Promise<{ space: Space }>
  deleteSpace(
    input: DeleteSpaceInput
  ): Promise<{ deleted: boolean; deletedNotes: number }>
}

function client(context: TuiContext): NotesClient {
  return context.client.rpc(NOTES_RPC) as unknown as NotesClient
}

function currentProject(context: TuiContext): ProjectLink | undefined {
  const directory = context.location?.directory
  if (!directory) return undefined
  const match = context.data.project
    .list()
    .find(
      (project) =>
        project.canonical === directory ||
        directory.startsWith(`${project.canonical.replace(/\/+$/, "")}/`)
    )
  if (!match) return undefined
  return {
    id: match.id,
    directory: match.canonical,
    canonical: match.canonical,
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusTitle(status: NoteStatus): string {
  if (status === "in-progress") return "in progress"
  return status
}

function noteTitle(note: Note): string {
  return `${note.pinned ? "★ " : ""}${note.title}`
}

const NOTE_PAGE_SIZE = 500
const MAX_NOTE_PAGES = 200

interface LoadedNotes {
  readonly notes: readonly Note[]
  readonly total: number
  readonly truncated: boolean
}

async function loadAllNotes(notes: NotesClient): Promise<LoadedNotes> {
  const loaded: Note[] = []
  const seen = new Set<string>()
  let offset = 0
  let total: number | undefined
  let pages = 0
  for (;;) {
    const page = await notes.list({ limit: NOTE_PAGE_SIZE, offset })
    total = page.total
    let added = 0
    for (const note of page.notes) {
      if (seen.has(note.id)) continue
      seen.add(note.id)
      loaded.push(note)
      added++
    }
    pages++
    if (page.notes.length === 0) break
    if (loaded.length >= page.total) break
    // A short page is the end of the current result set. A concurrent change
    // can make the snapshot imperfect; unique-note pagination, deduplication,
    // and a bounded loop keep the picker safe without claiming a transaction.
    if (page.notes.length < NOTE_PAGE_SIZE) break
    if (pages >= MAX_NOTE_PAGES) {
      return { notes: loaded, total, truncated: true }
    }
    // Advance by unique notes so a duplicated row cannot make us skip one.
    offset = added > 0 ? loaded.length : offset + page.notes.length
  }
  return {
    notes: loaded,
    total: total ?? loaded.length,
    truncated: total !== undefined && loaded.length < total,
  }
}

type SpaceChoice =
  { readonly type: "none" } | { readonly type: "space"; readonly space: Space }
type ProjectChoice =
  | { readonly type: "none" }
  | { readonly type: "project"; readonly project: ProjectLink }

function sameProjectLink(
  left: ProjectLink | null,
  right: ProjectLink | null
): boolean {
  if (left === null || right === null) return left === right
  return (
    left.id === right.id &&
    left.directory === right.directory &&
    left.canonical === right.canonical
  )
}

interface PickSpaceOptions {
  readonly includeNone?: boolean
  readonly currentSpaceID?: string | null
}

async function pickSpace(
  context: TuiContext,
  title = "Space",
  options: PickSpaceOptions = {}
): Promise<Space | null | undefined> {
  const result = await client(context).spaces({})
  const choices: Array<{
    title: string
    value: SpaceChoice
    description?: string
    category?: string
  }> = []
  if (options.includeNone !== false) {
    choices.push({
      title: "No space",
      value: { type: "none" },
      description: "Leave the note unassigned",
    })
  }
  for (const space of result.spaces) {
    choices.push({
      title: `${space.pinned ? "★ " : ""}${space.name}`,
      value: { type: "space", space },
      description: `${space.kind}${space.project ? ` · ${space.project.canonical ?? space.project.id}` : " · unlinked"}`,
    })
  }
  if (choices.length === 0) {
    context.ui.toast.show({
      message: "No note spaces yet. Create one first.",
      variant: "warning",
    })
    return undefined
  }
  const currentSpaceID = options.currentSpaceID
  const current =
    currentSpaceID === null
      ? choices.find((choice) => choice.value.type === "none")
      : currentSpaceID
        ? choices.find(
            (choice) =>
              choice.value.type === "space" &&
              choice.value.space.id === currentSpaceID
          )
        : undefined
  const selected = await context.ui.dialog.select<SpaceChoice>({
    title,
    current: current?.value,
    options: choices,
  })
  if (!selected) return undefined
  return selected.type === "none" ? null : selected.space
}

async function pickProject(
  context: TuiContext,
  current: ProjectLink | null
): Promise<ProjectLink | null | undefined> {
  const currentLink = currentProject(context)
  const choices: Array<{
    title: string
    value: ProjectChoice
    description?: string
    category?: string
  }> = [
    {
      title: "Not linked to a project",
      value: { type: "none" },
      description: "Unlinked space",
    },
  ]
  for (const project of context.data.project.list()) {
    const link: ProjectLink = {
      id: project.id,
      directory: project.canonical,
      canonical: project.canonical,
    }
    choices.push({
      title: project.name ?? project.canonical,
      value: { type: "project", project: link },
      description: project.canonical,
      category: currentLink?.id === project.id ? "Current project" : "Projects",
    })
  }
  const currentChoice =
    current === null
      ? choices[0]
      : choices.find(
          (choice) =>
            choice.value.type === "project" &&
            sameProjectLink(choice.value.project, current)
        )
  const selected = await context.ui.dialog.select<ProjectChoice>({
    title: "Project link",
    current: currentChoice?.value,
    options: choices,
  })
  if (!selected) return undefined
  return selected.type === "none" ? null : selected.project
}

async function pickNote(context: TuiContext): Promise<Note | undefined> {
  const notes = client(context)
  // All-notes view: no projectID filter, so unlinked and unassigned notes stay
  // visible. Walk every page instead of silently stopping at the first 500.
  const [result, spaces] = await Promise.all([
    loadAllNotes(notes),
    notes.spaces({}),
  ])
  if (result.notes.length === 0) {
    context.ui.toast.show({ message: "No notes found.", variant: "info" })
    return undefined
  }
  if (result.truncated) {
    context.ui.toast.show({
      message: `Showing the first ${result.notes.length} of ${result.total} notes. Rerun after narrowing or removing notes.`,
      variant: "warning",
    })
  }
  const spaceName = new Map(
    spaces.spaces.map((space) => [space.id, space.name])
  )
  const title = result.truncated
    ? `All notes (${result.notes.length} of ${result.total})`
    : `All notes (${result.notes.length})`
  return context.ui.dialog.select<Note>({
    title,
    options: result.notes.map((note) => ({
      title: noteTitle(note),
      value: note,
      description: `${statusTitle(note.status)} · ${note.spaceID === null ? "unassigned" : (spaceName.get(note.spaceID) ?? "unknown space")}`,
      footer: note.body.slice(0, 80).replaceAll("\n", " "),
    })),
  })
}

async function listNotes(context: TuiContext): Promise<void> {
  const note = await pickNote(context)
  if (!note) return
  const spaces = await client(context).spaces({})
  const space =
    note.spaceID === null
      ? undefined
      : spaces.spaces.find((candidate) => candidate.id === note.spaceID)
  await context.ui.dialog.alert({
    title: noteTitle(note),
    message: [
      `Status: ${statusTitle(note.status)}`,
      `Space: ${space?.name ?? (note.spaceID === null ? "unassigned" : "unknown")}`,
      `Revision: ${note.revision}`,
      `Updated: ${new Date(note.updatedAt).toISOString()}`,
      "",
      note.body || "(no body)",
    ].join("\n"),
  })
}

async function createNote(context: TuiContext): Promise<void> {
  const title = await context.ui.dialog.prompt({
    title: "New note title",
    placeholder: "Title",
  })
  if (!title?.trim()) return
  const space = await pickSpace(context, "Note space")
  if (space === undefined) return
  const body = await context.ui.dialog.prompt({
    title: "Note body",
    description: "Optional. Markdown is stored as plain text.",
    placeholder: "Notes…",
  })
  if (body === undefined) return
  const status = await context.ui.dialog.select<NoteStatus>({
    title: "Status",
    current: "todo",
    options: NOTE_STATUSES.map((value) => ({
      title: statusTitle(value),
      value,
    })),
  })
  if (status === undefined) return
  const result = await client(context).create({
    spaceID: space?.id ?? null,
    title: title.trim(),
    body,
    status,
  })
  context.ui.toast.show({
    title: "Note created",
    message: result.note.title,
    variant: "success",
  })
}

async function updateNote(context: TuiContext): Promise<void> {
  const note = await pickNote(context)
  if (!note) return
  const notes = client(context)
  const title = await context.ui.dialog.prompt({
    title: "Note title",
    value: note.title,
    placeholder: "Title",
  })
  if (title === undefined) return
  const nextTitle = title.trim()
  if (!nextTitle) {
    context.ui.toast.show({
      message: "Note title cannot be empty.",
      variant: "warning",
    })
    return
  }
  const body = await context.ui.dialog.prompt({
    title: "Note body",
    description: "Cancel to keep the current body.",
    value: note.body,
    placeholder: "Notes…",
  })
  const status = await context.ui.dialog.select<NoteStatus>({
    title: "Status",
    current: note.status,
    options: NOTE_STATUSES.map((value) => ({
      title: statusTitle(value),
      value,
    })),
  })
  const pin = await context.ui.dialog.select<boolean>({
    title: "Pin state",
    current: note.pinned,
    options: [
      { title: "Pinned", value: true },
      { title: "Not pinned", value: false },
    ],
  })
  const patch = {
    noteID: note.id,
    expectedRevision: note.revision,
    ...(nextTitle !== note.title ? { title: nextTitle } : {}),
    ...(body !== undefined && body !== note.body ? { body } : {}),
    ...(status !== undefined && status !== note.status ? { status } : {}),
    ...(pin !== undefined && pin !== note.pinned ? { pinned: pin } : {}),
  }
  if (Object.keys(patch).length === 2) {
    context.ui.toast.show({ message: "No note changes.", variant: "info" })
    return
  }
  const result = await notes.update(patch)
  context.ui.toast.show({
    title: "Note updated",
    message: result.note.title,
    variant: "success",
  })
}

async function deleteNote(context: TuiContext): Promise<void> {
  const note = await pickNote(context)
  if (!note) return
  const confirmed = await context.ui.dialog.confirm({
    title: "Delete note?",
    message: note.title,
    label: { confirm: "Delete", cancel: "Cancel" },
  })
  if (!confirmed) return
  const result = await client(context).delete({
    noteID: note.id,
    expectedRevision: note.revision,
  })
  context.ui.toast.show({
    message: result.deleted ? `Deleted ${note.title}` : "Note was already gone",
    variant: result.deleted ? "success" : "info",
  })
}

async function moveNote(context: TuiContext): Promise<void> {
  const note = await pickNote(context)
  if (!note) return
  const target = await pickSpace(context, "Move note to", {
    includeNone: true,
    currentSpaceID: note.spaceID,
  })
  if (target === undefined) return
  const targetSpaceID = target?.id ?? null
  if (targetSpaceID === note.spaceID) {
    context.ui.toast.show({
      message: "Note is already there.",
      variant: "info",
    })
    return
  }
  const result = await client(context).update({
    noteID: note.id,
    spaceID: targetSpaceID,
    expectedRevision: note.revision,
  })
  context.ui.toast.show({
    title: "Note moved",
    message: result.note.spaceID === null ? "Unassigned" : "Updated space",
    variant: "success",
  })
}

async function listSpaces(context: TuiContext): Promise<void> {
  const result = await client(context).spaces({})
  if (result.spaces.length === 0) {
    context.ui.toast.show({ message: "No note spaces yet.", variant: "info" })
    return
  }
  const space = await context.ui.dialog.select<Space>({
    title: `Note spaces (${result.total})`,
    options: result.spaces.map((candidate) => ({
      title: `${candidate.pinned ? "★ " : ""}${candidate.name}`,
      value: candidate,
      description: `${candidate.kind}${candidate.project ? ` · ${candidate.project.canonical ?? candidate.project.id}` : " · unlinked"}`,
    })),
  })
  if (!space) return
  await context.ui.dialog.alert({
    title: space.name,
    message: [
      `Kind: ${space.kind}`,
      `Project: ${space.project?.canonical ?? space.project?.id ?? "none"}`,
      `Pinned: ${space.pinned ? "yes" : "no"}`,
      `Revision: ${space.revision}`,
      `ID: ${space.id}`,
    ].join("\n"),
  })
}

async function createSpace(context: TuiContext): Promise<void> {
  const name = await context.ui.dialog.prompt({
    title: "New space name",
    placeholder: "Name",
  })
  if (name === undefined) return
  const nextName = name.trim()
  if (!nextName) {
    context.ui.toast.show({
      message: "Space name cannot be empty.",
      variant: "warning",
    })
    return
  }
  const kind = await context.ui.dialog.select<SpaceKind>({
    title: "Space kind",
    current: "global",
    options: SPACE_KINDS.map((value) => ({
      title: value,
      value,
      description:
        value === "global"
          ? "Shared across projects"
          : "Project planning, usually linked",
    })),
  })
  if (kind === undefined) return
  const project = await pickProject(
    context,
    kind === "planning" ? (currentProject(context) ?? null) : null
  )
  if (project === undefined) return
  const pinned = await context.ui.dialog.select<boolean>({
    title: "Pin space",
    current: false,
    options: [
      { title: "Pinned", value: true },
      { title: "Not pinned", value: false },
    ],
  })
  if (pinned === undefined) return
  const result = await client(context).createSpace({
    name: nextName,
    kind,
    project,
    pinned,
  })
  context.ui.toast.show({
    title: "Space created",
    message: result.space.name,
    variant: "success",
  })
}

async function editSpace(context: TuiContext): Promise<void> {
  const space = await pickSpace(context, "Edit space", { includeNone: false })
  if (!space) return
  const name = await context.ui.dialog.prompt({
    title: "Space name",
    value: space.name,
    placeholder: "Name",
  })
  if (name === undefined) return
  const nextName = name.trim()
  if (!nextName) {
    context.ui.toast.show({
      message: "Space name cannot be empty.",
      variant: "warning",
    })
    return
  }
  const kind = await context.ui.dialog.select<SpaceKind>({
    title: "Space kind",
    current: space.kind,
    options: SPACE_KINDS.map((value) => ({
      title: value,
      value,
      description:
        value === "global"
          ? "Shared across projects"
          : "Project planning, usually linked",
    })),
  })
  const project = await pickProject(context, space.project)
  const pinned = await context.ui.dialog.select<boolean>({
    title: "Pin space",
    current: space.pinned,
    options: [
      { title: "Pinned", value: true },
      { title: "Not pinned", value: false },
    ],
  })
  const patch = {
    spaceID: space.id,
    expectedRevision: space.revision,
    ...(nextName !== space.name ? { name: nextName } : {}),
    ...(kind !== undefined && kind !== space.kind ? { kind } : {}),
    ...(project !== undefined && !sameProjectLink(project, space.project)
      ? { project }
      : {}),
    ...(pinned !== undefined && pinned !== space.pinned ? { pinned } : {}),
  }
  if (Object.keys(patch).length === 2) {
    context.ui.toast.show({ message: "No space changes.", variant: "info" })
    return
  }
  const result = await client(context).updateSpace(patch)
  context.ui.toast.show({
    title: "Space updated",
    message: result.space.name,
    variant: "success",
  })
}

async function deleteSpace(context: TuiContext): Promise<void> {
  const space = await pickSpace(context, "Delete space", {
    includeNone: false,
  })
  if (!space) return
  const noteCount = (
    await client(context).list({ spaceID: space.id, limit: 1 })
  ).total
  if (noteCount > 0) {
    await context.ui.dialog.alert({
      title: "Space not empty",
      message: `${space.name} still has ${noteCount} note(s). Delete those notes first, then delete the space.`,
    })
    return
  }
  const confirmed = await context.ui.dialog.confirm({
    title: "Delete space?",
    message: `Delete ${space.name}?`,
    label: { confirm: "Delete", cancel: "Cancel" },
  })
  if (!confirmed) return
  const result = await client(context).deleteSpace({
    spaceID: space.id,
    expectedRevision: space.revision,
  })
  context.ui.toast.show({
    message: result.deleted
      ? `Deleted ${space.name}`
      : "Space was already gone",
    variant: result.deleted ? "success" : "info",
  })
}

function guard(
  context: TuiContext,
  action: () => Promise<void>
): () => Promise<void> {
  return async () => {
    try {
      await action()
    } catch (error) {
      context.ui.toast.show({
        title: "Notes error",
        message: message(error),
        variant: "error",
      })
    }
  }
}

export function setupNotesTui(context: TuiContext): void {
  context.keymap.layer(() => ({
    mode: "global",
    priority: 10,
    commands: [
      {
        id: "notes.list",
        title: "Notes: list",
        description:
          "Browse all notes, including unlinked and unassigned notes",
        group: "Notes",
        palette: true,
        slash: { name: "notes" },
        run: guard(context, () => listNotes(context)),
      },
      {
        id: "notes.create",
        title: "Notes: create",
        description: "Create an assigned or unassigned note",
        group: "Notes",
        palette: true,
        slash: { name: "note-new" },
        run: guard(context, () => createNote(context)),
      },
      {
        id: "notes.update",
        title: "Notes: edit",
        description: "Change a note's title, body, status, or pin",
        group: "Notes",
        palette: true,
        slash: { name: "note-edit" },
        run: guard(context, () => updateNote(context)),
      },
      {
        id: "notes.delete",
        title: "Notes: delete",
        description: "Delete a note after confirmation",
        group: "Notes",
        palette: true,
        slash: { name: "note-delete" },
        run: guard(context, () => deleteNote(context)),
      },
      {
        id: "notes.move",
        title: "Notes: move",
        description: "Move a note to another space or make it unassigned",
        group: "Notes",
        palette: true,
        slash: { name: "note-move" },
        run: guard(context, () => moveNote(context)),
      },
      {
        id: "notes.spaces",
        title: "Notes: spaces",
        description: "Browse note spaces",
        group: "Notes",
        palette: true,
        slash: { name: "notes-spaces" },
        run: guard(context, () => listSpaces(context)),
      },
      {
        id: "notes.createSpace",
        title: "Notes: create space",
        description:
          "Create a global or planning space and choose any project link",
        group: "Notes",
        palette: true,
        slash: { name: "notes-space" },
        run: guard(context, () => createSpace(context)),
      },
      {
        id: "notes.editSpace",
        title: "Notes: edit space",
        description: "Rename, re-scope, link, unlink, or pin a space",
        group: "Notes",
        palette: true,
        slash: { name: "notes-edit" },
        run: guard(context, () => editSpace(context)),
      },
      {
        id: "notes.deleteSpace",
        title: "Notes: delete space",
        description: "Delete an empty space after confirmation",
        group: "Notes",
        palette: true,
        slash: { name: "notes-delete" },
        run: guard(context, () => deleteSpace(context)),
      },
    ],
  }))
}

const plugin = {
  id: "opencode-notes.tui",
  setup: setupNotesTui,
} satisfies Plugin.Definition

export default plugin
