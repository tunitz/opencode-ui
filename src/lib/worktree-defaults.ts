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
