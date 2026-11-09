/**
 * Status errors can include configured headers/environment values, so never render the native
 * text in the read-only MCP status view.
 */
export function mcpVisibleStatusError(status: "failed" | "needs_auth"): string {
  return status === "failed"
    ? "Native connection error details are hidden because MCP configuration can contain secret values."
    : "Native sign-in error details are hidden because MCP configuration can contain secret values."
}
