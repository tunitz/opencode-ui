/**
 * A worktree session is created inside the worktree's own folder. If that
 * folder now resolves to a different project, refuse the action instead of
 * creating a session under an unexpected project.
 */
export function newSessionProjectError(
  resolvedProjectID: string | null,
  expectedProjectID?: string
): string | null {
  if (!resolvedProjectID || !expectedProjectID) return null

  return resolvedProjectID === expectedProjectID
    ? null
    : "The selected worktree folder no longer belongs to this project."
}
