import { constants } from "node:fs"
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { createHash, randomBytes } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { uiSyncSnapshotSchema } from "../src/lib/ui-sync-contract.ts"

const MAX_BYTES = 64 * 1024
function revision(value: unknown) {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`
}

/** A private, opt-in snapshot. No file is created until a successful PUT. */
export function createUiSyncService(options: { stateFile?: string } = {}) {
  const file = options.stateFile ?? join(homedir(), ".local", "state", "opencode-ui", "sync", "snapshot.json")
  let pending: Promise<unknown> = Promise.resolve()
  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action, action)
    pending = result.catch(() => {})
    return result
  }
  async function read() {
    let handle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw new Error("Invalid sync file")
      const bytes = Buffer.alloc(MAX_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, length)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > MAX_BYTES) throw new Error("Invalid sync file")
      return uiSyncSnapshotSchema.parse(JSON.parse(bytes.subarray(0, length).toString("utf8")))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    } finally { await handle?.close() }
  }
  async function ensureDirectory() {
    const directory = dirname(file)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid sync directory")
    await chmod(directory, 0o700)
    return directory
  }
  async function locked(action: () => Promise<Response>) {
    const directory = await ensureDirectory()
    const lock = join(directory, ".snapshot.lock")
    let handle
    try {
      handle = await open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return new Response("Sync busy\n", { status: 503, headers: { "retry-after": "1" } })
      throw error
    }
    try { return await action() } finally { await handle.close(); await unlink(lock) }
  }
  async function write(value: unknown) {
    const directory = dirname(file)
    const temp = join(directory, `.snapshot-${randomBytes(16).toString("hex")}.tmp`)
    try {
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try {
        await handle.chmod(0o600)
        await handle.writeFile(JSON.stringify(value))
        await handle.sync()
      } finally { await handle.close() }
      await rename(temp, file)
    } finally { await unlink(temp).catch(() => {}) }
  }
  return {
    handleRequest(request: Request): Promise<Response> {
      return serialize(async () => {
        if (request.method === "GET") {
          const value = await read()
          return value ? Response.json(value, { headers: { etag: revision(value) } }) : new Response(null, { status: 404 })
        }
        if (request.method === "DELETE") {
          return locked(async () => {
            const current = await read()
            if (!current || request.headers.get("if-match") !== revision(current)) return new Response(null, { status: 412 })
            await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error })
            return new Response(null, { status: 204 })
          })
        }
        if (request.method !== "PUT") return new Response(null, { status: 405, headers: { allow: "GET, PUT, DELETE" } })
        let input: unknown
        try { input = await request.json() } catch { return new Response("Invalid JSON\n", { status: 400 }) }
        const parsed = uiSyncSnapshotSchema.safeParse(input)
        if (!parsed.success) return new Response("Invalid sync snapshot\n", { status: 400 })
        const encoded = JSON.stringify(parsed.data)
        if (Buffer.byteLength(encoded) > MAX_BYTES) return new Response("Request too large\n", { status: 413 })
        return locked(async () => {
          const current = await read()
          if (current && current.backendVersion !== parsed.data.backendVersion) return new Response("Backend version mismatch\n", { status: 409 })
          if (current ? request.headers.get("if-match") !== revision(current) : request.headers.get("if-none-match") !== "*") {
            return new Response("Sync conflict\n", { status: 412 })
          }
          await write(parsed.data)
          return new Response(null, { status: 204 })
        })
      })
    },
  }
}
