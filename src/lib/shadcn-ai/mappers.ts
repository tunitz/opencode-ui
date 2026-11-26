/**
 * Pure adapters from OpenCode/session data to the shadcn AI element shapes.
 *
 * These are deliberately framework-free: the parallel migration workstreams
 * import the same frozen contracts, and they can be unit tested without React.
 * Never put raw SDK strings into a TraceTitle: the sanitizer below is a
 * security boundary (see AGENTS.md "Security and live state").
 */

export type TraceStatus = "running" | "error" | "pending" | undefined

export type TraceLineView = {
  status: TraceStatus
  title: string
  description?: string
}

export type ToolLikeView = {
  id: string
  name: string | null
  status: "running" | "completed" | "error"
  error?: string | null
  input?: Record<string, unknown>
  output?: string
}

/**
 * Only short, human-readable values may reach a visible trace heading.
 * Reject secrets, long blobs, paths and arbitrary command text.
 */
export function traceValue(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (
    !text ||
    text.length > max ||
    !/^[\p{L}\p{N} .,_()&+:’'-]+$/u.test(text)
  ) {
    return null
  }
  if (/\b(?:secret|password|token|credential|api[ -]?key|private[ -]?key)\b/i.test(text)) return null
  if (/\S{32,}/u.test(text)) return null
  return text
}

export function toolLabel(tool: ToolLikeView): string {
  const name = tool.name ?? `tool ${tool.id}`
  const input = tool.input
  if (!input) return name

  if (name === "subagent" || name === "task") {
    const agent =
      traceValue(input.agent, 40) ?? traceValue(input.subagent_type, 40)
    const description = traceValue(input.description, 100)
    const detail = [agent, description].filter(Boolean).join(" — ")
    return detail ? `${detail} · ${name}` : name
  }
  if (name === "skill") {
    const skill = traceValue(input.id, 60) ?? traceValue(input.name, 60)
    return skill ? `${skill} · ${name}` : name
  }
  for (const key of ["offset", "limit"]) {
    const value = input[key]
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return `${key} ${value} · ${name}`
    }
  }
  return name
}

export function toTraceLine(tool: ToolLikeView, streaming: boolean): TraceLineView {
  const title = toolLabel(tool)
  if (tool.status === "error" || tool.error) {
    return { status: "error", title: `Failed to run ${title}` }
  }
  if (tool.status === "running") {
    return { status: streaming ? "running" : "error", title: `Running ${title}` }
  }
  return { status: undefined, title: `Ran ${title}` }
}

export function toReasoningLine(
  text: string,
  streaming: boolean
): TraceLineView {
  return {
    status: streaming ? "running" : undefined,
    title: streaming ? "Thinking" : "Thought",
    description: streaming ? undefined : `${text.trim().length} characters`,
  }
}

export type PermissionView = {
  title: string
  description?: string
  resources: string[]
  savable: boolean
}

export function toPermissionView(request: {
  action: string
  message?: string | null
  resources?: readonly string[]
  save?: readonly string[] | null
}): PermissionView {
  const uniqueSave = [...new Set(request.save ?? [])]
  return {
    title: request.action,
    description: request.message ?? undefined,
    resources: [...(request.resources ?? [])],
    savable: uniqueSave.length > 0,
  }
}

export type TodoStatus = "pending" | "in_progress" | "completed"

export type QueueItemView = {
  id: string
  title: string
  status: TodoStatus
  section: "todo" | "completed"
}

export function toQueueItem(todo: {
  id?: string
  content?: string
  text?: string
  status?: string
}): QueueItemView {
  const status: TodoStatus =
    todo.status === "in_progress" || todo.status === "completed"
      ? todo.status
      : "pending"
  return {
    id: todo.id ?? `${status}-${todo.content ?? todo.text ?? "item"}`,
    title: todo.content ?? todo.text ?? "Untitled task",
    status,
    section: status === "completed" ? "completed" : "todo",
  }
}

export function toContextView(
  usage: { input?: number | null; output?: number | null },
  limit: number | null | undefined
): { used: number; limit: number; percent: number } | null {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return null
  const used = (usage.input ?? 0) + (usage.output ?? 0)
  if (!Number.isFinite(used) || used < 0) return null
  return { used, limit, percent: Math.min(100, Math.round((used / limit) * 100)) }
}

export type AttachmentFileView = {
  name: string
  mime: string
  size?: number | null
  dataUrl?: string
}

export type AttachmentView = {
  name: string
  description: string
  state: "idle" | "uploading" | "processing" | "error" | "done"
  imageUrl?: string
}

const MAX_INLINE_IMAGE_CHARS = 4_000_000
const CODE_EXTENSIONS = /\.(md|mdx|txt|json|jsonc|js|jsx|ts|tsx|css|scss|html|htm|xml|svg|yaml|yml|toml|csv|log|py|rb|rs|go|java|c|cc|cpp|h|hpp|sh|zsh|sql|vue|svelte)$/i

/**
 * Mirrors the existing safe-image policy from message-files.tsx. SVG and
 * oversized data URLs are never rendered as an image.
 */
export function isSafeImage(
  file: AttachmentFileView,
  isSafeImageMime: (mime: string) => boolean
): boolean {
  return Boolean(
    file.dataUrl &&
      file.dataUrl.length <= MAX_INLINE_IMAGE_CHARS &&
      isSafeImageMime(file.mime) &&
      file.dataUrl.startsWith("data:image/") &&
      !file.dataUrl.toLowerCase().startsWith("data:image/svg")
  )
}

export function toAttachmentView(
  file: AttachmentFileView,
  isSafeImageMime: (mime: string) => boolean,
  state: AttachmentView["state"] = "done"
): AttachmentView {
  const name = file.name?.trim() || "attachment"
  const imageUrl = isSafeImage(file, isSafeImageMime) ? file.dataUrl : undefined
  let description: string
  if (imageUrl) {
    description = `Image · ${name}`
  } else if (CODE_EXTENSIONS.test(name)) {
    description = `File · ${name}`
  } else {
    description = file.mime || "File"
  }
  return { name, description, state, imageUrl }
}

export type CheckpointView = {
  id: string
  label: string
}

export function toCheckpointView(message: {
  id: string
  role?: string
}): CheckpointView {
  return {
    id: message.id,
    label: message.role === "user" ? "Return to your message" : "Return to this reply",
  }
}

export type SourceView = { title: string; url: string; safe: boolean }

/** Only http(s) links may become anchors in a transcript. */
export function toSourceView(source: { title?: string; url: string }): SourceView {
  let safe: boolean
  try {
    const parsed = new URL(source.url)
    safe = parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    safe = false
  }
  return {
    title: traceValue(source.title, 120) ?? "Source",
    url: safe ? source.url : "#",
    safe,
  }
}
