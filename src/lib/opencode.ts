import { OpenCode } from "@opencode/client"

import {
  structuredErrorMessage,
  type StructuredErrorLike,
} from "@/lib/structured-error"
import type {
  AgentInfo,
  ConfigEntry,
  CommandInfo,
  FormAnswer,
  FormDetail,
  FormField,
  FormInfo,
  FormOption,
  FormState,
  FormValue,
  FormWhen,
  FileDiffInfo,
  IntegrationAttempt,
  IntegrationAttemptStatus,
  IntegrationInfo,
  IntegrationMethod,
  LocationPublicInfo,
  McpResourceCatalog,
  McpServer,
  ModelInfo,
  ModelRef,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  PermissionSource,
  PluginInfo,
  Project,
  PromptSkillAttachment,
  ProviderInfo,
  ToolFileContent,
  Pty,
  SessionInfo,
  SessionInboxInfo,
  SessionInboxUserPayload,
  V2Event,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  SessionInboxCompaction,
  SessionRevert,
  SessionStatsInfo,
  SessionTransferData,
  TokenUsageInfo,
  SkillInfo,
  WorktreeDirectory,
} from "@opencode/client"

// Same-origin only: the Vite dev/preview proxy injects the Basic credential.
export const openCode = OpenCode.make({ baseUrl: window.location.origin })

export type {
  AgentInfo,
  ConfigEntry,
  CommandInfo,
  FormAnswer,
  FormDetail,
  FormField,
  FormInfo,
  FormOption,
  FormState,
  FormValue,
  FormWhen,
  FileDiffInfo,
  IntegrationAttempt,
  IntegrationAttemptStatus,
  IntegrationInfo,
  IntegrationMethod,
  LocationPublicInfo,
  McpResourceCatalog,
  McpServer,
  ModelInfo,
  ModelRef,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  PermissionSource,
  PluginInfo,
  Project,
  PromptSkillAttachment,
  ProviderInfo,
  Pty,
  ToolFileContent,
  SessionInfo,
  SessionInboxInfo,
  SessionInboxUserPayload,
  V2Event,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  SessionInboxCompaction,
  SessionRevert,
  SessionStatsInfo,
  SessionTransferData,
  TokenUsageInfo,
  SkillInfo,
  WorktreeDirectory,
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const structured = structuredErrorMessage(error as StructuredErrorLike)

    if (structured) {
      return structured
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Request failed."
}

/**
 * The client attaches the encoded `_tag` (and `name`) to thrown errors, e.g.
 * `FormAlreadySettledError` or `PermissionNotFoundError`. This lets callers
 * distinguish an already-resolved/removed item from a genuine failure.
 */
export function errorTag(error: unknown): string | null {
  if (error && typeof error === "object") {
    const value = error as { _tag?: unknown; name?: unknown }
    const tag = value._tag ?? value.name

    if (typeof tag === "string" && tag.trim()) {
      return tag
    }
  }

  return null
}
