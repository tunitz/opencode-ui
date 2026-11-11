import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { watch, type FSWatcher } from "node:fs"
import {
  createNotesService,
  NotesError,
  resolveDataDir,
  type ChangeEvent,
  type CreateAttachmentInput,
  type CreateNoteInput,
  type CreateSpaceInput,
  type DeleteAttachmentInput,
  type DeleteNoteInput,
  type DeleteSpaceInput,
  type GetNoteInput,
  type HistoryInput,
  type ListInput,
  type NotesErrorType,
  type NotesService,
  type ReadAttachmentInput,
  type RestoreInput,
  type SearchInput,
  type SpacesInput,
  type UpdateNoteInput,
  type UpdateSpaceInput,
} from "@tunitz/opencode-notes"

export const NOTES_ROUTE = "/api/ui/notes"
export const NOTES_EVENTS_ROUTE = "/api/ui/notes/events"
export const NOTES_BODY_LIMIT = 1024 * 1024
export const NOTES_ATTACHMENT_BODY_LIMIT = 8 * 1024 * 1024

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
}
const HEARTBEAT_MS = 30_000
const WATCH_DEBOUNCE_MS = 250
const WATCH_DIRECTORIES = ["notes", "spaces", "attachments"] as const

type Input = Record<string, unknown>
type MethodHandler = (service: NotesService, input: Input) => Promise<unknown>

const METHODS: ReadonlyMap<string, { handler: MethodHandler; mutates: boolean }> = new Map<
  string,
  { handler: MethodHandler; mutates: boolean }
>([
  ["list", { handler: (service, input) => service.list(input as unknown as ListInput), mutates: false }],
  ["get", { handler: (service, input) => service.get(input as unknown as GetNoteInput), mutates: false }],
  ["create", { handler: (service, input) => service.create(input as unknown as CreateNoteInput), mutates: true }],
  ["update", { handler: (service, input) => service.update(input as unknown as UpdateNoteInput), mutates: true }],
  ["delete", { handler: (service, input) => service.delete(input as unknown as DeleteNoteInput), mutates: true }],
  ["search", { handler: (service, input) => service.search(input as unknown as SearchInput), mutates: false }],
  ["history", { handler: (service, input) => service.history(input as unknown as HistoryInput), mutates: false }],
  ["restore", { handler: (service, input) => service.restore(input as unknown as RestoreInput), mutates: true }],
  ["spaces", { handler: (service, input) => service.spaces(input as unknown as SpacesInput), mutates: false }],
  ["createSpace", { handler: (service, input) => service.createSpace(input as unknown as CreateSpaceInput), mutates: true }],
  ["updateSpace", { handler: (service, input) => service.updateSpace(input as unknown as UpdateSpaceInput), mutates: true }],
  ["deleteSpace", { handler: (service, input) => service.deleteSpace(input as unknown as DeleteSpaceInput), mutates: true }],
  [
    "createAttachment",
    { handler: (service, input) => service.createAttachment(input as unknown as CreateAttachmentInput), mutates: true },
  ],
  [
    "readAttachment",
    { handler: (service, input) => service.readAttachment(input as unknown as ReadAttachmentInput), mutates: false },
  ],
  [
    "deleteAttachment",
    { handler: (service, input) => service.deleteAttachment(input as unknown as DeleteAttachmentInput), mutates: true },
  ],
])

