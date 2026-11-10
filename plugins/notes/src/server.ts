import type { Plugin } from "@opencode/plugin"
import { NOTES_RPC } from "./rpc.js"
import { NotesService } from "./service.js"
import {
  NotesError,
  type ChangeEvent,
  type CreateAttachmentInput,
  type CreateNoteInput,
  type CreateSpaceInput,
  type DeleteAttachmentInput,
  type DeleteNoteInput,
  type DeleteSpaceInput,
  type GetNoteInput,
  type ListInput,
  type NotesStorage,
  type ReadAttachmentInput,
  type SpacesInput,
  type UpdateNoteInput,
  type UpdateSpaceInput,
} from "./types.js"

type ServerContext = Parameters<Plugin.Plugin["setup"]>[0]

const TOOL_NAMESPACE = {
  name: "notes",
  description:
    "Project and global notes with todo, in-progress, and finished states",
} as const

function adaptStorage(storage: ServerContext["storage"]): NotesStorage {
  return {
    get: (key) => storage.get(key),
    set: (key, value) =>
      storage.set(key, value as Parameters<ServerContext["storage"]["set"]>[1]),
    remove: (key) => storage.remove(key),
    scan: (options) => storage.scan(options),
  }
}

function fail(errorFunction: unknown, error: unknown): never {
  if (error instanceof NotesError) {
    const call = errorFunction as (
      type: string,
      message: string,
      data?: unknown
    ) => never
    return call(error.type, error.message, error.data)
  }
  throw error
}

