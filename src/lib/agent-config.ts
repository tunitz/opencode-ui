import type {
  AgentConfigCatalog,
  AgentConfigErrorBody,
  AgentConfigModel,
  AgentConfigScope,
  AgentConfigUpdateRequest,
  AgentConfigUpdateResult,
} from "@/lib/agent-config-types"

export class AgentConfigRequestError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "AgentConfigRequestError"
    this.status = status
    this.code = code
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new AgentConfigRequestError(
      0,
      "network",
      "The agent configuration service could not be reached."
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const error = body as AgentConfigErrorBody | null
    const message =
      typeof error?.error?.message === "string" && error.error.message
        ? error.error.message
        : "The agent configuration request failed."
    const code =
      typeof error?.error?.code === "string" && error.error.code
        ? error.error.code
        : "request_failed"
    throw new AgentConfigRequestError(response.status, code, message)
  }

  return body as T
}

export function fetchAgentConfigCatalog({
  scope,
  projectID,
}: {
  scope: AgentConfigScope
  projectID: string | null
}): Promise<AgentConfigCatalog> {
  const params = new URLSearchParams({ scope })
  if (projectID) params.set("projectID", projectID)
  return requestJson<AgentConfigCatalog>(
    `/api/ui/agents?${params.toString()}`
  )
}

export function saveAgentConfig(
  input: AgentConfigUpdateRequest
): Promise<AgentConfigUpdateResult> {
  return requestJson<AgentConfigUpdateResult>("/api/ui/agents", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
}

/** Parse a `provider/model#variant` display value into the shared model type. */
export function agentConfigModelFromKey(
  value: string
): AgentConfigModel | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const hash = trimmed.indexOf("#")
  const base = hash === -1 ? trimmed : trimmed.slice(0, hash)
  const variant = hash === -1 ? "" : trimmed.slice(hash + 1)
  const slash = base.indexOf("/")
  if (slash <= 0 || slash === base.length - 1) return null
  return {
    providerID: base.slice(0, slash),
    id: base.slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}
