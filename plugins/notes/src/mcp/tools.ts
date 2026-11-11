import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { NOTES_TOOL_SCHEMAS } from "./schemas.js"
import type { NotesService } from "../service.js"
import {
  NotesError,
  type CreateNoteInput,
  type CreateSpaceInput,
  type DeleteNoteInput,
  type DeleteSpaceInput,
  type GetNoteInput,
  type HistoryInput,
  type ListInput,
  type ReadAttachmentInput,
  type RestoreInput,
  type SearchInput,
  type SpacesInput,
  type UpdateNoteInput,
  type UpdateSpaceInput,
} from "../types.js"

export interface ToolContext {
  readonly service: NotesService
  readonly server: Server
  readonly defaultDirectory: string
}

export interface NotesTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  run(context: ToolContext, input: Record<string, unknown>): Promise<unknown>
}

function scopingDirectory(
  value: unknown,
  fallback: string
): string | undefined {
  if (typeof value === "string" && value.trim()) return value
  if (value === undefined) return fallback
  return undefined
}

function asInput<T>(input: Record<string, unknown>): T {
  return input as unknown as T
}

const ATTACHMENT_TEXT_LIMIT = 64 * 1024
const TEXT_ATTACHMENT_MIMES = new Set(["application/json", "application/xml"])

function isTextAttachment(mime: string): boolean {
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase()
  return base.startsWith("text/") || TEXT_ATTACHMENT_MIMES.has(base)
}

function base64ByteLength(data: string): number | undefined {
  if (!data || data.length % 4 !== 0) return undefined
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.max(0, (data.length / 4) * 3 - padding)
}

function decodeAttachmentText(data: string): string {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

async function readAttachmentAsText(
  context: ToolContext,
  input: Record<string, unknown>
): Promise<unknown> {
  const { attachment, data } = await context.service.readAttachment(
    asInput<ReadAttachmentInput>(input)
  )
  if (!isTextAttachment(attachment.mime)) {
    return {
      attachment,
      readable: false,
      reason:
        "Only text attachments can be read as text. Images, PDFs, and other binary data are metadata-only.",
    }
  }
  const decodedSize = base64ByteLength(data)
  if (decodedSize === undefined) {
    return {
      attachment,
      readable: false,
      reason: "Attachment data is malformed.",
    }
  }
  if (decodedSize > ATTACHMENT_TEXT_LIMIT) {
    return {
      attachment,
      readable: false,
      reason: `Text attachment is too large to read here (limit ${ATTACHMENT_TEXT_LIMIT} bytes).`,
    }
  }
  try {
    return {
      attachment,
      readable: true,
      text: decodeAttachmentText(data),
    }
  } catch {
    return {
      attachment,
      readable: false,
      reason: "Attachment data is malformed.",
    }
  }
}

function confirmationRequired(): NotesError {
  return new NotesError(
    "invalid",
    "confirmation_required: deleting a note requires explicit confirmation",
    { field: "expectedRevision", message: "confirmation_required" }
  )
}

async function deleteNoteWithConfirmation(
  context: ToolContext,
  input: Record<string, unknown>
): Promise<unknown> {
  const deleteInput = asInput<DeleteNoteInput>(input)
  if (deleteInput.expectedRevision === undefined) {
    let note
    try {
      note = await context.service.get(
        asInput<GetNoteInput>({ noteID: input.noteID })
      )
    } catch (error) {
      if (error instanceof NotesError && error.type === "note_not_found") {
        return context.service.delete(deleteInput)
      }
      throw error
    }
    const capabilities = context.server.getClientCapabilities()
    if (!capabilities?.elicitation?.form) throw confirmationRequired()
    let result
    try {
      result = await context.server.elicitInput({
        mode: "form",
        message: `Delete note "${note.title}"? This cannot be undone.`,
        requestedSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              title: "Delete this note",
              description: "Confirm permanent deletion.",
              default: false,
            },
          },
          required: ["confirm"],
        },
      })
    } catch {
      throw confirmationRequired()
    }
    if (result.action !== "accept" || result.content?.confirm !== true) {
      throw confirmationRequired()
    }
  }
  return context.service.delete(deleteInput)
}

