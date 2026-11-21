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
  type Scope,
  type RestoreInput,
  type SearchInput,
  type SpacesInput,
  type UpdateNoteInput,
  type UpdateSpaceInput,
} from "../plugins/notes/src/index.ts"

export const NOTES_ROUTE = "/api/ui/notes"
export const NOTES_EVENTS_ROUTE = "/api/ui/notes/events"
export const NOTES_BODY_LIMIT = 1024 * 1024
export const NOTES_ATTACHMENT_BODY_LIMIT = 8 * 1024 * 1024

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
  connection: "keep-alive",
}
const HEARTBEAT_MS = 30_000
const WATCH_DEBOUNCE_MS = 250
const WATCH_DIRECTORIES = ["notes", "spaces", "attachments"] as const

type Input = Record<string, unknown>
type MethodHandler = (
  service: NotesService,
  input: Input,
  scope?: Scope
) => Promise<unknown>

const METHODS: ReadonlyMap<string, { handler: MethodHandler; mutates: boolean }> = new Map<
  string,
  { handler: MethodHandler; mutates: boolean }
>([
  ["list", { handler: (service, input, scope) => service.list(input as unknown as ListInput, scope), mutates: false }],
  ["get", { handler: (service, input, scope) => service.get(input as unknown as GetNoteInput, scope), mutates: false }],
  ["create", { handler: (service, input, scope) => service.create(input as unknown as CreateNoteInput, scope), mutates: true }],
  ["update", { handler: (service, input, scope) => service.update(input as unknown as UpdateNoteInput, scope), mutates: true }],
  ["delete", { handler: (service, input, scope) => service.delete(input as unknown as DeleteNoteInput, scope), mutates: true }],
  ["search", { handler: (service, input, scope) => service.search(input as unknown as SearchInput, scope), mutates: false }],
  ["history", { handler: (service, input, scope) => service.history(input as unknown as HistoryInput, scope), mutates: false }],
  ["restore", { handler: (service, input, scope) => service.restore(input as unknown as RestoreInput, scope), mutates: true }],
  ["spaces", { handler: (service, input, scope) => service.spaces(input as unknown as SpacesInput, scope), mutates: false }],
  ["createSpace", { handler: (service, input, scope) => service.createSpace(input as unknown as CreateSpaceInput, scope), mutates: true }],
  ["updateSpace", { handler: (service, input, scope) => service.updateSpace(input as unknown as UpdateSpaceInput, scope), mutates: true }],
  ["deleteSpace", { handler: (service, input, scope) => service.deleteSpace(input as unknown as DeleteSpaceInput, scope), mutates: true }],
  [
    "createAttachment",
    { handler: (service, input, scope) => service.createAttachment(input as unknown as CreateAttachmentInput, scope), mutates: true },
  ],
  [
    "readAttachment",
    { handler: (service, input, scope) => service.readAttachment(input as unknown as ReadAttachmentInput, scope), mutates: false },
  ],
  [
    "deleteAttachment",
    { handler: (service, input, scope) => service.deleteAttachment(input as unknown as DeleteAttachmentInput, scope), mutates: true },
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
  /** Active saved connection id used to scope every request. */
  getConnectionId?: () => string | null
}

export type NotesApi = {
  handleRequest: (request: Request) => Promise<Response>
  /** Emit a change event to connected streams (exposed for embedding/tests). */
  notifyChange: () => void
  dispose: () => void
}

type SseClient = {
  controller: ReadableStreamDefaultController<Uint8Array>
  cleanup: () => void
}

const MAX_SSE_CLIENTS = 64

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
    if (clients.size === 0 || disposed) return
    const frame = encoder.encode(`event: changed\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)
    for (const client of [...clients]) {
      try {
        if (client.controller.desiredSize !== null && client.controller.desiredSize <= 0) {
          client.cleanup()
          continue
        }
        client.controller.enqueue(frame)
      } catch {
        client.cleanup()
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
    if (disposed) return
    watching ??= (async () => {
      for (const name of WATCH_DIRECTORIES) {
        if (disposed) return
        const dir = join(dataDir, name)
        try {
          await mkdir(dir, { recursive: true, mode: 0o700 })
        } catch {
          continue
        }
        if (disposed) return
        try {
          const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
            if (typeof filename === "string" && (filename.endsWith(".lock") || filename.endsWith(".tmp"))) {
              return
            }
            scheduleChange()
          })
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
    for (const client of [...clients]) {
      client.cleanup()
    }
    clients.clear()
  }

  function eventStream(request: Request): Response {
    if (disposed) return errorResponse("service_unavailable", 503, "Notes service is shutting down")
    if (clients.size >= MAX_SSE_CLIENTS) return errorResponse("too_many_connections", 503, "Too many event streams")
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
        if (disposed || request.signal.aborted) {
          try {
            controller.close()
          } catch {
            // Already closed.
          }
          return
        }
        client = { controller, cleanup }
        clients.add(client)
        try {
          controller.enqueue(encoder.encode(": connected\n\n"))
        } catch {
          cleanup()
          return
        }
        heartbeat = setInterval(() => {
          try {
            // A named event (not an SSE comment) so browser EventSource can
            // observe it and reset the client's stale-connection watchdog.
            controller.enqueue(encoder.encode("event: heartbeat\ndata: {}\n\n"))
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
    if (disposed) return errorResponse("service_unavailable", 503, "Notes service is shutting down")
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
      const scope = options.getConnectionId
        ? { connectionId: options.getConnectionId() }
        : undefined
      const result = await entry.handler(getService(), input, scope)
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
