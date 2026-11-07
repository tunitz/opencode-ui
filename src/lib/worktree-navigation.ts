/** Use the selected project in project scope, otherwise the active session's project. */
export function worktreeNavigationProject(
  scope: "project" | "all",
  selectedProjectID: string | null | undefined,
  activeProjectID: string | null | undefined
): string | null {
  return (scope === "project" ? selectedProjectID : activeProjectID) || null
}
