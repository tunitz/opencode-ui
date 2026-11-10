import type { Rpc } from "@opencode/plugin/rpc"
import { LIMITS, NOTE_STATUSES, SPACE_KINDS } from "./types.js"

const projectInput = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: LIMITS.projectID },
    directory: { type: ["string", "null"], maxLength: LIMITS.path },
    canonical: { type: ["string", "null"], maxLength: LIMITS.path },
  },
  required: ["id"],
} as const

const projectLink = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: LIMITS.projectID },
    directory: { type: ["string", "null"], maxLength: LIMITS.path },
    canonical: { type: ["string", "null"], maxLength: LIMITS.path },
  },
  required: ["id", "directory", "canonical"],
} as const

const space = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    kind: { type: "string", enum: SPACE_KINDS },
    project: { anyOf: [projectLink, { type: "null" }] },
    pinned: { type: "boolean" },
    revision: { type: "integer", minimum: 0 },
    createdAt: { type: "number" },
    updatedAt: { type: "number" },
  },
  required: [
    "id",
    "name",
    "kind",
    "project",
    "pinned",
    "revision",
    "createdAt",
    "updatedAt",
  ],
} as const

const attachment = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    mime: { type: "string" },
    size: { type: "integer", minimum: 0 },
    createdAt: { type: "number" },
  },
  required: ["id", "name", "mime", "size", "createdAt"],
} as const

const note = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    spaceID: { type: ["string", "null"] },
    title: { type: "string" },
    body: { type: "string" },
    status: { type: "string", enum: NOTE_STATUSES },
    pinned: { type: "boolean" },
    attachments: { type: "array", items: attachment },
    revision: { type: "integer", minimum: 0 },
    createdAt: { type: "number" },
    updatedAt: { type: "number" },
  },
  required: [
    "id",
    "spaceID",
    "title",
    "body",
    "status",
    "pinned",
    "attachments",
    "revision",
    "createdAt",
    "updatedAt",
  ],
} as const

const limit = { type: "integer", minimum: 1, maximum: LIMITS.list }
const offset = { type: "integer", minimum: 0 }

const invalid = {
  type: "object",
  additionalProperties: false,
  properties: {
    field: { type: "string" },
    message: { type: "string" },
  },
  required: ["field", "message"],
} as const

const noteNotFound = {
  type: "object",
  additionalProperties: false,
  properties: { noteID: { type: "string" } },
  required: ["noteID"],
} as const

const spaceNotFound = {
  type: "object",
  additionalProperties: false,
  properties: { spaceID: { type: "string" } },
  required: ["spaceID"],
} as const

const spaceNotEmpty = {
  type: "object",
  additionalProperties: false,
  properties: {
    spaceID: { type: "string" },
    noteCount: { type: "integer", minimum: 1 },
  },
  required: ["spaceID", "noteCount"],
} as const

const conflict = {
  type: "object",
  additionalProperties: false,
  properties: {
    entity: { type: "string", enum: ["note", "space"] },
    id: { type: "string" },
    expectedRevision: { type: "integer", minimum: 0 },
    revision: { type: "integer", minimum: 0 },
  },
  required: ["entity", "id", "expectedRevision", "revision"],
} as const

const attachmentNotFound = {
  type: "object",
  additionalProperties: false,
  properties: {
    noteID: { type: "string" },
    attachmentID: { type: "string" },
  },
  required: ["noteID", "attachmentID"],
} as const

const attachmentLimit = {
  type: "object",
  additionalProperties: false,
  properties: {
    noteID: { type: "string" },
    attachmentCount: { type: "integer", minimum: 0 },
    size: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1 },
  },
  required: ["noteID", "attachmentCount", "size", "limit"],
} as const

const changed = {
  type: "object",
  additionalProperties: false,
  properties: {
    entity: { type: "string", enum: ["note", "space"] },
    action: { type: "string", enum: ["created", "updated", "deleted"] },
    id: { type: "string" },
  },
  required: ["entity", "action", "id"],
} as const

/**
 * Portable RPC contract. It has no runtime dependencies so clients and the TUI
 * part can import it directly. The server registers this exact object.
 */
