import { normalizeRelativePath } from "@/lib/files"

/** File references are plain prompt text, not uploaded attachments. JSON quoting
 * preserves whitespace, quotes and backslashes in project-relative paths. */
export function fileReference(path: string): string {
  return `@${JSON.stringify(path)}`
}

/** Reject paths that would be changed by URL/path normalization. */
export function isSafeReferencePath(path: string): boolean {
  return normalizeRelativePath(path) === path
}

export function fileQueryRange(value: string, start: number, end: number) {
  const match = /(?:^|\s)@([^\n@"]*)$/.exec(value.slice(0, start))
  if (!match) return null
  const suffix = /^[^\s@"]*/.exec(value.slice(end))?.[0] ?? ""
  return { query: match[1], start: start - match[1].length - 1, end: end + suffix.length }
}

export function referenceRanges(text: string): { path: string; start: number; end: number }[] {
  const ranges: { path: string; start: number; end: number }[] = []
  for (const match of text.matchAll(/@("(?:[^"\\]|\\.)*")/g)) {
    try {
      const path: unknown = JSON.parse(match[1])
      if (typeof path === "string" && isSafeReferencePath(path)) ranges.push({ path, start: match.index, end: match.index + match[0].length })
    } catch { /* Incomplete edits are not references. */ }
  }
  return ranges
}

export function referencedPaths(text: string): string[] {
  return [...new Set(referenceRanges(text).map(({ path }) => path))]
}

export function insertProjectReference(sessionID: string, path: string) {
  window.dispatchEvent(new CustomEvent("composer-insert-project-reference", { detail: { sessionID, path } }))
}
