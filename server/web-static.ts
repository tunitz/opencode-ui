import { readFile, realpath, stat } from "node:fs/promises"
import { extname, isAbsolute, relative, resolve, sep } from "node:path"
import { gzipSync } from "node:zlib"

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", webmanifest: "application/manifest+json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
  wasm: "application/wasm",
}

const COMPRESSIBLE = new Set(["html", "js", "mjs", "css", "json", "webmanifest", "svg"])

/** Serve only files within the built asset directory; missing assets never become HTML. */
export function createStaticHandler(directory: string) {
  let rootCache: Promise<string> | null = null
  const resolveRoot = () => {
    if (!rootCache) {
      rootCache = realpath(directory).catch((error) => {
        rootCache = null
        throw error
      })
    }
    return rootCache
  }
  const gzipCache = new Map<string, { etag: string; body: Uint8Array }>()

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
    let pathname: string
    try { pathname = decodeURIComponent(new URL(request.url).pathname) }
    catch { return new Response(null, { status: 400 }) }
    if (pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").some((part) => part.startsWith("."))) {
      return new Response(null, { status: 404 })
    }
    const root = await resolveRoot()
    const path = pathname === "/" ? "/index.html" : pathname
    const candidate = resolve(root, `.${path}`)
    const withinRoot = (file: string) => {
      const rel = relative(root, file)
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    }
    if (!withinRoot(candidate)) return new Response(null, { status: 404 })
    let file: string
    let info: Awaited<ReturnType<typeof stat>>
    try {
      file = await realpath(candidate)
      if (!withinRoot(file)) return new Response(null, { status: 404 })
      info = await stat(file)
      if (!info.isFile()) return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 404 })
    }
    const ext = extname(file).slice(1).toLowerCase()
    const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`
    const hashedAsset = path.startsWith("/assets/")
    const headers = new Headers({
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": hashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
      etag,
      vary: "Accept-Encoding",
    })
    const ifNoneMatch = request.headers.get("if-none-match")
    if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag || tag.trim() === "*")) {
      return new Response(null, { status: 304, headers })
    }
    const acceptsGzip =
      COMPRESSIBLE.has(ext) &&
      info.size >= 1024 &&
      (request.headers.get("accept-encoding") ?? "").toLowerCase().includes("gzip")
    if (acceptsGzip) {
      let cached = gzipCache.get(file)
      if (!cached || cached.etag !== etag) {
        const compressed = gzipSync(await readFile(file))
        cached = { etag, body: new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength) }
        if (gzipCache.size > 64) gzipCache.clear()
        gzipCache.set(file, cached)
      }
      headers.set("content-encoding", "gzip")
      headers.set("content-length", String(cached.body.byteLength))
      if (request.method === "HEAD") return new Response(null, { headers })
      return new Response(cached.body, { headers })
    }
    headers.set("content-length", String(info.size))
    if (request.method === "HEAD") return new Response(null, { headers })
    return new Response(Bun.file(file), { headers })
  }
}