export const NOTES_RPC = {
  id: "opencode-notes",
  methods: {
    list: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          spaceID: { type: ["string", "null"] },
          projectID: { type: "string" },
          status: { type: "string", enum: NOTE_STATUSES },
          pinned: { type: "boolean" },
          query: { type: "string", maxLength: LIMITS.query },
          includeGlobal: { type: "boolean" },
          limit,
          offset,
        },
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: {
          notes: { type: "array", items: note },
          total: { type: "integer", minimum: 0 },
        },
        required: ["notes", "total"],
      },
      errors: { invalid },
    },
    create: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          spaceID: { type: ["string", "null"] },
          title: { type: "string", minLength: 1, maxLength: LIMITS.title },
          body: { type: "string", maxLength: LIMITS.body },
          status: { type: "string", enum: NOTE_STATUSES },
          pinned: { type: "boolean" },
        },
        required: ["title"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { note },
        required: ["note"],
      },
      errors: { invalid, space_not_found: spaceNotFound },
    },
    update: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          noteID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
          spaceID: { type: ["string", "null"] },
          title: { type: "string", minLength: 1, maxLength: LIMITS.title },
          body: { type: "string", maxLength: LIMITS.body },
          status: { type: "string", enum: NOTE_STATUSES },
          pinned: { type: "boolean" },
        },
        required: ["noteID"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { note },
        required: ["note"],
      },
      errors: {
        invalid,
        conflict,
        note_not_found: noteNotFound,
        space_not_found: spaceNotFound,
      },
    },
    delete: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          noteID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["noteID"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { deleted: { type: "boolean" } },
        required: ["deleted"],
      },
      errors: { invalid, conflict },
    },
    createAttachment: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          noteID: { type: "string" },
          name: {
            type: "string",
            minLength: 1,
            maxLength: LIMITS.attachmentName,
          },
          mime: {
            type: "string",
            minLength: 1,
            maxLength: LIMITS.attachmentMime,
          },
          // Base64 text. The service enforces the decoded byte limits.
          data: { type: "string", minLength: 4, maxLength: 5_600_000 },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["noteID", "name", "mime", "data"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { note, attachment },
        required: ["note", "attachment"],
      },
      errors: {
        invalid,
        conflict,
        note_not_found: noteNotFound,
        attachment_limit: attachmentLimit,
      },
    },
    readAttachment: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          noteID: { type: "string" },
          attachmentID: { type: "string" },
        },
        required: ["noteID", "attachmentID"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: {
          attachment,
          data: { type: "string" },
        },
        required: ["attachment", "data"],
      },
      errors: {
        invalid,
        note_not_found: noteNotFound,
        attachment_not_found: attachmentNotFound,
      },
    },
    deleteAttachment: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          noteID: { type: "string" },
          attachmentID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["noteID", "attachmentID"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { note },
        required: ["note"],
      },
      errors: {
        invalid,
        conflict,
        note_not_found: noteNotFound,
        attachment_not_found: attachmentNotFound,
      },
    },
    spaces: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectID: { type: "string" },
          kind: { type: "string", enum: SPACE_KINDS },
          includeGlobal: { type: "boolean" },
        },
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: {
          spaces: { type: "array", items: space },
          total: { type: "integer", minimum: 0 },
        },
        required: ["spaces", "total"],
      },
      errors: { invalid },
    },
    createSpace: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: LIMITS.name },
          kind: { type: "string", enum: SPACE_KINDS },
          project: { anyOf: [projectInput, { type: "null" }] },
          linkCurrentProject: { type: "boolean" },
          pinned: { type: "boolean" },
        },
        required: ["name"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { space },
        required: ["space"],
      },
      errors: { invalid },
    },
    updateSpace: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          spaceID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
          name: { type: "string", minLength: 1, maxLength: LIMITS.name },
          kind: { type: "string", enum: SPACE_KINDS },
          project: { anyOf: [projectInput, { type: "null" }] },
          linkCurrentProject: { type: "boolean" },
          pinned: { type: "boolean" },
        },
        required: ["spaceID"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: { space },
        required: ["space"],
      },
      errors: { invalid, conflict, space_not_found: spaceNotFound },
    },
    deleteSpace: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          spaceID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
          cascade: { type: "boolean" },
        },
        required: ["spaceID"],
      },
      output: {
        type: "object",
        additionalProperties: false,
        properties: {
          deleted: { type: "boolean" },
          deletedNotes: { type: "integer", minimum: 0 },
        },
        required: ["deleted", "deletedNotes"],
      },
      errors: { invalid, conflict, space_not_empty: spaceNotEmpty },
    },
  },
  events: {
    changed: { schema: changed },
  },
} as const satisfies Rpc.PortableDefinition

export type NotesRpc = typeof NOTES_RPC
