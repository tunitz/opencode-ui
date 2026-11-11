import { LIMITS, NOTE_STATUSES } from "../types.js"

const noteID = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.projectID,
  description: "Opaque note ID.",
} as const

const spaceID = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.projectID,
  description: "Opaque space ID.",
} as const

const attachmentID = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.projectID,
  description: "Opaque attachment ID.",
} as const

const directory = {
  type: "string",
  maxLength: LIMITS.path,
  description:
    "Canonical project directory. Scopes project spaces; omit to use the working directory where the tool defaults apply.",
} as const

const status = {
  type: "string",
  enum: NOTE_STATUSES,
  description: "One of the seven note statuses.",
} as const

const statuses = {
  type: "array",
  items: { type: "string", enum: NOTE_STATUSES },
  maxItems: NOTE_STATUSES.length,
  description: "Match any of these statuses.",
} as const

const pinned = { type: "boolean" } as const
const expectedRevision = {
  type: "integer",
  minimum: 0,
  description:
    "Optimistic concurrency check. Pass the revision you read; a stale value is rejected.",
} as const
const limit = { type: "integer", minimum: 1, maximum: LIMITS.list } as const
const offset = { type: "integer", minimum: 0 } as const

function closed(
  properties: Record<string, unknown>,
  required: readonly string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  }
}

export const NOTES_TOOL_SCHEMAS = {
  list: closed({
    spaceID: { ...spaceID, type: ["string", "null"] },
    directory,
    status,
    statuses,
    pinned,
    query: { type: "string", maxLength: LIMITS.query },
    includeGlobal: { type: "boolean" },
    includeBodies: { type: "boolean" },
    limit,
    offset,
  }),
  get: closed({ noteID }, ["noteID"]),
  create: closed(
    {
      spaceID: {
        type: ["string", "null"],
        maxLength: LIMITS.projectID,
        description: "null or omitted creates an unassigned note.",
      },
      title: { type: "string", minLength: 1, maxLength: LIMITS.title },
      body: { type: "string", maxLength: LIMITS.body },
      status,
      pinned,
    },
    ["title"]
  ),
  update: closed(
    {
      noteID,
      expectedRevision,
      spaceID: {
        type: ["string", "null"],
        maxLength: LIMITS.projectID,
        description: "null unassigns the note.",
      },
      title: { type: "string", minLength: 1, maxLength: LIMITS.title },
      body: { type: "string", maxLength: LIMITS.body },
      status,
      pinned,
    },
    ["noteID"]
  ),
  delete: closed({ noteID, expectedRevision }, ["noteID"]),
  search: closed(
    {
      query: { type: "string", minLength: 1, maxLength: LIMITS.query },
      directory,
      spaceID: { ...spaceID, type: ["string", "null"] },
      statuses,
      pinned,
      includeGlobal: { type: "boolean" },
      limit,
      offset,
    },
    ["query"]
  ),
  history: closed(
    {
      noteID,
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
      },
      offset,
    },
    ["noteID"]
  ),
  restore: closed(
    { noteID, revision: { type: "integer", minimum: 0 }, expectedRevision },
    ["noteID", "revision"]
  ),
  spaces: closed({
    directory,
    includeGlobal: { type: "boolean" },
  }),
  createSpace: closed(
    {
      name: { type: "string", minLength: 1, maxLength: LIMITS.name },
      projectDir: {
        type: ["string", "null"],
        maxLength: LIMITS.path,
        description: "null or omitted creates a Global space.",
      },
      pinned,
    },
    ["name"]
  ),
  updateSpace: closed(
    {
      spaceID,
      expectedRevision,
      name: { type: "string", minLength: 1, maxLength: LIMITS.name },
      projectDir: {
        type: ["string", "null"],
        maxLength: LIMITS.path,
        description: "null turns the space into a Global space.",
      },
      pinned,
    },
    ["spaceID"]
  ),
  deleteSpace: closed(
    {
      spaceID,
      expectedRevision,
      cascade: {
        type: "boolean",
        description:
          "Accepted for compatibility; non-empty spaces are always refused.",
      },
    },
    ["spaceID"]
  ),
  readAttachment: closed({ noteID, attachmentID }, [
    "noteID",
    "attachmentID",
  ]),
} as const
