import type { NotesService } from "../service.js"
import { LIMITS, type Note, type Scope, type Space } from "../types.js"

export const NOTE_RESOURCE_TEMPLATE = "notes://note/{noteID}"
export const SPACES_RESOURCE_URI = "notes://spaces"
export const MAX_NOTE_RESOURCES = 50

export interface ResourceDescriptor {
  readonly uri: string
  readonly name: string
  readonly description: string
  readonly mimeType: string
}

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: NOTE_RESOURCE_TEMPLATE,
    name: "Note",
    description: "A note as Markdown with YAML-ish frontmatter.",
    mimeType: "text/markdown",
  },
] as const

function frontmatterValue(value: string): string {
  return JSON.stringify(value)
}

export function noteMarkdown(note: Note, space: Space | undefined): string {
  const spaceName =
    note.spaceID === null
      ? "unassigned"
      : (space?.name ?? "unknown space")
  return [
    "---",
    `id: ${frontmatterValue(note.id)}`,
    `status: ${frontmatterValue(note.status)}`,
    `space: ${frontmatterValue(spaceName)}`,
    `updated: ${frontmatterValue(new Date(note.updatedAt).toISOString())}`,
    "---",
    "",
    `# ${note.title}`,
    "",
    note.body,
    "",
  ].join("\n")
}

export function spacesInventory(
  spaces: readonly Space[],
  notes: readonly Note[]
): string {
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (note.spaceID === null) continue
    counts.set(note.spaceID, (counts.get(note.spaceID) ?? 0) + 1)
  }
  if (spaces.length === 0) return "No note spaces.\n"
  const lines = ["# Note spaces", ""]
  for (const space of spaces) {
    const scope = space.projectDir === null ? "Global" : space.projectDir
    lines.push(
      `- ${space.name} [${scope}] (${space.id}) · ${counts.get(space.id) ?? 0} notes${
        space.pinned ? " · pinned" : ""
      }`
    )
  }
  lines.push("")
  return lines.join("\n")
}

/** Up to 50 pinned/most-recent note resources plus the two stable entries. */
export async function listResources(
  service: NotesService,
  scope?: Scope
): Promise<ResourceDescriptor[]> {
  const [listed, listedSpaces] = await Promise.all([
    service.list({ limit: LIMITS.list }, scope),
    service.spaces({}, scope),
  ])
  const notes = listed.notes
  const spaces = listedSpaces.spaces
  const spaceByID = new Map(spaces.map((space) => [space.id, space]))
  // service.list already sorts by pin then recency, like compareNotes did here.
  const recent = notes.slice(0, MAX_NOTE_RESOURCES)
  return [
    {
      uri: NOTE_RESOURCE_TEMPLATE,
      name: "Note template",
      description: "Read any note by ID as Markdown: notes://note/{noteID}",
      mimeType: "text/markdown",
    },
    {
      uri: SPACES_RESOURCE_URI,
      name: "Spaces",
      description: "Space inventory with project scope and note counts.",
      mimeType: "text/plain",
    },
    ...recent.map((note) => ({
      uri: `notes://note/${note.id}`,
      name: note.title,
      description: `${note.status} · ${
        note.spaceID === null
          ? "unassigned"
          : (spaceByID.get(note.spaceID)?.name ?? "unknown space")
      }`,
      mimeType: "text/markdown",
    })),
  ]
}

export function noteIDFromURI(uri: string): string | undefined {
  const prefix = "notes://note/"
  if (!uri.startsWith(prefix)) return undefined
  try {
    const id = decodeURIComponent(uri.slice(prefix.length))
    return id || undefined
  } catch {
    return undefined
  }
}
