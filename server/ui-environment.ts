import { homedir } from "node:os"

/** Small read-only environment surface for browser defaults. */
export const UI_ENVIRONMENT_ROUTE = "/api/ui/environment"

/**
 * Home directory of the machine that hosts the UI server. This is a path, not
 * a secret: it is used only to prefill the New Session folder. Remote engines
 * keep their own native default until a remote home strategy is chosen.
 */
export function createUiEnvironmentHandler(override?: string): (request: Request) => Response {
  const homeDirectory =
    override?.trim() || process.env.OPENCODE_UI_SESSION_HOME?.trim() || homedir()

  return (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed\n", {
        status: 405,
        headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      })
    }
    return Response.json(
      { homeDirectory },
      { headers: { "cache-control": "no-store" } }
    )
  }
}
