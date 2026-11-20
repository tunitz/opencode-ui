import { authAwareFetch } from "@/lib/auth"

export const ENGINE_CONNECTION_CHANGED = "opencode-ui:engine-connection-changed"

export type EngineProfileSummary = {
  id: string
  name: string
  engineUrl: string
  hasPassword: boolean
  isRemote: boolean
  unencryptedRemote: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type ConnectionsState = {
  activeId: string | null
  active: EngineProfileSummary | null
  profiles: EngineProfileSummary[]
  suggestedEngineUrl?: string
}

export type EngineTestResult = {
  ok: boolean
  reachable: boolean
  authenticated: boolean
  status: number | null
  version: string | null
  latencyMs: number
  unencryptedRemote: boolean
  error: string | null
}

export type ConnectionDraftInput = {
  name: string
  engineUrl: string
  password?: string
  activate?: boolean
}

export type ConnectionTestInput = {
  profileId?: string
  engineUrl?: string
  password?: string
}

type ErrorBody = {
  error?: {
    code?: unknown
    message?: unknown
  }
}

export class ConnectionApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ConnectionApiError"
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function errorFrom(status: number, body: unknown): ConnectionApiError {
  const error = isRecord(body) ? (body as ErrorBody).error : undefined
  const code =
    isRecord(error) && typeof error.code === "string" && error.code
      ? error.code
      : "request_failed"
  const message =
    isRecord(error) && typeof error.message === "string" && error.message
      ? error.message
      : code === "auth_required" || code === "setup_required"
        ? "Your session expired. Sign in again."
        : "The connection request failed."
  return new ConnectionApiError(status, code, message)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await authAwareFetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ConnectionApiError(0, "network", "Could not reach the OpenCode UI server.")
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw errorFrom(response.status, body)
  return body as T
}

export function listConnections(): Promise<ConnectionsState> {
  return requestJson<ConnectionsState>("/api/ui/connections")
}

export function createConnection(
  input: ConnectionDraftInput
): Promise<ConnectionsState & { profile: EngineProfileSummary }> {
  return requestJson("/api/ui/connections", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateConnection(
  id: string,
  input: Partial<ConnectionDraftInput>
): Promise<ConnectionsState & { profile: EngineProfileSummary }> {
  return requestJson(`/api/ui/connections/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export function deleteConnection(id: string): Promise<ConnectionsState> {
  return requestJson(`/api/ui/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function activateConnection(id: string): Promise<ConnectionsState> {
  return requestJson(`/api/ui/connections/${encodeURIComponent(id)}/activate`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function testConnection(
  input: ConnectionTestInput
): Promise<EngineTestResult> {
  return requestJson("/api/ui/connections/test", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function notifyEngineConnectionChanged(active: EngineProfileSummary | null): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(ENGINE_CONNECTION_CHANGED, { detail: active })
  )
}
