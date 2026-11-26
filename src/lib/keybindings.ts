/**
 * Browser-local custom keybindings. The caller supplies the platform and the
 * storage it wants persisted to; this module never reads globals or touches
 * native engine state.
 */

export const KEYBINDING_COMMANDS = ["command.open", "find.open", "composer.stash", "composer.backgroundSend"] as const
export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number]

export type KeybindingWhen = "global" | "composer" | "conversation"

export type Keybinding = {
  command: KeybindingCommand
  /** A single character or a named key such as "Enter" or "ArrowUp". */
  key: string
  /** Cmd on macOS, Ctrl elsewhere; the caller decides the platform. */
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  when: KeybindingWhen
}

export const KEYBINDING_STORAGE_PREFIX = "opencode-ui:keybindings:v1"

const MAX_KEY_LENGTH = 20

const DEFAULT_SPECS: Record<KeybindingCommand, { key: string; when: KeybindingWhen }> = {
  "command.open": { key: "k", when: "global" },
  "find.open": { key: "f", when: "conversation" },
  "composer.stash": { key: "s", when: "composer" },
  "composer.backgroundSend": { key: "Enter", when: "composer" },
}

function defaultBindingFor(command: KeybindingCommand): Keybinding {
  const spec = DEFAULT_SPECS[command]
  return {
    command,
    key: spec.key,
    mod: true,
    ctrl: false,
    alt: false,
    shift: false,
    when: spec.when,
  }
}

export function defaultKeybindings(): Keybinding[] {
  return KEYBINDING_COMMANDS.map((command) => defaultBindingFor(command))
}

export function keybindingStorageKey(origin: string): string {
  return `${KEYBINDING_STORAGE_PREFIX}:${encodeURIComponent(origin)}`
}

function isCommand(value: unknown): value is KeybindingCommand {
  return typeof value === "string" && (KEYBINDING_COMMANDS as readonly string[]).includes(value)
}

function isWhen(value: unknown): value is KeybindingWhen {
  return value === "global" || value === "composer" || value === "conversation"
}

function sanitizeBinding(value: unknown): Keybinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const { command, key, mod, ctrl, alt, shift, when } = candidate
  if (!isCommand(command) || !isWhen(when) || typeof key !== "string") return null
  const trimmed = key.trim()
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) return null
  if (typeof mod !== "boolean" || typeof ctrl !== "boolean" || typeof alt !== "boolean" || typeof shift !== "boolean") {
    return null
  }
  return { command, key: trimmed, mod, ctrl, alt, shift, when }
}

export function parseKeybindings(raw: string | null): Keybinding[] {
  if (typeof raw !== "string") return defaultKeybindings()

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return defaultKeybindings()
  }
  if (!Array.isArray(value)) return defaultKeybindings()

  const accepted = new Map<KeybindingCommand, Keybinding>()
  for (const entry of value) {
    const binding = sanitizeBinding(entry)
    if (!binding || accepted.has(binding.command)) continue
    accepted.set(binding.command, binding)
  }

  // Missing commands fall back to defaults so a partial or older payload
  // still yields a complete set.
  return KEYBINDING_COMMANDS.map((command) => accepted.get(command) ?? defaultBindingFor(command))
}

export function readKeybindings(storage: { getItem(k: string): string | null } | null, origin: string): Keybinding[] {
  if (!storage) return defaultKeybindings()
  try {
    return parseKeybindings(storage.getItem(keybindingStorageKey(origin)))
  } catch {
    return defaultKeybindings()
  }
}

export function writeKeybindings(
  storage: { setItem(k: string, v: string): void } | null,
  origin: string,
  bindings: readonly Keybinding[]
): boolean {
  if (!storage) return false
  try {
    const normalized = parseKeybindings(JSON.stringify(bindings))
    storage.setItem(keybindingStorageKey(origin), JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

export function resetKeybindings(storage: { removeItem?(k: string): void } | null, origin: string): Keybinding[] {
  try {
    storage?.removeItem?.(keybindingStorageKey(origin))
  } catch {
    // A failed removal still resets the caller to defaults.
  }
  return defaultKeybindings()
}

export type KeybindingConflict = { a: Keybinding; b: Keybinding; reason: "same-command" | "same-combo" }

function isSingleCharacter(key: string): boolean {
  return Array.from(key).length === 1
}

function comparableKey(key: string): string {
  return isSingleCharacter(key) ? key.toLowerCase() : key
}

export function keybindingSignature(binding: Pick<Keybinding, "key" | "mod" | "ctrl" | "alt" | "shift" | "when">): string {
  return JSON.stringify([
    comparableKey(binding.key),
    binding.when,
    binding.mod,
    binding.ctrl,
    binding.alt,
    binding.shift,
  ])
}

export function findKeybindingConflicts(bindings: readonly Keybinding[]): KeybindingConflict[] {
  const conflicts: KeybindingConflict[] = []
  for (let i = 0; i < bindings.length; i += 1) {
    for (let j = i + 1; j < bindings.length; j += 1) {
      const a = bindings[i]
      const b = bindings[j]
      if (a.command === b.command) {
        conflicts.push({ a, b, reason: "same-command" })
      } else if (keybindingSignature(a) === keybindingSignature(b)) {
        conflicts.push({ a, b, reason: "same-combo" })
      }
    }
  }
  return conflicts
}

export function matchesKeybinding(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  binding: Keybinding,
  platform: "mac" | "other"
): boolean {
  const expectedMeta = platform === "mac" ? binding.mod : false
  const expectedCtrl = platform === "mac" ? binding.ctrl : binding.mod || binding.ctrl
  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift &&
    comparableKey(event.key) === comparableKey(binding.key)
  )
}
