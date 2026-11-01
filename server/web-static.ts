import { realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", webmanifest: "application/manifest+json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
}

/** Serve only files within the built asset directory; missing assets never become HTML. */
export function createStaticHandler(directory: string) {
  const rootPromise = realpath(directory)
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
    let pathname: string
    try { pathname = decodeURIComponent(new URL(request.url).pathname) }
    catch { return new Response(null, { status: 400 }) }
    if (pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").some((part) => part.startsWith("."))) {
      return new Response(null, { status: 404 })
    }
    const root = await rootPromise
    const path = pathname === "/" ? "/index.html" : pathname
    const candidate = resolve(root, `.${path}`)
    const withinRoot = (file: string) => {
      const rel = relative(root, file)
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    }
    if (!withinRoot(candidate)) return new Response(null, { status: 404 })
    let file: string
    try {
      file = await realpath(candidate)
      if (!withinRoot(file) || !(await stat(file)).isFile()) return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 404 })
    }
    const ext = file.split(".").pop()?.toLowerCase() ?? ""
    const headers = new Headers({
      "content-type": MIME[ext] ?? "application/octet-stream",
      // The build merges lazy CSS after Bun names its output, so CSS names do
      // not hash all their final contents. Revalidate rather than cache forever.
      "cache-control": path.startsWith("/assets/") && ext !== "css" ? "public, max-age=31536000, immutable" : "no-cache",
    })
    if (request.method === "HEAD") return new Response(null, { headers })
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers })
  }
}
