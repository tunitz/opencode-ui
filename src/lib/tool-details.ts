// Tool data is untrusted. Render it as text, never as markup or a URL.
const DETAIL_LIMIT = 32_000

export function toolTextOutput(content: readonly unknown[] | null | undefined): string | undefined {
  if (!Array.isArray(content)) return undefined
  let output: string | undefined
  for (const part of content) {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "text" || typeof (part as { text?: unknown }).text !== "string") continue
    const text = (part as { text: string }).text
    const separator = output === undefined ? "" : "\n"
    const remaining = DETAIL_LIMIT - (output?.length ?? 0)
    if (separator.length + text.length > remaining) return `${output ?? ""}${separator}${text.slice(0, Math.max(0, remaining - separator.length))}\n… (truncated)`
    output = (output ?? "") + separator + text
  }
  return output
}

export function boundedToolDetail(value: string): string {
  return value.length > DETAIL_LIMIT ? `${value.slice(0, DETAIL_LIMIT)}\n… (truncated)` : value
}

export function toolInputDetail(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined
  try {
    return boundedToolDetail(JSON.stringify(input, null, 2))
  } catch {
    return undefined
  }
}

export function toolCallSummary(name: string | null, input: Record<string, unknown> | undefined): string | undefined {
  const value = name === "shell" || name === "bash" ? input?.command : name === "skill" ? (input?.id ?? input?.name) : undefined
  if (typeof value !== "string" || !value.trim()) return undefined
  const summary = value.trim().replace(/\s+/g, " ")
  return summary.length > 200 ? `${summary.slice(0, 200)}…` : summary
}
