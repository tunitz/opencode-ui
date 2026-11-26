import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import type { SessionMessageInfo } from "@/lib/opencode"
import { mapResolvedArtifact, type ResolveResponse } from "@/lib/artifact-links"
import type { ToolArtifact } from "@/lib/tool-artifacts"

/** A following idle proves the last assistant in the loaded suffix; the server verifies the full turn. */
export function finalProjectArtifactMessages(messages: readonly SessionMessageInfo[], hasOlder: boolean): Set<string> {
  const result = new Set<string>()
  // An older cursor does not change which assistant is last before this idle.
  void hasOlder
  let last: Extract<SessionMessageInfo, { type: "assistant" }> | null = null
  for (const message of messages) {
    if (message.type === "assistant") last = message
    if (message.type === "idle") {
      if (message.outcome === "succeeded" && !message.error && last &&
          last.finish === "stop" && typeof last.time.completed === "number" && !last.error) result.add(last.id)
      last = null
    }
  }
  return result
}

type Node = { type: string; url?: string; identifier?: string; children?: Node[] }
const parser = unified().use(remarkParse).use(remarkGfm)
function localHref(href: string): boolean {
  return !!href && !href.startsWith("#") && !href.startsWith("//") && !href.startsWith("\\") &&
    !/^[a-z][a-z\d+.-]*:/i.test(href) && !href.includes("\0")
}

/** Parse Markdown rather than matching syntax in code, images, or plain prose. */
export function projectArtifactHrefs(markdown: string): string[] {
  const tree = parser.parse(markdown) as Node
  const definitions = new Map<string, string>()
  const links: Node[] = []
  function visit(node: Node) {
    if (node.type === "definition" && node.identifier && typeof node.url === "string" && !definitions.has(node.identifier.toLowerCase())) definitions.set(node.identifier.toLowerCase(), node.url)
    if (node.type === "link" || node.type === "linkReference") links.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  const found = new Set<string>()
  for (const node of links) {
    const href = node.type === "link" ? node.url : definitions.get(node.identifier?.toLowerCase() ?? "")
    if (href && localHref(href)) found.add(href)
  }
  return [...found]
}

export type ProjectArtifactResult = { href: string; artifact: ToolArtifact | null; status: "ready" | "outside" | "unavailable" }

/** Only collapse links resolved to the same canonical project file. */
export function uniqueProjectArtifacts(results: readonly ProjectArtifactResult[]): ToolArtifact[] {
  const seen = new Set<string>()
  return results.flatMap(({ artifact }) => {
    if (!artifact) return []
    if (artifact.canonicalId) {
      if (seen.has(artifact.canonicalId)) return []
      seen.add(artifact.canonicalId)
    }
    return [artifact]
  })
}
// Capabilities are process-local and may disappear after a server restart. Keep
// successes briefly for overlapping renders, never permanently across reconnects.
const SUCCESS_TTL_MS = 10_000
const cache = new Map<string, { result: ProjectArtifactResult; at: number }>()
export function invalidateProjectArtifactCache(sessionID: string, messageID: string, hrefs: readonly string[]): void {
  for (const href of hrefs) cache.delete(JSON.stringify([sessionID, messageID, href]))
}
type Pending = { controller: AbortController; promise: Promise<ProjectArtifactResult | null>; users: number }
const pending = new Map<string, Pending>()
let active = 0
const waiting: Array<() => void> = []

async function acquire(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  if (active < 4) { active++; return true }
  return new Promise((resolve) => {
    const wake = () => {
      signal.removeEventListener("abort", cancel)
      active++
      resolve(true)
    }
    const cancel = () => {
      const index = waiting.indexOf(wake)
      if (index !== -1) waiting.splice(index, 1)
      resolve(false)
    }
    waiting.push(wake)
    signal.addEventListener("abort", cancel, { once: true })
  })
}
function release() {
  active--
  waiting.shift()?.()
}

async function resolveOne(sessionID: string, messageID: string, href: string, signal: AbortSignal): Promise<ProjectArtifactResult | null> {
  const key = JSON.stringify([sessionID, messageID, href])
  if (signal.aborted) return null
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < SUCCESS_TTL_MS) return cached.result
  if (cached) cache.delete(key)
  let entry = pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    const task: Pending = { controller, users: 0, promise: Promise.resolve(null) }
    pending.set(key, task)
    task.promise = (async () => {
      if (!await acquire(controller.signal)) return null
      try {
        const response = await fetch("/api/ui/project-artifacts/resolve", {
          method: "POST", credentials: "same-origin", signal: controller.signal,
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sessionID, messageID, href }),
        })
        if (!response.ok) return { href, artifact: null, status: response.status === 403 ? "outside" : "unavailable" } as ProjectArtifactResult
        const body = await response.json() as { data?: ResolveResponse }
        if (!body.data || typeof body.data.url !== "string" || typeof body.data.canonicalId !== "string") throw new Error("Invalid artifact response")
        const result: ProjectArtifactResult = { href, artifact: mapResolvedArtifact(body.data, href, window.location.origin), status: "ready" }
        if (!controller.signal.aborted) cache.set(key, { result, at: Date.now() })
        return result
      } catch {
        return controller.signal.aborted ? null : { href, artifact: null, status: "unavailable" } as ProjectArtifactResult
      } finally {
        release()
      }
    })().finally(() => { if (pending.get(key) === task) pending.delete(key) })
    entry = task
  }
  const current = entry
  current.users++
  return new Promise((resolve) => {
    let done = false
    const finish = (result: ProjectArtifactResult | null) => {
      if (done) return
      done = true
      signal.removeEventListener("abort", cancel)
      current.users--
      if (!current.users && pending.get(key) === current) {
        pending.delete(key)
        current.controller.abort()
      }
      resolve(result)
    }
    const cancel = () => finish(null)
    signal.addEventListener("abort", cancel, { once: true })
    void current.promise.then(finish)
  })
}

/** Concurrent consumers share in-flight work, while cancellation remains per consumer. */
export async function resolveProjectArtifacts(sessionID: string, messageID: string, hrefs: readonly string[], signal: AbortSignal): Promise<ProjectArtifactResult[]> {
  const results: ProjectArtifactResult[] = new Array(hrefs.length)
  let cursor = 0
  async function worker() {
    while (!signal.aborted) {
      const index = cursor++
      if (index >= hrefs.length) return
      const result = await resolveOne(sessionID, messageID, hrefs[index], signal)
      if (result && !signal.aborted) results[index] = result
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, hrefs.length) }, worker))
  return results.filter(Boolean)
}
