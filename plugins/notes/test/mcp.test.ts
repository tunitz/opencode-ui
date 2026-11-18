import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import {
  MAX_NOTE_RESOURCES,
  NOTES_PROMPTS,
  NOTES_TOOL_NAMES,
  createNotesMcpServer,
  type NotesMcpOptions,
} from "../src/mcp/server.js"
import { MemoryNotesStore } from "../src/index.js"
import { seededClock, seededIDs } from "./helpers.js"

interface ToolResult {
  readonly content: Array<{ readonly type: string; readonly text?: string }>
  readonly isError?: boolean
}

async function connect(
  options: NotesMcpOptions = {},
  clientCapabilities: Record<string, unknown> = {}
) {
  const created = createNotesMcpServer({
    store: new MemoryNotesStore({ now: seededClock(), createID: seededIDs() }),
    defaultDirectory: "/repo",
    ...options,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: "notes-test", version: "1.0.0" },
    { capabilities: clientCapabilities }
  )
  await Promise.all([
    created.server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return {
    ...created,
    client,
    async close() {
      await client.close()
      await created.server.close()
    },
  }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult
}

function output(result: ToolResult): Record<string, unknown> {
  const text = result.content[0]?.text
  if (text === undefined) throw new Error("tool returned no text")
  return JSON.parse(text) as Record<string, unknown>
}

function outputText(result: ToolResult): string {
  return result.content[0]?.text ?? ""
}

function resourceText(contents: readonly unknown[]): string {
  const first = contents[0]
  if (typeof first === "object" && first !== null && "text" in first) {
    return String((first as { text?: unknown }).text ?? "")
  }
  return ""
}

describe("Notes MCP server", () => {
  test("lists 15 tools with closed object schemas", async () => {
    const { client, close } = await connect()
    try {
      const result = await client.listTools()
      expect(result.tools.map((tool) => tool.name)).toEqual([
        "notes_list",
        "notes_get",
        "notes_create",
        "notes_update",
        "notes_delete",
        "notes_search",
        "notes_history",
        "notes_restore",
        "notes_spaces",
        "notes_create_space",
        "notes_update_space",
        "notes_delete_space",
        "notes_attachment_create",
        "notes_attachment_read",
        "notes_attachment_delete",
      ])
      expect(result.tools.map((tool) => tool.name)).toEqual(NOTES_TOOL_NAMES)
      for (const tool of result.tools) {
        expect(tool.inputSchema.type).toBe("object")
        expect(tool.inputSchema.additionalProperties).toBe(false)
        expect(typeof tool.description).toBe("string")
      }
    } finally {
      await close()
    }
  })

  test("round-trips create, list, search, history, and restore", async () => {
    const { client, close } = await connect()
    try {
      const space = output(
        await call(client, "notes_create_space", { name: "Projects", projectDir: "/repo" })
      ) as unknown as { id: string }
      expect(space.id).toBeTruthy()

      const created = output(
        await call(client, "notes_create", {
          spaceID: space.id,
          title: "Deploy checklist",
          body: "step one mentions needle and needle",
          status: "todo",
        })
      ) as unknown as { id: string; revision: number; title: string }
      expect(created.title).toBe("Deploy checklist")

      const listed = output(
        await call(client, "notes_list", { includeBodies: false })
      ) as { notes: Array<{ id: string; body: string }>; total: number }
      expect(listed.total).toBe(1)
      expect(listed.notes[0]?.id).toBe(created.id)
      expect(listed.notes[0]?.body).toBe("")

      const searched = output(
        await call(client, "notes_search", { query: "needle" })
      ) as { results: Array<{ note: { id: string }; score: number; snippet: string }> }
      expect(searched.results[0]?.note.id).toBe(created.id)
      expect(searched.results[0]?.score).toBe(20)
      expect(searched.results[0]?.snippet).toContain("needle")

      await call(client, "notes_update", {
        noteID: created.id,
        title: "Renamed",
        expectedRevision: created.revision,
      })
      const history = output(
        await call(client, "notes_history", { noteID: created.id })
      ) as { snapshots: Array<{ revision: number; title: string }>; total: number }
      expect(history.total).toBe(1)
      expect(history.snapshots[0]?.title).toBe("Deploy checklist")

      const restored = output(
        await call(client, "notes_restore", {
          noteID: created.id,
          revision: created.revision,
        })
      ) as unknown as { note: { title: string; revision: number } }
      expect(restored.note.title).toBe("Deploy checklist")
      expect(restored.note.revision).toBe(3)

      const got = output(
        await call(client, "notes_get", { noteID: created.id })
      ) as unknown as { id?: string; title?: string }
      // notes_get returns the note directly, not wrapped.
      expect(got.title).toBe("Deploy checklist")
    } finally {
      await close()
    }
  })

  test("creates, reads and deletes a note attachment", async () => {
    const { client, close } = await connect()
    try {
      const created = output(
        await call(client, "notes_create", {
          title: "With attachment",
          body: "See ![note](attachment://placeholder)",
        })
      ) as unknown as { id: string; revision: number }
      const attached = output(
        await call(client, "notes_attachment_create", {
          noteID: created.id,
          expectedRevision: created.revision,
          name: "hello.txt",
          mime: "text/plain",
          data: Buffer.from("hello notes").toString("base64"),
        })
      ) as unknown as {
        attachment: { id: string; name: string; size: number }
        note: { revision: number; attachments: unknown[] }
      }
      expect(attached.attachment.name).toBe("hello.txt")
      expect(attached.attachment.size).toBe(11)
      expect(attached.note.attachments).toHaveLength(1)
      expect(attached.note.revision).toBe(created.revision + 1)

      const read = output(
        await call(client, "notes_attachment_read", {
          noteID: created.id,
          attachmentID: attached.attachment.id,
        })
      ) as unknown as { readable: boolean; text: string }
      expect(read.readable).toBe(true)
      expect(read.text).toBe("hello notes")

      const deleted = output(
        await call(client, "notes_attachment_delete", {
          noteID: created.id,
          attachmentID: attached.attachment.id,
          expectedRevision: attached.note.revision,
        })
      ) as unknown as { note: { attachments: unknown[]; revision: number } }
      expect(deleted.note.attachments).toHaveLength(0)
      expect(deleted.note.revision).toBe(attached.note.revision + 1)
    } finally {
      await close()
    }
  })

  test("defaults directory scoping to the configured working directory", async () => {
    const { client, close } = await connect()
    try {
      const project = output(
        await call(client, "notes_create_space", {
          name: "Here",
          projectDir: "/repo",
        })
      ) as unknown as { id: string }
      const other = output(
        await call(client, "notes_create_space", {
          name: "Elsewhere",
          projectDir: "/elsewhere",
        })
      ) as unknown as { id: string }
      await call(client, "notes_create", {
        spaceID: project.id,
        title: "Here note",
      })
      await call(client, "notes_create", {
        spaceID: other.id,
        title: "Elsewhere note",
      })
      const listed = output(await call(client, "notes_list", {})) as {
        notes: Array<{ title: string }>
        total: number
      }
      expect(listed.total).toBe(1)
      expect(listed.notes[0]?.title).toBe("Here note")
      const spaces = output(await call(client, "notes_spaces", {})) as {
        spaces: Array<{ name: string }>
      }
      expect(spaces.spaces.map((space) => space.name)).toEqual(["Here"])
    } finally {
      await close()
    }
  })

  test("ships the three prompts and renders their instructions", async () => {
    const { client, close } = await connect()
    try {
      const listed = await client.listPrompts()
      expect(listed.prompts.map((prompt) => prompt.name)).toEqual([
        "notes:capture",
        "notes:daily",
        "notes:review",
      ])
      expect(NOTES_PROMPTS).toHaveLength(3)

      const capture = await client.getPrompt({
        name: "notes:capture",
        arguments: { title: "Plan", space: "Projects", status: "in-progress" },
      })
      const captureText = capture.messages[0]?.content
      expect(captureText?.type).toBe("text")
      expect(captureText?.type === "text" ? captureText.text : "").toContain(
        "notes_create"
      )

      const daily = await client.getPrompt({
        name: "notes:daily",
        arguments: { date: "2026-11-11" },
      })
      const dailyText = daily.messages[0]?.content
      expect(dailyText?.type === "text" ? dailyText.text : "").toContain(
        "2026-11-11"
      )
      expect(dailyText?.type === "text" ? dailyText.text : "").toContain(
        "Daily"
      )

      const review = await client.getPrompt({
        name: "notes:review",
        arguments: { directory: "/repo" },
      })
      const reviewText = review.messages[0]?.content
      expect(reviewText?.type === "text" ? reviewText.text : "").toContain(
        "expectedRevision"
      )
    } finally {
      await close()
    }
  })

  test("lists and reads note and spaces resources", async () => {
    const { client, close } = await connect()
    try {
      const space = output(
        await call(client, "notes_create_space", { name: "Global" })
      ) as unknown as { id: string }
      const note = output(
        await call(client, "notes_create", {
          spaceID: space.id,
          title: "Resource note",
          body: "resource body",
          status: "blocked",
        })
      ) as unknown as { id: string }

      const resources = await client.listResources()
      const uris = resources.resources.map((resource) => resource.uri)
      expect(uris).toContain("notes://spaces")
      expect(uris).toContain("notes://note/{noteID}")
      expect(uris).toContain(`notes://note/${note.id}`)
      expect(resources.resources.length).toBeLessThanOrEqual(
        MAX_NOTE_RESOURCES + 2
      )

      const templates = await client.listResourceTemplates()
      expect(
        templates.resourceTemplates.map((template) => template.uriTemplate)
      ).toContain("notes://note/{noteID}")

      const readNote = await client.readResource({
        uri: `notes://note/${note.id}`,
      })
      const noteContents = readNote.contents[0]
      expect(noteContents?.mimeType).toBe("text/markdown")
      const noteText = resourceText(readNote.contents)
      expect(noteText).toContain("id:")
      expect(noteText).toContain("status:")
      expect(noteText).toContain("space:")
      expect(noteText).toContain("updated:")
      expect(noteText).toContain("# Resource note")
      expect(noteText).toContain("resource body")

      const readSpaces = await client.readResource({ uri: "notes://spaces" })
      const spacesContents = readSpaces.contents[0]
      expect(spacesContents?.mimeType).toBe("text/plain")
      expect(resourceText(readSpaces.contents)).toContain("Global")
      expect(resourceText(readSpaces.contents)).toContain("1 notes")
    } finally {
      await close()
    }
  })

  test("requires elicitation confirmation for deletes without expectedRevision", async () => {
    const { client, close } = await connect()
    try {
      const note = output(
        await call(client, "notes_create", { title: "Protected" })
      ) as unknown as { id: string; revision: number }

      const blocked = await call(client, "notes_delete", {
        noteID: note.id,
      })
      expect(blocked.isError).toBe(true)
      expect(outputText(blocked)).toContain("confirmation_required")
      expect(
        (await call(client, "notes_get", { noteID: note.id })).isError
      ).toBeUndefined()

      const explicit = await call(client, "notes_delete", {
        noteID: note.id,
        expectedRevision: note.revision,
      })
      expect(explicit.isError).toBeUndefined()
      expect(output(explicit)).toEqual({ deleted: true })
    } finally {
      await close()
    }
  })

  test("accepts and declines elicitation when the client supports it", async () => {
    const { client, close } = await connect(
      {},
      { elicitation: { form: {} } }
    )
    try {
      const first = output(
        await call(client, "notes_create", { title: "Declined" })
      ) as unknown as { id: string }
      client.setRequestHandler(ElicitRequestSchema, async () => ({
        action: "decline",
      }))
      const declined = await call(client, "notes_delete", {
        noteID: first.id,
      })
      expect(declined.isError).toBe(true)
      expect(outputText(declined)).toContain("confirmation_required")

      const second = output(
        await call(client, "notes_create", { title: "Accepted" })
      ) as unknown as { id: string }
      client.setRequestHandler(ElicitRequestSchema, async () => ({
        action: "accept",
        content: { confirm: true },
      }))
      const accepted = await call(client, "notes_delete", {
        noteID: second.id,
      })
      expect(accepted.isError).toBeUndefined()
      expect(output(accepted)).toEqual({ deleted: true })
    } finally {
      await close()
    }
  })
})
