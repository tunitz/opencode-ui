import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { NotesError } from "./types.js"

export const DIRECTORY_MODE = 0o700
export const FILE_MODE = 0o600

export type Env = Record<string, string | undefined>

/** Default file-store root: `$XDG_DATA_HOME/opencode-notes/v1`. */
export function resolveDataDir(env: Env = process.env): string {
  const explicit = env.OPENCODE_NOTES_DATA_DIR?.trim()
  if (explicit) return explicit
  const xdg = env.XDG_DATA_HOME?.trim()
  if (xdg) return join(xdg, "opencode-notes", "v1")
  return join(homedir(), ".local", "share", "opencode-notes", "v1")
}

/** Engine SQLite location used only as a read-only migration source. */
export function resolveEngineDbPath(env: Env = process.env): string {
  const explicit = env.OPENCODE_ENGINE_DB_PATH?.trim()
  if (explicit) return explicit
  const xdg = env.XDG_DATA_HOME?.trim()
  if (xdg) return join(xdg, "opencode", "opencode.db")
  return join(homedir(), ".local", "share", "opencode", "opencode.db")
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIRECTORY_MODE })
}

/**
 * Write through a temp file in the same directory, then rename. The rename is
 * atomic, so readers never observe a partially written record.
 */
export async function atomicWriteFile(
  path: string,
  data: string | Uint8Array
): Promise<void> {
  await ensureDir(dirname(path))
  const temp = `${path}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`
  const handle = await open(temp, "wx", FILE_MODE)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return undefined
  }
}

/**
 * Record IDs become file names. Reject anything that could escape the data
 * directory instead of silently encoding it, so a crafted ID cannot read or
 * write outside the store.
 */
export function safeSegment(id: unknown): string | undefined {
  if (typeof id !== "string") return undefined
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) return undefined
  if (id === "." || id === "..") return undefined
  return id
}

export function invalidID(field = "id"): never {
  throw new NotesError("invalid", `${field} contains unsupported characters`, {
    field,
  })
}
