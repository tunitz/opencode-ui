export const BTW_SIDE_QUESTION_INSTRUCTIONS = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

/** Preserve the user's raw text/quotes; only trim the surrounding blank space. */
export function buildBtwPrompt(question: string): string | null {
  const trimmed = question.trim()
  if (!trimmed) return null
  return `${BTW_SIDE_QUESTION_INSTRUCTIONS}\n\n${trimmed}`
}

export function canAskBtw(input: {
  question: string
  pending: boolean
  hasModel: boolean
}): boolean {
  return Boolean(input.question.trim()) && !input.pending && input.hasModel
}