const ERROR_STATUS: Readonly<Record<NotesErrorType, number>> = {
  invalid: 400,
  note_not_found: 404,
  space_not_found: 404,
  snapshot_not_found: 404,
  attachment_not_found: 404,
  revision_conflict: 409,
  space_not_empty: 409,
  limit_exceeded: 413,
  mime_rejected: 415,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function errorResponse(code: string, status: number, message?: string): Response {
  return json({ error: message === undefined ? { code } : { code, message } }, status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase()
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"))
}

async function readInput(request: Request): Promise<Input> {
  try {
    const parsed: unknown = JSON.parse(await request.text())
    if (!isRecord(parsed)) throw new Error("invalid body")
    return parsed
  } catch {
    throw new NotesError("invalid", "Request body must be a JSON object", { field: "body" })
  }
}

export type NotesApiOptions = {
  /** Inject a service (tests). When omitted one is created lazily for this process. */
  service?: NotesService
  /** File-store root for the lazily-created service; defaults to the shared resolution. */
  dataDir?: string
  /** Set false to keep migration off for a lazily-created service. */
  migrate?: boolean
  /** Set false to skip filesystem watching of external changes. */
  watch?: boolean
}

export type NotesApi = {
  handleRequest: (request: Request) => Promise<Response>
  /** Emit a change event to connected streams (exposed for embedding/tests). */
  notifyChange: () => void
  dispose: () => void
}

type SseClient = { controller: ReadableStreamDefaultController<Uint8Array> }

/**
 * HTTP surface over one NotesService per server process, plus a change-event
 * stream for external (filesystem) and in-process mutations.
 */
export function createNotesApi(options: NotesApiOptions = {}): NotesApi {
  const encoder = new TextEncoder()
  const clients = new Set<SseClient>()
  const dataDir = options.dataDir ?? options.service?.store.dataDir ?? resolveDataDir()
  const watchEnabled = options.watch ?? true
  const ownsService = options.service === undefined
  let service = options.service
  let disposed = false

  const emit: (event: ChangeEvent) => void = () => notifyChange()

  function notifyChange(): void {
    if (clients.size === 0) return
    const frame = encoder.encode(`event: changed\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)
    for (const client of clients) {
      try {
        client.controller.enqueue(frame)
      } catch {
        clients.delete(client)
      }
    }
  }

  function getService(): NotesService {
    service ??= createNotesService({
      dataDir,
      migrate: options.migrate ?? true,
      onChange: emit,
    })
    return service
  }

  const watchers: FSWatcher[] = []
  let watchTimer: ReturnType<typeof setTimeout> | undefined
  let watching: Promise<void> | undefined

  function scheduleChange(): void {
    if (watchTimer !== undefined) clearTimeout(watchTimer)
    watchTimer = setTimeout(() => {
      watchTimer = undefined
      notifyChange()
    }, WATCH_DEBOUNCE_MS)
  }

  function startWatching(): void {
    watching ??= (async () => {
      for (const name of WATCH_DIRECTORIES) {
        const dir = join(dataDir, name)
        try {
          await mkdir(dir, { recursive: true, mode: 0o700 })
        } catch {
          continue
        }
        try {
          const watcher = watch(dir, { persistent: false }, scheduleChange)
          watcher.on("error", () => watcher.close())
          watchers.push(watcher)
        } catch {
          // Watching is best-effort; in-process events still flow.
        }
      }
    })()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (watchTimer !== undefined) clearTimeout(watchTimer)
    watchTimer = undefined
    for (const watcher of watchers.splice(0)) {
      try {
        watcher.close()
      } catch {
        // Already closed.
      }
    }
    for (const client of clients) {
      try {
        client.controller.close()
      } catch {
        // Already closed.
      }
    }
    clients.clear()
  }

  function eventStream(request: Request): Response {
    if (watchEnabled) startWatching()
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let client: SseClient | undefined
    let closed = false

    const cleanup = () => {
      if (closed) return
      closed = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      heartbeat = undefined
      if (client) {
        clients.delete(client)
        try {
          client.controller.close()
        } catch {
          // Already closed or cancelled.
        }
      }
      client = undefined
      request.signal.removeEventListener("abort", cleanup)
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        client = { controller }
        clients.add(client)
        try {
          controller.enqueue(encoder.encode(": connected\n\n"))
        } catch {
          // The client vanished before the opening comment.
        }
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"))
          } catch {
            cleanup()
          }
        }, HEARTBEAT_MS)
        request.signal.addEventListener("abort", cleanup, { once: true })
      },
      cancel() {
        cleanup()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  async function handleRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === NOTES_EVENTS_ROUTE) {
      if (request.method !== "GET") return errorResponse("method_not_allowed", 405)
      return eventStream(request)
    }
    if (path !== NOTES_ROUTE && !path.startsWith(`${NOTES_ROUTE}/`)) {
      return errorResponse("not_found", 404)
    }
    const method = path.slice(NOTES_ROUTE.length + 1)
    const entry = METHODS.get(method)
    if (!entry) return errorResponse("not_found", 404)
    if (request.method !== "POST") return errorResponse("method_not_allowed", 405)
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return errorResponse("invalid", 415, "Mutations must be sent as JSON")
    }
    try {
      const input = await readInput(request)
      const result = await entry.handler(getService(), input)
      // An injected service cannot be given the change hook, so report its
      // successful mutations from here instead.
      if (entry.mutates && !ownsService) notifyChange()
      return json(result)
    } catch (error) {
      if (error instanceof NotesError) {
        return errorResponse(error.type, ERROR_STATUS[error.type] ?? 500, error.message)
      }
      return errorResponse("internal_error", 500, "Notes request failed")
    }
  }

  return { handleRequest, notifyChange, dispose }
}
