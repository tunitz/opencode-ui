import { isAbsoluteDirectory } from "@/lib/session-commands"

/**
 * Blank means the native backend chooses the parent directory. Relative,
 * protocol-relative, NUL, and newline values are rejected rather than guessed.
 */
export function normalizeWorktreeParentDirectory(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && isAbsoluteDirectory(trimmed) ? trimmed : null
}

/** True for a blank value (backend default) or an absolute directory path. */
export function isWorktreeParentDirectoryValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length === 0 || isAbsoluteDirectory(trimmed)
}

/**
 * The native worktree inventory has no authoritative name, so display the
 * final non-empty directory segment. Trailing and repeated separators are
 * ignored; a filesystem root falls back to the directory itself.
 */
export function worktreeDisplayName(directory: string): string {
  const segments = directory
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
  return segments.at(-1) ?? directory
}

/**
 * Directory shown when the create form opens. An explicit per-creation value
 * wins, including a blank one that opts out of the saved default; otherwise the
 * saved global default is used. A missing or invalid value stays blank so the
 * native backend applies its own default.
 */
export function worktreeParentDirectoryPrefill(
  globalDefault: string | null | undefined,
  override?: string | null
): string {
  const value = override === undefined ? globalDefault : override
  return normalizeWorktreeParentDirectory(value) ?? ""
}