export const NOTES_TOOLS: readonly NotesTool[] = [
  {
    name: "notes_list",
    title: "List notes",
    description:
      "List notes for the current project and Global notes. Filter by space, status, pinned state, or text. Bodies are included by default; pass includeBodies false for cheap browsing and read content with notes_get.",
    inputSchema: NOTES_TOOL_SCHEMAS.list,
    run: (context, input) => {
      const scoped = {
        ...input,
        directory: scopingDirectory(input.directory, context.defaultDirectory),
      }
      return context.service.list(asInput<ListInput>(scoped))
    },
  },
  {
    name: "notes_get",
    title: "Read note",
    description:
      "Read one full note: title, Markdown body, status, revision, and attachment metadata. Use this for content reads instead of notes_list.",
    inputSchema: NOTES_TOOL_SCHEMAS.get,
    run: (context, input) =>
      context.service.get(asInput<GetNoteInput>(input)),
  },
  {
    name: "notes_create",
    title: "Create note",
    description:
      "Create a note in an existing space or unassigned. Call notes_spaces first when the space ID is unknown.",
    inputSchema: NOTES_TOOL_SCHEMAS.create,
    run: (context, input) =>
      context.service.create(asInput<CreateNoteInput>(input)),
  },
  {
    name: "notes_update",
    title: "Update note",
    description:
      "Update a note's title, body, status, pinned state, or space. Omitted fields are preserved. Pass expectedRevision to reject a stale write.",
    inputSchema: NOTES_TOOL_SCHEMAS.update,
    run: (context, input) =>
      context.service.update(asInput<UpdateNoteInput>(input)),
  },
  {
    name: "notes_delete",
    title: "Delete note",
    description:
      "Delete a note by ID. Without expectedRevision the client is asked to confirm; a missing note returns deleted false. Pass expectedRevision to reject a stale delete and skip confirmation.",
    inputSchema: NOTES_TOOL_SCHEMAS.delete,
    run: deleteNoteWithConfirmation,
  },
  {
    name: "notes_search",
    title: "Search notes",
    description:
      "Search note titles and bodies. Returns scored matches with a short snippet and bodyless notes. Scope to the current project by default; set includeGlobal false to hide Global notes.",
    inputSchema: NOTES_TOOL_SCHEMAS.search,
    run: (context, input) => {
      const scoped = {
        ...input,
        directory: scopingDirectory(input.directory, context.defaultDirectory),
      }
      return context.service.search(asInput<SearchInput>(scoped))
    },
  },
  {
    name: "notes_history",
    title: "Note history",
    description:
      "List the saved pre-change snapshots of one note, newest first. Bodies are omitted; use notes_restore with a revision to bring one back.",
    inputSchema: NOTES_TOOL_SCHEMAS.history,
    run: (context, input) =>
      context.service.history(asInput<HistoryInput>(input)),
  },
  {
    name: "notes_restore",
    title: "Restore note revision",
    description:
      "Restore title, body, status, space, and pin state from a saved snapshot as a new revision. The current state is snapshotted first, so a restore can itself be undone.",
    inputSchema: NOTES_TOOL_SCHEMAS.restore,
    run: (context, input) =>
      context.service.restore(asInput<RestoreInput>(input)),
  },
  {
    name: "notes_spaces",
    title: "List spaces",
    description:
      "List note spaces. Global spaces are shown in every project; project spaces match the current directory. Use this before creating a note or space.",
    inputSchema: NOTES_TOOL_SCHEMAS.spaces,
    run: (context, input) => {
      const scoped = {
        ...input,
        directory: scopingDirectory(input.directory, context.defaultDirectory),
      }
      return context.service.spaces(asInput<SpacesInput>(scoped))
    },
  },
  {
    name: "notes_create_space",
    title: "Create space",
    description:
      "Create a Global space (projectDir null or omitted) or a project space for a canonical directory.",
    inputSchema: NOTES_TOOL_SCHEMAS.createSpace,
    run: (context, input) =>
      context.service.createSpace(asInput<CreateSpaceInput>(input)),
  },
  {
    name: "notes_update_space",
    title: "Update space",
    description:
      "Rename or re-scope a space, or pin it. projectDir null turns it into a Global space. Pass expectedRevision to reject a stale write.",
    inputSchema: NOTES_TOOL_SCHEMAS.updateSpace,
    run: (context, input) =>
      context.service.updateSpace(asInput<UpdateSpaceInput>(input)),
  },
  {
    name: "notes_delete_space",
    title: "Delete space",
    description:
      "Delete an empty space. Non-empty spaces are always refused; delete their notes individually first. Pass expectedRevision to reject a stale delete.",
    inputSchema: NOTES_TOOL_SCHEMAS.deleteSpace,
    run: (context, input) =>
      context.service.deleteSpace(asInput<DeleteSpaceInput>(input)),
  },
  {
    name: "notes_attachment_read",
    title: "Read attachment",
    description:
      "Read a note attachment as text. Only text/*, application/json, and application/xml attachments up to 64 KiB are decoded; images, PDFs, and other binary data return metadata only. Bytes are never returned as base64.",
    inputSchema: NOTES_TOOL_SCHEMAS.readAttachment,
    run: readAttachmentAsText,
  },
]

export const NOTES_TOOL_NAMES = NOTES_TOOLS.map((tool) => tool.name)

export { ATTACHMENT_TEXT_LIMIT }