function toolError(error: unknown): Error {
  if (error instanceof NotesError)
    return new Error(`${error.type}: ${error.message}`)
  return error instanceof Error ? error : new Error(String(error))
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** Agent-readable text is capped so a tool result cannot balloon unbounded. */
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
  service: NotesService,
  input: unknown
): Promise<unknown> {
  const { attachment, data } = await service.readAttachment(
    input as ReadAttachmentInput
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

interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: unknown
  readonly run: (service: NotesService, input: unknown) => Promise<unknown>
}

const TOOLS: readonly ToolDefinition[] = [
  {
    name: "notes_list",
    description:
      "List notes. Filter by space, project, status, pinned state, or text. Notes in global spaces are included for a project unless includeGlobal is false. Bodies are included by default; pass includeBodies false for cheap browsing with empty bodies, and use notes_get to read content.",
    input: NOTES_RPC.methods.list.input,
    run: (service, input) => service.list((input ?? {}) as ListInput),
  },
  {
    name: "notes_get",
    description:
      "Read one full note: title, Markdown body, status, revision, and attachment metadata. Use this for content reads instead of notes_list.",
    input: NOTES_RPC.methods.get.input,
    run: (service, input) => service.get(input as GetNoteInput),
  },
  {
    name: "notes_create",
    description:
      "Create a note in an existing space. Use notes_spaces first when the space ID is unknown.",
    input: NOTES_RPC.methods.create.input,
    run: (service, input) => service.create(input as CreateNoteInput),
  },
  {
    name: "notes_update",
    description:
      "Update a note's title, body, status, pinned state, or space. Omitted fields are preserved. Pass expectedRevision to reject a stale write.",
    input: NOTES_RPC.methods.update.input,
    run: (service, input) => service.update(input as UpdateNoteInput),
  },
  {
    name: "notes_delete",
    description:
      "Delete a note by ID. Deleting a missing note returns deleted false. Pass expectedRevision to reject a stale delete.",
    input: NOTES_RPC.methods.delete.input,
    run: (service, input) => service.delete(input as DeleteNoteInput),
  },
  {
    name: "notes_spaces",
    description:
      "List note spaces. Global spaces are project-independent; planning spaces are normally linked to a project.",
    input: NOTES_RPC.methods.spaces.input,
    run: (service, input) => service.spaces((input ?? {}) as SpacesInput),
  },
  {
    name: "notes_create_space",
    description:
      "Create a global or planning space. Set linkCurrentProject to attach a planning space to this project.",
    input: NOTES_RPC.methods.createSpace.input,
    run: (service, input) => service.createSpace(input as CreateSpaceInput),
  },
  {
    name: "notes_update_space",
    description:
      "Rename or re-scope a space, pin it, or change its project link. project null unlinks it. Pass expectedRevision to reject a stale write.",
    input: NOTES_RPC.methods.updateSpace.input,
    run: (service, input) => service.updateSpace(input as UpdateSpaceInput),
  },
  {
    name: "notes_delete_space",
    description:
      "Delete an empty space. Non-empty spaces are always refused, even with cascade, because plugin storage has no transaction; delete notes individually first. Pass expectedRevision to reject a stale delete.",
    input: NOTES_RPC.methods.deleteSpace.input,
    run: (service, input) => service.deleteSpace(input as DeleteSpaceInput),
  },
  {
    name: "notes_attachment_read",
    description:
      "Read a note attachment as text. Only text/*, application/json, and application/xml attachments up to 64 KiB are decoded. Images, PDFs, and other binary attachments return metadata only; bytes are never returned as base64.",
    input: NOTES_RPC.methods.readAttachment.input,
    run: readAttachmentAsText,
  },
]

export async function setupNotesServer(
  context: ServerContext
): Promise<() => Promise<void>> {
  const events: { emitChange?: (event: ChangeEvent) => void } = {}
  const project = context.location.project
  const service = new NotesService({
    storage: adaptStorage(context.storage),
    defaultProject: project
      ? {
          id: project.id,
          directory: project.directory,
          canonical: project.canonical,
        }
      : undefined,
    onChange: (event) => events.emitChange?.(event),
  })

  const rpc = await context.rpc.register(NOTES_RPC, {
    list: async (input, call) => {
      try {
        return await service.list((input ?? {}) as ListInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
    get: async (input, call) => {
      try {
        return { note: await service.get(input as GetNoteInput) }
      } catch (error) {
        return fail(call.error, error)
      }
    },
    create: async (input, call) => {
      try {
        return { note: await service.create(input as CreateNoteInput) }
      } catch (error) {
        return fail(call.error, error)
      }
    },
    update: async (input, call) => {
      try {
        return { note: await service.update(input as UpdateNoteInput) }
      } catch (error) {
        return fail(call.error, error)
      }
    },
    delete: async (input, call) => {
      try {
        return await service.delete(input as DeleteNoteInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
    createAttachment: async (input, call) => {
      try {
        return await service.createAttachment(input as CreateAttachmentInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
    readAttachment: async (input, call) => {
      try {
        return await service.readAttachment(input as ReadAttachmentInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
    deleteAttachment: async (input, call) => {
      try {
        return await service.deleteAttachment(input as DeleteAttachmentInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
    spaces: async (input, call) => {
      try {
        return await service.spaces((input ?? {}) as SpacesInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
    createSpace: async (input, call) => {
      try {
        return { space: await service.createSpace(input as CreateSpaceInput) }
      } catch (error) {
        return fail(call.error, error)
      }
    },
    updateSpace: async (input, call) => {
      try {
        return { space: await service.updateSpace(input as UpdateSpaceInput) }
      } catch (error) {
        return fail(call.error, error)
      }
    },
    deleteSpace: async (input, call) => {
      try {
        return await service.deleteSpace(input as DeleteSpaceInput)
      } catch (error) {
        return fail(call.error, error)
      }
    },
  })

  events.emitChange = (event) => {
    void rpc.events
      .emit("changed", {
        entity: event.entity,
        action: event.action,
        id: event.id,
      })
      .catch(() => undefined)
  }

  const tools = await context.tool.transform((editor) => {
    editor.namespace(TOOL_NAMESPACE)
    for (const tool of TOOLS) {
      editor.add({
        name: tool.name,
        description: tool.description,
        input: tool.input as never,
        options: { namespace: TOOL_NAMESPACE.name, codemode: true },
        async execute(input) {
          try {
            return { content: json(await tool.run(service, input)) }
          } catch (error) {
            throw toolError(error)
          }
        },
      })
    }
  })

  return async () => {
    await tools.dispose()
    await rpc.dispose()
  }
}
