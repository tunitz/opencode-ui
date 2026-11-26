export type ClientDiagnosticsInput = {
  serverVersion: string | null
  connection: string
  stream: string
  scope: string
  online: boolean | null
  projectsLoaded: number
  sessionsLoaded: number
  hasActiveSession: boolean
  messagesLoaded: number
  pendingPermissions: number
  pendingForms: number
  projectCommandsLoaded: number
  terminalOpen: boolean
}

/** Deliberately whitelisted client diagnostics; never include config/env/prompts/ids. */
export function sanitizedClientDiagnostics(input: ClientDiagnosticsInput) {
  return {
    application: "opencode-ui" as const,
    serverVersion: input.serverVersion ?? "unavailable",
    connection: input.connection,
    stream: input.stream,
    projectScope: input.scope,
    online: input.online,
    projectsLoaded: input.projectsLoaded,
    sessionsLoaded: input.sessionsLoaded,
    hasActiveSession: input.hasActiveSession,
    messagesLoaded: input.messagesLoaded,
    pendingPermissions: input.pendingPermissions,
    pendingForms: input.pendingForms,
    projectCommandsLoaded: input.projectCommandsLoaded,
    terminalOpen: input.terminalOpen,
  }
}
