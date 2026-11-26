import { authAwareFetch } from "@/lib/auth"

type EnvironmentPayload = { homeDirectory?: unknown }

let homePromise: Promise<string | null> | null = null

/** Read-only UI host defaults. Never includes credentials or engine state. */
export function fetchSessionHome(): Promise<string | null> {
  if (!homePromise) {
    homePromise = authAwareFetch("/api/ui/environment", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null
        const body = (await response.json().catch(() => null)) as EnvironmentPayload | null
        const home = body?.homeDirectory
        return typeof home === "string" && home.startsWith("/") ? home : null
      })
      .catch(() => null)
  }
  return homePromise
}
