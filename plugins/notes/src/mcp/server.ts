import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { NotesService, type NotesServiceOptions } from "../service.js"
import { NotesError, PACKAGE_NAME, PACKAGE_VERSION } from "../types.js"
import { NOTES_PROMPTS } from "./prompts.js"
import {
  NOTE_RESOURCE_TEMPLATE,
  RESOURCE_TEMPLATES,
  SPACES_RESOURCE_URI,
  listResources,
  noteIDFromURI,
  noteMarkdown,
  spacesInventory,
} from "./resources.js"
import { NOTES_TOOLS } from "./tools.js"

export { NOTES_PROMPTS } from "./prompts.js"
export { NOTES_TOOL_NAMES, NOTES_TOOLS } from "./tools.js"
export {
  MAX_NOTE_RESOURCES,
  NOTE_RESOURCE_TEMPLATE,
  RESOURCE_TEMPLATES,
  SPACES_RESOURCE_URI,
} from "./resources.js"

export interface NotesMcpServer {
  readonly server: Server
  readonly service: NotesService
}

export interface NotesMcpOptions extends NotesServiceOptions {
  /** Directory used when a tool omits `directory`. Defaults to process.cwd(). */
  readonly defaultDirectory?: string
  readonly serverInfo?: { readonly name: string; readonly version: string }
}

const INSTRUCTIONS = [
  "Notes for this project and Global notes. Browse with notes_list (includeBodies false) or notes_search; read content with notes_get.",
  "Statuses: idea, todo, in-progress, blocked, finished, cancelled, archived. Set finished only after verifying with evidence appended to the note body.",
  "Check pinned and in-progress notes at the start of substantial work and update their status when work starts or completes.",
].join("\n")

function toolErrorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>
  isError: true
} {
  if (error instanceof NotesError) {
    const detail =
      error.data.message && error.data.message !== error.message
        ? `${error.message} (${error.data.message})`
        : error.message
    return {
      isError: true,
      content: [{ type: "text", text: `${error.type}: ${detail}` }],
    }
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  }
}

function resourceError(error: unknown): never {
  if (error instanceof NotesError) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${error.type}: ${error.message}`
    )
  }
  throw error
}

/**
 * Build the Notes MCP server. Callers must `await service.ready()` before
 * serving so the one-time engine migration runs first.
 */
export function createNotesMcpServer(
  options: NotesMcpOptions = {}
): NotesMcpServer {
  const service = new NotesService(options)
  const defaultDirectory = options.defaultDirectory ?? process.cwd()
  const server = new Server(
    options.serverInfo ?? { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      capabilities: { tools: {}, prompts: {}, resources: {} },
      instructions: INSTRUCTIONS,
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: NOTES_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = NOTES_TOOLS.find(
      (candidate) => candidate.name === request.params.name
    )
    if (!tool) {
      return toolErrorResult(
        new NotesError("invalid", `Unknown tool: ${request.params.name}`)
      )
    }
    try {
      const output = await tool.run(
        { service, server, defaultDirectory },
        (request.params.arguments ?? {}) as Record<string, unknown>
      )
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      }
    } catch (error) {
      return toolErrorResult(error)
    }
  })

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: NOTES_PROMPTS.map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.arguments.map((argument) => ({ ...argument })),
    })),
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = NOTES_PROMPTS.find(
      (candidate) => candidate.name === request.params.name
    )
    if (!prompt) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown prompt: ${request.params.name}`
      )
    }
    const args = (request.params.arguments ?? {}) as Record<
      string,
      string | undefined
    >
    return {
      description: prompt.description,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: prompt.render(args, defaultDirectory),
          },
        },
      ],
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResources(service),
  }))

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async () => ({
      resourceTemplates: RESOURCE_TEMPLATES.map((template) => ({ ...template })),
    })
  )

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri
    if (uri === SPACES_RESOURCE_URI) {
      try {
        await service.ready()
        const [spaces, notes] = await Promise.all([
          service.store.listSpaces(),
          service.store.listNotes(),
        ])
        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: spacesInventory(spaces, notes),
            },
          ],
        }
      } catch (error) {
        return resourceError(error)
      }
    }
    if (uri === NOTE_RESOURCE_TEMPLATE) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Replace {noteID} with a real note ID."
      )
    }
    const noteID = noteIDFromURI(uri)
    if (noteID !== undefined) {
      try {
        const note = await service.get({ noteID })
        const space =
          note.spaceID === null
            ? undefined
            : await service.store.getSpace(note.spaceID)
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: noteMarkdown(note, space),
            },
          ],
        }
      } catch (error) {
        return resourceError(error)
      }
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`)
  })

  return { server, service }
}

/** Connect the server to stdio. Intended for the standalone entry point. */
export async function startNotesMcpServer(
  options: NotesMcpOptions = {}
): Promise<NotesMcpServer> {
  const created = createNotesMcpServer(options)
  await created.service.ready()
  await created.server.connect(new StdioServerTransport())
  return created
}
