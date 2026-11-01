import { normalizeRelativePath } from "@/lib/files"

/** Only accept immediate, relative directory entries from the native listing. */
export function directoryEntryName(path: string): string | null {
  const name = normalizeRelativePath(path)
  return name && !name.includes("/") ? name : null
}

export function parentDirectory(directory: string): string {
  return directory.replace(/\/+$/, "").replace(/\/[^/]+$/, "") || "/"
}

export function childDirectory(directory: string, name: string): string | null {
  const safeName = directoryEntryName(name)
  return safeName ? `${directory.replace(/\/+$/, "")}/${safeName}` : null
}
