type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "repeat" | "defaultPrevented" | "keyCode">

export function isCommandShortcut(event: ShortcutEvent, blocked: boolean) {
  return !blocked && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 &&
    !event.repeat && !event.altKey && !event.shiftKey && event.ctrlKey !== event.metaKey && event.key.toLowerCase() === "k"
}

export function isComposerFocusShortcut(event: ShortcutEvent, blocked: boolean) {
  return !blocked && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 &&
    !event.repeat && !event.ctrlKey && !event.metaKey && event.altKey && event.shiftKey && event.key.toLowerCase() === "c"
}
