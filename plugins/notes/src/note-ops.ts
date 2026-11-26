// >>> rust-anything: note-ops-rs is on. `rust-anything disable ../../../rust/note-ops-rs` removes this block.
const __rustAnything_note_ops_rs = ((p) => p && p.env.RUST_ANYTHING_MODE !== 'old' && p.env.RUST_ANYTHING_UNIT_NOTE_OPS !== 'original' && (() => { try { const m = p.getBuiltinModule('node:module'); const at = p.getBuiltinModule('node:path').join(import.meta.dirname, "../../../rust/note-ops-rs/index.cjs"); return m.createRequire(at)(at) } catch (e) { if (p.env.RUST_ANYTHING_MODE === 'new') throw e } })())(globalThis.process)
// @ts-expect-error Generated rust-anything native rebinding block.
if (__rustAnything_note_ops_rs) { validatedBase64ByteLength = __rustAnything_note_ops_rs.validatedBase64ByteLength; searchNoteTexts = __rustAnything_note_ops_rs.searchNoteTexts; filterNoteTexts = __rustAnything_note_ops_rs.filterNoteTexts }
// <<< rust-anything: note-ops-rs
const BASE64_SHAPE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface NoteSearchHit {
  index: number
  score: number
  snippet: string
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index)
    if (found === -1) break
    count++
    index = found + needle.length
  }
  return count
}

function buildSnippet(
  collapsedBody: string,
  collapsedLowerBody: string,
  lowerQuery: string
): string {
  const index = collapsedLowerBody.indexOf(lowerQuery)
  if (index === -1) return ""
  const start = Math.max(0, index - 80)
  const end = Math.min(
    collapsedBody.length,
    index + lowerQuery.length + 80
  )
  return `${start > 0 ? "…" : ""}${collapsedBody.slice(start, end)}${
    end < collapsedBody.length ? "…" : ""
  }`
}

/**
 * Validate standard padded base64 and return its decoded byte length,
 * or -1 when malformed. Returns 0 for the empty string.
 */
export function validatedBase64ByteLength(value: string): number {
  if (value.length === 0) return 0
  if (value.length % 4 !== 0 || !BASE64_SHAPE.test(value)) return -1
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  return (value.length / 4) * 3 - padding
}

/**
 * Score candidate notes against a search query, returning matching indices,
 * relevance scores, and whitespace-collapsed ±80 character body snippets.
 */
export function searchNoteTexts(
  titles: string[],
  bodies: string[],
  query: string
): NoteSearchHit[] {
  const lowerQuery = collapseWhitespace(query).toLowerCase()
  if (!lowerQuery) return []
  const count = Math.min(titles.length, bodies.length)
  const hits: NoteSearchHit[] = []
  for (let index = 0; index < count; index++) {
    const title = titles[index]!
    const body = bodies[index]!
    const titleMatch = title.toLowerCase().includes(lowerQuery)
    const collapsedBody = collapseWhitespace(body)
    const lowerBody = collapsedBody.toLowerCase()
    const occurrences = countOccurrences(lowerBody, lowerQuery)
    if (!titleMatch && occurrences === 0) continue
    const score = (titleMatch ? 100 : 0) + Math.min(occurrences, 5) * 10
    hits.push({
      index,
      score,
      snippet: buildSnippet(collapsedBody, lowerBody, lowerQuery),
    })
  }
  return hits
}

/**
 * Return indices of notes whose combined `title + "\n" + body` contains the
 * trimmed, case-insensitive query. An empty query matches every candidate.
 */
export function filterNoteTexts(
  titles: string[],
  bodies: string[],
  query: string
): number[] {
  const lowerQuery = query.trim().toLowerCase()
  const count = Math.min(titles.length, bodies.length)
  if (!lowerQuery) {
    const all: number[] = []
    for (let index = 0; index < count; index++) all.push(index)
    return all
  }
  const matched: number[] = []
  for (let index = 0; index < count; index++) {
    if (
      `${titles[index]!}\n${bodies[index]!}`.toLowerCase().includes(lowerQuery)
    ) {
      matched.push(index)
    }
  }
  return matched
}
