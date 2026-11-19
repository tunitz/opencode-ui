import type {
  SessionInfo,
  SessionMessageInfo,
  SessionTransferData,
} from "@/lib/opencode"

export type MarkdownTranscriptOptions = {
  /** Include assistant reasoning parts. Defaults to false (upstream hides thinking). */
  thinking?: boolean
  /** Include tool calls and their output. Defaults to true. */
  tools?: boolean
}

/**
 * Exact native JSON transcript: same object the engine returned, only pretty
 * printed. Do not reshape or reinterpret the data here.
 */
export function nativeJsonTranscript(data: SessionTransferData): string {
  return `${JSON.stringify(data, null, 2)}\n`
}

function toolOutput(message: {
  state:
    | { status: "streaming" }
    | { status: "running" }
    | {
        status: "completed"
        content: readonly { type: string; text?: string; uri?: string; name?: string | null }[]
      }
    | { status: "error"; error: { message: string }; content?: readonly unknown[] }
}): string {
  const state = message.state
  if (state.status === "error") return state.error.message
  if (state.status === "streaming" || state.status === "running") return ""
  return state.content
    .flatMap((entry) => {
      if (entry.type === "text") return entry.text ? [entry.text] : []
      return [entry.name ?? entry.uri ?? "file"]
    })
    .join("\n")
}

/**
 * Pure Markdown rendering of a native `session.export` transfer, modelled on
 * upstream 2.1.4 `formatSessionTranscript`. It never invents content: only
 * user text, shell commands/output, assistant text, optional reasoning, and
 * optional tool calls are rendered.
 */
export function formatMarkdownTranscript(
  data: SessionTransferData,
  options: MarkdownTranscriptOptions = {}
): string {
  const includeThinking = options.thinking === true
  const includeTools = options.tools !== false
  const body = data.messages
    .flatMap((message: SessionMessageInfo) => {
      if (message.type === "user") return [`## User\n\n${message.text}`]
      if (message.type === "shell") {
        return [
          `## Shell\n\n\`\`\`\n$ ${message.command}\n${message.output?.output ?? ""}\n\`\`\``,
        ]
      }
      if (message.type !== "assistant") return []
      const parts = message.content.flatMap((item) => {
        if (item.type === "text") return [item.text]
        if (item.type === "reasoning") {
          return includeThinking ? [`_Thinking:_\n\n${item.text}`] : []
        }
        if (!includeTools) return []
        const input =
          typeof item.state.input === "string"
            ? item.state.input
            : JSON.stringify(item.state.input, null, 2)
        const output = toolOutput(item)
        return [
          `**Tool: ${item.name}**\n\n**Input:**\n\`\`\`json\n${input}\n\`\`\`\n\n${output}`,
        ]
      })
      if (parts.length === 0) return []
      return [`## Assistant\n\n${parts.join("\n\n")}`]
    })
    .join("\n\n---\n\n")

  const title = sessionTitle(data.info)
  const header = [
    `# ${title}`,
    `**Session ID:** ${data.info.id}`,
    `**Created:** ${new Date(data.info.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(data.info.time.updated).toLocaleString()}`,
  ].join("\n")

  return `${header}\n\n---\n\n${body}\n`
}

function sessionTitle(info: SessionInfo): string {
  const title = info.title?.trim()
  if (title) return title
  return `Session ${info.id}`
}
