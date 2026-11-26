/**
 * Copy text with a fallback for non-secure origins, where `navigator.clipboard`
 * is undefined (for example a plain-HTTP LAN address). Rejects only when no
 * available clipboard mechanism succeeds, so callers can surface the failure.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Blocked or unavailable; fall through to the legacy copy path.
    }
  }

  const active = document.activeElement as HTMLElement | null
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)

  let copied: boolean
  try {
    // Focus before selecting so the selection is committed (notably on WebKit).
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    copied =
      typeof document.execCommand === "function" && document.execCommand("copy")
  } finally {
    textarea.remove()
    active?.focus?.()
  }

  if (!copied) throw new Error("Clipboard unavailable")
}
