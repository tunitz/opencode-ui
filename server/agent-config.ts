import { createHash, randomUUID } from "node:crypto"
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises"
import { homedir } from "node:os"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse as parseJsonc,
  parseTree,
  type ParseError,
} from "jsonc-parser"
import { isMap, parseDocument } from "yaml"

import {
  AGENT_CONFIG_FIELDS,
  isAgentConfigMode,
  isAgentConfigPermissionEffect,
  type AgentConfigCatalog,
  type AgentConfigDefaultResult,
  type AgentConfigDeleteResult,
  type AgentConfigEffective,
  type AgentConfigEntry,
  type AgentConfigMode,
  type AgentConfigModel,
  type AgentConfigPatch,
  type AgentConfigPermissionRule,
  type AgentConfigScope,
  type AgentConfigSource,
  type AgentConfigSourceKind,
  type AgentConfigUpdateResult,
  type AgentConfigValues,
} from "../src/lib/agent-config-types.ts"

export const AGENT_CONFIG_ROUTE = "/api/ui/agents"
export const AGENT_CONFIG_DEFAULT_ROUTE = "/api/ui/agents/default"
export const AGENT_CONFIG_MAX_FILE_BYTES = 256 * 1024
export const AGENT_CONFIG_MAX_BODY_BYTES = 64 * 1024

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PROVIDER_PART = /^[^\s#/\p{Cc}]{1,128}$/u
const MODEL_ID_PART = /^[^\s#\p{Cc}]{1,200}$/u
const VARIANT_PART = /^[^\s#/\p{Cc}]{1,128}$/u
const HASH = /^[a-f0-9]{64}$/
const JSON_CONFIG_NAMES = ["opencode.json", "opencode.jsonc"] as const
const AGENT_DIRS = ["agent", "agents"] as const
const LEGACY_AGENT_DIRS = ["mode", "modes"] as const
const FIELD_SET = new Set<string>(AGENT_CONFIG_FIELDS)

type AgentConfigServiceOptions = {
  opencodeBaseUrl?: string
  authorization?: string
  getTarget?: () => {
    opencodeBaseUrl: string
    authorization?: string
    isRemote?: boolean
    name?: string
  }
  env?: NodeJS.ProcessEnv
  home?: string
  fetch?: typeof fetch
  maxFileBytes?: number
  maxBodyBytes?: number
}

type ProjectSummary = {
  id: string
  name: string
  canonical: string
}

type NativeAgent = {
  id: string
  name: string
  model: AgentConfigModel | null
  description: string | null
  mode: AgentConfigMode
  hidden: boolean
  steps: number | null
}

type NativeModel = {
  providerID: string
  id: string
  variants: string[]
}

type ScopeRoot = {
  scope: AgentConfigScope
  root: string
  rootExists: boolean
  label: string
  project: ProjectSummary | null
}

type ScanFile = {
  relativePath: string
  source: AgentConfigSource
  valid: boolean
}

type ScannedAgent = {
  id: string
  source: AgentConfigSource
  readonly: boolean
  permissionsReadOnly: boolean
  warnings: string[]
}

type ScopeScan = {
  jsonFiles: Map<string, ScanFile>
  jsonSources: Map<string, ScannedAgent>
  markdownSources: Map<string, ScannedAgent>
  legacySources: Map<string, ScannedAgent>
  sources: Map<string, ScannedAgent>
  defaultJsonc: AgentConfigSource | null
  warnings: string[]
}

type CatalogBuild = {
  catalog: AgentConfigCatalog
  nativeAvailable: boolean
}

class AgentConfigError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "AgentConfigError"
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
}

function hashBytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function insideRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    return null
  }
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.startsWith(".")
  ) {
    return null
  }
  const parts = value.split("/")
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return null
  }
  return value
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": "default-src 'none'",
    },
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof AgentConfigError) {
    return jsonResponse(error.status, {
      error: { code: error.code, message: error.message },
    })
  }
  return jsonResponse(500, {
    error: {
      code: "internal",
      message: "The agent configuration request failed.",
    },
  })
}

function modelFromValue(
  value: unknown
): { ok: true; value: AgentConfigModel } | { ok: false } {
  if (typeof value === "string") {
    const hash = value.indexOf("#")
    const base = hash === -1 ? value : value.slice(0, hash)
    const variant = hash === -1 ? undefined : value.slice(hash + 1)
    const slash = base.indexOf("/")
    if (slash <= 0 || slash === base.length - 1) return { ok: false }
    const providerID = base.slice(0, slash)
    const id = base.slice(slash + 1)
    if (
      !PROVIDER_PART.test(providerID) ||
      !MODEL_ID_PART.test(id) ||
      (variant !== undefined && !VARIANT_PART.test(variant))
    ) {
      return { ok: false }
    }
    return {
      ok: true,
      value: {
        providerID,
        id,
        ...(variant ? { variant } : {}),
      },
    }
  }
  if (!isRecord(value)) return { ok: false }
  const providerID = value.providerID
  const id =
    typeof value.id === "string"
      ? value.id
      : typeof value.model === "string"
        ? value.model
        : undefined
  const variant = value.variant
  if (
    typeof providerID !== "string" ||
    typeof id !== "string" ||
    !PROVIDER_PART.test(providerID) ||
    !MODEL_ID_PART.test(id) ||
    (variant !== undefined &&
      (typeof variant !== "string" || !VARIANT_PART.test(variant)))
  ) {
    return { ok: false }
  }
  const variantValue =
    typeof variant === "string" && variant ? variant : undefined
  return {
    ok: true,
    value: {
      providerID,
      id,
      ...(variantValue ? { variant: variantValue } : {}),
    },
  }
}

function permissionRulesFromValue(
  value: unknown,
  strict: boolean
):
  | { ok: true; rules: AgentConfigPermissionRule[] }
  | { ok: false } {
  if (!Array.isArray(value)) return { ok: false }
  const rules: AgentConfigPermissionRule[] = []
  for (const item of value) {
    if (!isRecord(item)) return { ok: false }
    if (
      strict &&
      Object.keys(item).some(
        (key) =>
          key !== "action" && key !== "resource" && key !== "effect"
      )
    ) {
      return { ok: false }
    }
    const action = item.action
    const resource = item.resource
    const effect = item.effect
    if (
      typeof action !== "string" ||
      action.trim().length === 0 ||
      action.includes("\0") ||
      typeof resource !== "string" ||
      resource.trim().length === 0 ||
      resource.includes("\0") ||
      !isAgentConfigPermissionEffect(effect)
    ) {
      return { ok: false }
    }
    rules.push({ action, resource, effect })
  }
  return { ok: true, rules }
}

function permissionRulesEqual(
  left: readonly AgentConfigPermissionRule[],
  right: readonly AgentConfigPermissionRule[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (rule, index) =>
        rule.action === right[index]?.action &&
        rule.resource === right[index]?.resource &&
        rule.effect === right[index]?.effect
    )
  )
}

function hasJsoncComments(text: string, start: number, end: number): boolean {
  let index = start
  let inString = false
  while (index < end) {
    const char = text[index]
    if (inString) {
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      index += 1
      continue
    }
    if (char === "/" && text[index + 1] === "/") return true
    if (char === "/" && text[index + 1] === "*") return true
    index += 1
  }
  return false
}

function hasYamlComments(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const node = value as {
    comment?: unknown
    commentBefore?: unknown
    items?: unknown
    key?: unknown
    value?: unknown
  }
  if (typeof node.comment === "string" && node.comment) return true
  if (typeof node.commentBefore === "string" && node.commentBefore) {
    return true
  }
  if (Array.isArray(node.items)) {
    for (const item of node.items) {
      if (hasYamlComments(item)) return true
    }
  }
  if (node.key !== undefined && hasYamlComments(node.key)) return true
  if (node.value !== undefined && hasYamlComments(node.value)) return true
  return false
}

function valuesFromRecord(
  record: Record<string, unknown>
): {
  values: AgentConfigValues
  warnings: string[]
  permissionsReadOnly: boolean
} {
  const values: AgentConfigValues = {}
  const warnings: string[] = []
  let permissionsReadOnly = false

  if (Object.hasOwn(record, "model")) {
    if (record.model === null) {
      values.model = null
    } else {
      const parsed = modelFromValue(record.model)
      if (parsed.ok) values.model = parsed.value
      else warnings.push("An unrecognized model value was left untouched.")
    }
  }
  if (Object.hasOwn(record, "description")) {
    if (typeof record.description === "string") {
      values.description = record.description
    } else if (record.description !== null) {
      warnings.push("An unrecognized description value was left untouched.")
    }
  }
  if (Object.hasOwn(record, "mode")) {
    if (isAgentConfigMode(record.mode)) values.mode = record.mode
    else if (record.mode !== null) {
      warnings.push("An unrecognized mode value was left untouched.")
    }
  }
  if (Object.hasOwn(record, "hidden")) {
    if (typeof record.hidden === "boolean") values.hidden = record.hidden
    else if (record.hidden !== null) {
      warnings.push("An unrecognized hidden value was left untouched.")
    }
  }
  if (Object.hasOwn(record, "steps")) {
    if (typeof record.steps === "number" && Number.isInteger(record.steps)) {
      values.steps = record.steps
    } else if (record.steps !== null) {
      warnings.push("An unrecognized steps value was left untouched.")
    }
  }
  if (Object.hasOwn(record, "disabled")) {
    if (typeof record.disabled === "boolean") values.disabled = record.disabled
    else if (record.disabled !== null) {
      warnings.push("An unrecognized disabled value was left untouched.")
    }
  }
  if (Object.hasOwn(record, "permission") || Object.hasOwn(record, "tools")) {
    permissionsReadOnly = true
    warnings.push(
      "Legacy V1 permission/tools fields are present; permission editing is read-only here."
    )
  }
  if (Object.hasOwn(record, "permissions")) {
    const strict = permissionRulesFromValue(record.permissions, true)
    if (strict.ok) {
      values.permissions = strict.rules
    } else {
      permissionsReadOnly = true
      const lenient = permissionRulesFromValue(record.permissions, false)
      if (lenient.ok) values.permissions = lenient.rules
      warnings.push(
        "Permission rules contain comments or unknown fields that cannot be safely preserved here; they are read-only in this editor."
      )
    }
  }

  return { values, warnings, permissionsReadOnly }
}

function splitFrontmatter(
  text: string
): { frontmatter: string; body: string; eol: string } | null {
  const match = /^---[ \t]*(\r?\n)([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    text
  )
  if (!match) return null
  return {
    frontmatter: match[2] ?? "",
    body: text.slice(match[0].length),
    eol: match[1] ?? "\n",
  }
}

function valuesFromFrontmatter(
  frontmatter: string
):
  | { ok: true; values: AgentConfigValues; permissionsReadOnly: boolean }
  | { ok: false; message: string } {
  const document = parseDocument(frontmatter, { keepSourceTokens: true })
  if (document.errors.length > 0) {
    return { ok: false, message: "The YAML frontmatter is invalid." }
  }
  if (document.contents === null) {
    return { ok: true, values: {}, permissionsReadOnly: false }
  }
  if (!isMap(document.contents)) {
    return { ok: false, message: "The YAML frontmatter is invalid." }
  }
  let data: unknown
  try {
    data = document.toJS()
  } catch {
    return { ok: false, message: "The YAML frontmatter is invalid." }
  }
  if (!isRecord(data)) {
    return { ok: false, message: "The YAML frontmatter is invalid." }
  }
  const extracted = valuesFromRecord(data)
  const values = extracted.values
  let permissionsReadOnly = extracted.permissionsReadOnly
  if (Object.hasOwn(data, "permissions")) {
    const permissionsNode = document.getIn(["permissions"], true)
    if (permissionsNode !== undefined && hasYamlComments(permissionsNode)) {
      permissionsReadOnly = true
    }
    if (isMap(document.contents)) {
      const permissionsPair = document.contents.items.find((item) => {
        if (!isRecord(item)) return false
        const key = item.key
        return isRecord(key) && key.value === "permissions"
      })
      if (permissionsPair && hasYamlComments(permissionsPair)) {
        permissionsReadOnly = true
      }
    }
  }
  if (
    values.model &&
    !values.model.variant &&
    typeof data.variant === "string" &&
    VARIANT_PART.test(data.variant)
  ) {
    values.model = { ...values.model, variant: data.variant }
  }
  return { ok: true, values, permissionsReadOnly }
}

function normalizeNativeAgent(value: unknown): NativeAgent | null {
  if (!isRecord(value) || typeof value.id !== "string") return null
  const model = value.model === undefined ? null : modelFromValue(value.model)
  return {
    id: value.id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : value.id,
    model: model?.ok ? model.value : null,
    description:
      typeof value.description === "string" ? value.description : null,
    mode: isAgentConfigMode(value.mode) ? value.mode : "primary",
    hidden: value.hidden === true,
    steps:
      typeof value.steps === "number" && Number.isInteger(value.steps)
        ? value.steps
        : null,
  }
}

function normalizeNativeModel(value: unknown): NativeModel | null {
  if (
    !isRecord(value) ||
    typeof value.providerID !== "string" ||
    typeof value.id !== "string"
  ) {
    return null
  }
  const variants = Array.isArray(value.variants)
    ? value.variants.flatMap((variant) => {
        if (!isRecord(variant) || typeof variant.id !== "string") return []
        return [variant.id]
      })
    : []
  return { providerID: value.providerID, id: value.id, variants }
}

export function resolveAgentConfigDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  const explicit = env.OPENCODE_CONFIG_DIR?.trim()
  if (explicit) return resolve(explicit)
  const xdg = env.XDG_CONFIG_HOME?.trim()
  return join(xdg ? resolve(xdg) : join(home, ".config"), "opencode")
}

function validatePatch(value: unknown): AgentConfigPatch {
  if (!isRecord(value)) {
    throw new AgentConfigError(400, "invalid_patch", "The agent patch is invalid.")
  }
  const keys = Object.keys(value)
  if (keys.length === 0) {
    throw new AgentConfigError(400, "empty_patch", "There are no changes to save.")
  }
  for (const key of keys) {
    if (!FIELD_SET.has(key)) {
      throw new AgentConfigError(
        400,
        "unsupported_field",
        "Only model, description, mode, hidden, steps, disabled, and permissions may be edited."
      )
    }
  }

  const patch: AgentConfigPatch = {}
  if (Object.hasOwn(value, "model")) {
    if (value.model === null) {
      patch.model = null
    } else {
      const parsed = modelFromValue(value.model)
      if (!parsed.ok) {
        throw new AgentConfigError(400, "invalid_model", "The model is invalid.")
      }
      patch.model = parsed.value
    }
  }
  if (Object.hasOwn(value, "description")) {
    if (value.description === null) {
      patch.description = null
    } else if (typeof value.description === "string") {
      const description = value.description.trim()
      if (description.length > 500 || /\p{Cc}/u.test(description)) {
        throw new AgentConfigError(
          400,
          "invalid_description",
          "The description must be a short single-line value."
        )
      }
      patch.description = description.length > 0 ? description : null
    } else {
      throw new AgentConfigError(
        400,
        "invalid_description",
        "The description is invalid."
      )
    }
  }
  if (Object.hasOwn(value, "mode")) {
    if (value.mode === null) patch.mode = null
    else if (isAgentConfigMode(value.mode)) patch.mode = value.mode
    else {
      throw new AgentConfigError(400, "invalid_mode", "The mode is invalid.")
    }
  }
  if (Object.hasOwn(value, "hidden")) {
    if (value.hidden === null) patch.hidden = null
    else if (typeof value.hidden === "boolean") patch.hidden = value.hidden
    else {
      throw new AgentConfigError(400, "invalid_hidden", "The hidden value is invalid.")
    }
  }
  if (Object.hasOwn(value, "steps")) {
    if (value.steps === null) patch.steps = null
    else if (
      typeof value.steps === "number" &&
      Number.isSafeInteger(value.steps) &&
      value.steps >= 0
    ) {
      patch.steps = value.steps
    } else {
      throw new AgentConfigError(
        400,
        "invalid_steps",
        "Steps must be a whole number of 0 or more."
      )
    }
  }
  if (Object.hasOwn(value, "disabled")) {
    if (value.disabled === null) patch.disabled = null
    else if (typeof value.disabled === "boolean") patch.disabled = value.disabled
    else {
      throw new AgentConfigError(
        400,
        "invalid_disabled",
        "The disabled value is invalid."
      )
    }
  }
  if (Object.hasOwn(value, "permissions")) {
    if (value.permissions === null) {
      patch.permissions = null
    } else {
      const parsed = permissionRulesFromValue(value.permissions, true)
      if (!parsed.ok) {
        throw new AgentConfigError(
          400,
          "invalid_permissions",
          "Permission rules must be action/resource/effect entries with no extra fields."
        )
      }
      patch.permissions = parsed.rules
    }
  }
  return patch
}

function patchValueForFile(field: string, value: unknown): unknown {
  if (value === null) return undefined
  if (field === "model" && isRecord(value)) {
    const providerID = value.providerID
    const id = value.id
    const variant = value.variant
    if (typeof providerID !== "string" || typeof id !== "string") {
      return undefined
    }
    return `${providerID}/${id}${
      typeof variant === "string" && variant ? `#${variant}` : ""
    }`
  }
  return value
}

function updateJsonc(
  text: string,
  agentID: string,
  patch: AgentConfigPatch
): string {
  const errors: ParseError[] = []
  const root = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(root)) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "The JSONC configuration is invalid and was not edited."
    )
  }
  if (Object.hasOwn(root, "agents")) {
    if (!isRecord(root.agents)) {
      throw new AgentConfigError(
        409,
        "invalid_source",
        "The agents field is not an object, so it was not edited."
      )
    }
    if (
      Object.hasOwn(root.agents, agentID) &&
      !isRecord(root.agents[agentID])
    ) {
      throw new AgentConfigError(
        409,
        "invalid_source",
        "This agent entry is not an object, so it was not edited."
      )
    }
  }

  let next = text
  for (const field of AGENT_CONFIG_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue
    const edits = modify(
      next,
      ["agents", agentID, field],
      patchValueForFile(field, patch[field]),
      {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: text.includes("\r\n") ? "\r\n" : "\n",
        },
      }
    )
    next = applyEdits(next, edits)
  }

  const after: ParseError[] = []
  const parsed = parseJsonc(next, after, { allowTrailingComma: true })
  if (after.length > 0 || !isRecord(parsed)) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited JSONC could not be validated and was not saved."
    )
  }
  const resultAgent = isRecord(parsed.agents) ? parsed.agents[agentID] : null
  if (
    Object.hasOwn(patch, "model") &&
    patch.model !== null &&
    (resultAgent === null ||
      !isRecord(resultAgent) ||
      !modelFromValue(resultAgent.model).ok)
  ) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited model could not be validated."
    )
  }
  const permissionsPatch = patch.permissions
  if (permissionsPatch !== undefined) {
    if (permissionsPatch === null) {
      if (
        resultAgent !== null &&
        isRecord(resultAgent) &&
        Object.hasOwn(resultAgent, "permissions")
      ) {
        throw new AgentConfigError(
          409,
          "invalid_result",
          "The permission override could not be removed."
        )
      }
    } else {
      const resultPermissions =
        resultAgent !== null && isRecord(resultAgent)
          ? permissionRulesFromValue(resultAgent.permissions, false)
          : { ok: false as const }
      if (
        !resultPermissions.ok ||
        !permissionRulesEqual(resultPermissions.rules, permissionsPatch)
      ) {
        throw new AgentConfigError(
          409,
          "invalid_result",
          "The edited permission rules could not be validated."
        )
      }
    }
  }
  return next
}

export function updateDefaultAgent(text: string, agentID: string): string {
  const errors: ParseError[] = []
  const root = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(root)) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "The JSONC configuration is invalid and was not edited."
    )
  }
  const edits = modify(text, ["default_agent"], agentID, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    },
  })
  const next = applyEdits(text, edits)
  const after: ParseError[] = []
  const parsed = parseJsonc(next, after, { allowTrailingComma: true })
  if (
    after.length > 0 ||
    !isRecord(parsed) ||
    parsed.default_agent !== agentID
  ) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited default agent could not be validated."
    )
  }
  return next
}

export function removeJsoncAgent(text: string, agentID: string): string {
  const errors: ParseError[] = []
  const root = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isRecord(root)) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "The JSONC configuration is invalid and was not edited."
    )
  }
  if (!Object.hasOwn(root, "agents")) return text
  if (!isRecord(root.agents)) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "The agents field is not an object, so it was not edited."
    )
  }
  if (!Object.hasOwn(root.agents, agentID)) return text
  const edits = modify(text, ["agents", agentID], undefined, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    },
  })
  const next = applyEdits(text, edits)
  const after: ParseError[] = []
  const parsed = parseJsonc(next, after, { allowTrailingComma: true })
  if (after.length > 0 || !isRecord(parsed)) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited JSONC could not be validated and was not saved."
    )
  }
  if (isRecord(parsed.agents) && Object.hasOwn(parsed.agents, agentID)) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The agent entry could not be removed."
    )
  }
  return next
}

function updateMarkdown(
  text: string,
  patch: AgentConfigPatch
): string {
  const split = splitFrontmatter(text)
  if (!split) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "This agent file has no YAML frontmatter, so it was not edited."
    )
  }
  const document = parseDocument(split.frontmatter, {
    keepSourceTokens: true,
  })
  if (document.errors.length > 0) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "The YAML frontmatter is invalid and was not edited."
    )
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new AgentConfigError(
      409,
      "invalid_source",
      "The YAML frontmatter is invalid and was not edited."
    )
  }

  let frontmatter: string
  try {
    for (const field of AGENT_CONFIG_FIELDS) {
      if (!Object.hasOwn(patch, field)) continue
      const value = patchValueForFile(field, patch[field])
      if (value === undefined) {
        document.deleteIn([field])
      } else {
        document.setIn([field], value)
      }
    }
    // The legacy `variant` key is only meaningful with a plain model string.
    // A written model always carries the variant as `#variant`, so remove the
    // stale key whenever the model changes.
    if (Object.hasOwn(patch, "model")) {
      document.deleteIn(["variant"])
    }
    frontmatter = document
      .toString({ lineWidth: 0 })
      .replace(/\r?\n$/, "")
      .replace(/\r?\n/g, split.eol)
  } catch {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited frontmatter could not be produced and was not saved."
    )
  }
  const next = `---${split.eol}${frontmatter}${split.eol}---${split.eol}${split.body}`

  const check = splitFrontmatter(next)
  if (!check) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited frontmatter could not be validated and was not saved."
    )
  }
  const parsed = valuesFromFrontmatter(check.frontmatter)
  if (!parsed.ok) {
    throw new AgentConfigError(
      409,
      "invalid_result",
      "The edited frontmatter could not be validated and was not saved."
    )
  }
  const permissionsPatch = patch.permissions
  if (permissionsPatch !== undefined) {
    if (permissionsPatch === null) {
      if (parsed.values.permissions !== undefined) {
        throw new AgentConfigError(
          409,
          "invalid_result",
          "The permission override could not be removed."
        )
      }
    } else if (
      !parsed.values.permissions ||
      !permissionRulesEqual(parsed.values.permissions, permissionsPatch)
    ) {
      throw new AgentConfigError(
        409,
        "invalid_result",
        "The edited permission rules could not be validated."
      )
    }
  }
  return next
}

function defaultJsoncSource(
  scopeLabel: string,
  relativePath: string,
  exists: boolean,
  hash: string | null
): AgentConfigSource {
  return {
    kind: "jsonc",
    relativePath,
    label: `${scopeLabel} ${relativePath}`,
    exists,
    hash,
    values: {},
  }
}

function createNewJsoncText(): string {
  return `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
}

async function readTextFile(
  root: string,
  relativePath: string,
  maxBytes: number
): Promise<{
  text: string
  hash: string
  mode: number
  path: string
} | null> {
  const candidate = resolve(root, relativePath)
  if (!insideRoot(candidate, root)) {
    throw new AgentConfigError(
      403,
      "outside_root",
      "That configuration path is outside the allowed scope."
    )
  }
  let entry
  try {
    entry = await lstat(candidate)
  } catch (error) {
    if (isNotFound(error)) return null
    throw new AgentConfigError(
      500,
      "unreadable",
      "The configuration file could not be read."
    )
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new AgentConfigError(
      409,
      "unsafe_file",
      "Configuration symlinks and non-regular files are not edited."
    )
  }
  if (entry.size > maxBytes) {
    throw new AgentConfigError(
      413,
      "too_large",
      "The configuration file is too large to edit here."
    )
  }
  const real = await realpath(candidate)
  if (!insideRoot(real, root)) {
    throw new AgentConfigError(
      403,
      "outside_root",
      "That configuration file resolves outside the allowed scope."
    )
  }
  const buffer = await readFile(real)
  if (buffer.byteLength > maxBytes) {
    throw new AgentConfigError(
      413,
      "too_large",
      "The configuration file is too large to edit here."
    )
  }
  const text = buffer.toString("utf8")
  // Reject files that are not valid UTF-8; editing them would lose bytes.
  if (!Buffer.from(text, "utf8").equals(buffer)) {
    throw new AgentConfigError(
      409,
      "not_text",
      "The configuration file is not valid UTF-8, so it was not edited."
    )
  }
  return {
    text,
    hash: hashBytes(buffer),
    mode: entry.mode & 0o777,
    path: real,
  }
}

async function writeAtomic(
  root: string,
  target: string,
  text: string,
  mode: number
): Promise<void> {
  const parent = dirname(target)
  const realParent = await realpath(parent)
  if (!insideRoot(realParent, root)) {
    throw new AgentConfigError(
      403,
      "outside_root",
      "That configuration path resolves outside the allowed scope."
    )
  }
  const temp = join(
    realParent,
    `.${basename(target)}.${randomUUID()}.tmp`
  )
  // Create the temporary file private first; only the final renamed file
  // receives the existing mode. A crash cannot leave a group/world-readable
  // temporary copy of configuration values.
  const handle = await open(temp, "wx", 0o600)
  try {
    await handle.writeFile(text, "utf8")
    await handle.chmod(mode)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(temp).catch(() => {})
    throw error
  }
  await handle.close()
  try {
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  // Best-effort directory sync so the rename is durable.
  try {
    const directory = await open(realParent, "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch {
    // Atomic rename already succeeded; directory fsync is best-effort.
  }
}

/**
 * Primary agents first, then subagents, hidden last, then id. Shared by the
 * local merge and the remote catalog so both present agents in the same order.
 */
function compareAgentEntries(
  a: AgentConfigEntry,
  b: AgentConfigEntry
): number {
  const aSource = a.source ? 1 : 0
  const bSource = b.source ? 1 : 0
  if (aSource !== bSource) return bSource - aSource
  const aMode = a.effective?.mode ?? a.source?.values.mode ?? "primary"
  const bMode = b.effective?.mode ?? b.source?.values.mode ?? "primary"
  if (aMode !== bMode) return aMode === "primary" ? -1 : 1
  const aHidden = a.effective?.hidden ?? a.source?.values.hidden ?? false
  const bHidden = b.effective?.hidden ?? b.source?.values.hidden ?? false
  if (aHidden !== bHidden) return aHidden ? 1 : -1
  return a.id.localeCompare(b.id)
}

const locks = new Map<string, Promise<unknown>>()

async function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(run)
  locks.set(key, next)
  try {
    return await next
  } finally {
    if (locks.get(key) === next) locks.delete(key)
  }
}

export function createAgentConfigService(
  options: AgentConfigServiceOptions = {}
) {
  const staticBaseUrl = (options.opencodeBaseUrl ?? "http://127.0.0.1:8090").replace(
    /\/+$/,
    ""
  )
  const staticAuthorization = options.authorization
  const resolveTarget = () => {
    if (!options.getTarget) {
      return {
        baseUrl: staticBaseUrl,
        authorization: staticAuthorization,
        isRemote: false,
      }
    }
    // Read the selected connection on every call; never cache it. A switch to
    // (or away from) a remote engine must be visible to the very next request.
    const current = options.getTarget()
    return {
      baseUrl: current.opencodeBaseUrl.replace(/\/+$/, ""),
      authorization: current.authorization,
      isRemote: current.isRemote === true,
    }
  }
  const isRemoteTarget = () => resolveTarget().isRemote === true
  const fetchImpl = options.fetch ?? globalThis.fetch
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const maxFileBytes = options.maxFileBytes ?? AGENT_CONFIG_MAX_FILE_BYTES
  const maxBodyBytes = options.maxBodyBytes ?? AGENT_CONFIG_MAX_BODY_BYTES

  async function fetchJson(path: string): Promise<unknown> {
    if (!fetchImpl) {
      throw new AgentConfigError(
        503,
        "unavailable",
        "The native OpenCode catalog is unavailable."
      )
    }
    const { baseUrl, authorization } = resolveTarget()
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        headers: authorization ? { authorization } : {},
        // Never forward the selected engine's credential to a redirect target or proxy.
        redirect: "manual",
        proxy: false,
        signal: AbortSignal.timeout(10_000),
      } as RequestInit)
    } catch {
      throw new AgentConfigError(
        503,
        "unavailable",
        "The native OpenCode catalog is unavailable."
      )
    }
    if (!response.ok) {
      throw new AgentConfigError(
        503,
        "unavailable",
        "The native OpenCode catalog is unavailable."
      )
    }
    try {
      return await response.json()
    } catch {
      throw new AgentConfigError(
        503,
        "unavailable",
        "The native OpenCode catalog returned an invalid response."
      )
    }
  }

  async function loadProjects(): Promise<ProjectSummary[]> {
    const body = await fetchJson("/api/project")
    const rows = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.data)
        ? body.data
        : []
    return rows.flatMap((row) => {
      if (
        !isRecord(row) ||
        typeof row.id !== "string" ||
        typeof row.canonical !== "string" ||
        !isAbsolute(row.canonical)
      ) {
        return []
      }
      return [
        {
          id: row.id,
          name:
            typeof row.name === "string" && row.name.trim()
              ? row.name
              : row.id,
          canonical: row.canonical,
        },
      ]
    })
  }

  async function resolveProject(
    projectID: string
  ): Promise<ProjectSummary> {
    if (!PROJECT_ID.test(projectID)) {
      throw new AgentConfigError(400, "invalid_project", "The project ID is invalid.")
    }
    const projects = await loadProjects()
    const project = projects.find((candidate) => candidate.id === projectID)
    if (!project) {
      throw new AgentConfigError(
        404,
        "project_not_found",
        "That project is not in the native project catalog."
      )
    }
    return project
  }

  async function resolveProjectRoot(project: ProjectSummary): Promise<string> {
    let projectStat
    try {
      projectStat = await stat(project.canonical)
    } catch (error) {
      if (isNotFound(error)) {
        throw new AgentConfigError(
          409,
          "project_unavailable",
          "The project folder is unavailable."
        )
      }
      throw new AgentConfigError(
        500,
        "project_unavailable",
        "The project folder could not be read."
      )
    }
    if (!projectStat.isDirectory()) {
      throw new AgentConfigError(
        409,
        "project_unavailable",
        "The project path is not a directory."
      )
    }
    return realpath(project.canonical)
  }

  async function resolveChildDir(
    parent: string,
    name: string,
    create: boolean
  ): Promise<{ path: string; exists: boolean }> {
    const candidate = join(parent, name)
    try {
      const entry = await lstat(candidate)
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new AgentConfigError(
          409,
          "unsafe_directory",
          "That configuration directory is not a regular directory."
        )
      }
      const real = await realpath(candidate)
      if (!insideRoot(real, parent)) {
        throw new AgentConfigError(
          403,
          "outside_root",
          "That configuration directory resolves outside the allowed scope."
        )
      }
      return { path: real, exists: true }
    } catch (error) {
      if (!isNotFound(error)) throw error
      if (!create) return { path: candidate, exists: false }
      await mkdir(candidate, { mode: 0o700 })
      const real = await realpath(candidate)
      if (!insideRoot(real, parent)) {
        throw new AgentConfigError(
          403,
          "outside_root",
          "That configuration directory resolves outside the allowed scope."
        )
      }
      return { path: real, exists: true }
    }
  }

  async function resolveGlobalRoot(
    create: boolean
  ): Promise<{ path: string; exists: boolean }> {
    const configured = resolveAgentConfigDirectory(env, home)
    try {
      const entry = await stat(configured)
      if (!entry.isDirectory()) {
        throw new AgentConfigError(
          409,
          "unsafe_directory",
          "The global configuration path is not a directory."
        )
      }
      return { path: await realpath(configured), exists: true }
    } catch (error) {
      if (!isNotFound(error)) throw error
      if (!create) return { path: configured, exists: false }
      await mkdir(configured, { recursive: true, mode: 0o700 })
      return { path: await realpath(configured), exists: true }
    }
  }

  async function resolveScope(
    scope: AgentConfigScope,
    projectID: string | null,
    create: boolean
  ): Promise<ScopeRoot> {
    let project: ProjectSummary | null = null
    if (projectID) {
      try {
        project = await resolveProject(projectID)
      } catch (error) {
        if (scope === "project") throw error
        // Global editing remains usable when the project catalog is
        // unavailable; the native catalog warning is reported separately.
      }
    }
    if (scope === "project") {
      if (!project) {
        throw new AgentConfigError(
          400,
          "project_required",
          "Select a project before editing project agent configuration."
        )
      }
      const projectRoot = await resolveProjectRoot(project)
      const root = await resolveChildDir(projectRoot, ".opencode", create)
      return {
        scope,
        root: root.path,
        rootExists: root.exists,
        label: "Project .opencode",
        project,
      }
    }
    const root = await resolveGlobalRoot(create)
    return {
      scope,
      root: root.path,
      rootExists: root.exists,
      label: "Global",
      project,
    }
  }

  function addScan(
    target: Map<string, ScannedAgent>,
    id: string,
    source: AgentConfigSource,
    readonly: boolean,
    warnings: string[],
    permissionsReadOnly = false
  ) {
    target.set(id, {
      id,
      source,
      readonly,
      permissionsReadOnly,
      warnings,
    })
  }

  async function scanJsonFiles(
    scopeRoot: ScopeRoot,
    scanWarnings: string[]
  ): Promise<{
    files: Map<string, ScanFile>
    sources: Map<string, ScannedAgent>
  }> {
    const files = new Map<string, ScanFile>()
    const sources = new Map<string, ScannedAgent>()

    for (const relativePath of JSON_CONFIG_NAMES) {
      let file: Awaited<ReturnType<typeof readTextFile>>
      try {
        file = await readTextFile(
          scopeRoot.root,
          relativePath,
          maxFileBytes
        )
      } catch {
        files.set(relativePath, {
          relativePath,
          source: defaultJsoncSource(
            scopeRoot.label,
            relativePath,
            true,
            null
          ),
          valid: false,
        })
        scanWarnings.push(
          `${scopeRoot.label} ${relativePath} is not safely editable and was skipped.`
        )
        continue
      }
      if (!file) continue

      const errors: ParseError[] = []
      const parsed = parseJsonc(file.text, errors, {
        allowTrailingComma: true,
      })
      const base: AgentConfigSource = {
        kind: "jsonc",
        relativePath,
        label: `${scopeRoot.label} ${relativePath}`,
        exists: true,
        hash: file.hash,
        values: {},
      }
      if (errors.length > 0 || !isRecord(parsed)) {
        files.set(relativePath, {
          relativePath,
          source: base,
          valid: false,
        })
        scanWarnings.push(
          `${scopeRoot.label} ${relativePath} is not valid JSONC and was not edited.`
        )
        continue
      }

      files.set(relativePath, {
        relativePath,
        source: base,
        valid: true,
      })

      const tree = parseTree(file.text, [])
      if (!Object.hasOwn(parsed, "agents")) continue
      if (!isRecord(parsed.agents)) {
        scanWarnings.push(
          `${scopeRoot.label} ${relativePath} has a non-object agents field; it was not edited.`
        )
        continue
      }
      for (const [id, value] of Object.entries(parsed.agents)) {
        if (!AGENT_ID.test(id) || !isRecord(value)) {
          scanWarnings.push(
            `${scopeRoot.label} ${relativePath} contains an agent entry that is not editable here.`
          )
          continue
        }
        const extracted = valuesFromRecord(value)
        const permissionsNode = tree
          ? findNodeAtLocation(tree, ["agents", id, "permissions"])
          : undefined
        const hasPermissionComments = permissionsNode
          ? hasJsoncComments(
              file.text,
              permissionsNode.offset,
              permissionsNode.offset + permissionsNode.length
            )
          : false
        const permissionsReadOnly =
          extracted.permissionsReadOnly || hasPermissionComments
        const warnings = [...extracted.warnings]
        if (permissionsReadOnly) {
          warnings.push(
            "Permission rules contain comments or fields that are read-only in this editor."
          )
        }
        addScan(
          sources,
          id,
          { ...base, values: extracted.values },
          false,
          warnings,
          permissionsReadOnly
        )
      }
    }

    return { files, sources }
  }

  async function scanMarkdownFiles(
    scopeRoot: ScopeRoot,
    dirs: readonly string[],
    readOnly: boolean,
    scanWarnings: string[]
  ): Promise<{ sources: Map<string, ScannedAgent>; blocked: boolean }> {
    const sources = new Map<string, ScannedAgent>()
    let blocked = false
    if (!scopeRoot.rootExists) return { sources, blocked }

    for (const dirName of dirs) {
      const relativeDir = dirName
      const directory = resolve(scopeRoot.root, relativeDir)
      if (!insideRoot(directory, scopeRoot.root)) continue
      let entry
      try {
        entry = await lstat(directory)
      } catch (error) {
        if (isNotFound(error)) continue
        throw error
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        blocked = true
        scanWarnings.push(
          `${scopeRoot.label} ${relativeDir} is not a regular directory and was skipped.`
        )
        continue
      }
      const realDirectory = await realpath(directory)
      if (!insideRoot(realDirectory, scopeRoot.root)) {
        blocked = true
        scanWarnings.push(
          `${scopeRoot.label} ${relativeDir} resolves outside the allowed scope and was skipped.`
        )
        continue
      }
      let names: string[]
      try {
        names = await readdir(realDirectory)
      } catch {
        blocked = true
        scanWarnings.push(
          `${scopeRoot.label} ${relativeDir} could not be read and was skipped.`
        )
        continue
      }
      names.sort()
      for (const name of names) {
        if (!name.endsWith(".md")) continue
        const id = name.slice(0, -3)
        if (!AGENT_ID.test(id)) continue
        const relativePath = `${relativeDir}/${name}`
        let file: Awaited<ReturnType<typeof readTextFile>>
        try {
          file = await readTextFile(
            scopeRoot.root,
            relativePath,
            maxFileBytes
          )
        } catch {
          addScan(
            sources,
            id,
            {
              kind: "markdown",
              relativePath,
              label: `${scopeRoot.label} ${relativePath}`,
              exists: true,
              hash: null,
              values: {},
            },
            true,
            ["This agent file is not safely editable here."],
            true
          )
          scanWarnings.push(
            `${scopeRoot.label} ${relativePath} is not safely editable and was skipped.`
          )
          continue
        }
        if (!file) continue
        const base: AgentConfigSource = {
          kind: "markdown",
          relativePath,
          label: `${scopeRoot.label} ${relativePath}`,
          exists: true,
          hash: file.hash,
          values: {},
        }
        const split = splitFrontmatter(file.text)
        if (!split) {
          scanWarnings.push(
            `${scopeRoot.label} ${relativePath} has no YAML frontmatter and was not edited.`
          )
          addScan(
            sources,
            id,
            base,
            true,
            ["This agent file has no YAML frontmatter and is read-only here."],
            true
          )
          continue
        }
        const parsed = valuesFromFrontmatter(split.frontmatter)
        if (!parsed.ok) {
          scanWarnings.push(
            `${scopeRoot.label} ${relativePath} has invalid frontmatter and was not edited.`
          )
          addScan(
            sources,
            id,
            base,
            true,
            ["This agent file has invalid frontmatter and is read-only here."],
            true
          )
          continue
        }
        const warnings = readOnly
          ? ["Legacy mode files are read-only here."]
          : []
        if (parsed.permissionsReadOnly) {
          warnings.push(
            "Permission rules contain comments or fields that are read-only in this editor."
          )
        }
        addScan(
          sources,
          id,
          { ...base, values: parsed.values },
          readOnly,
          warnings,
          readOnly || parsed.permissionsReadOnly
        )
      }
    }
    return { sources, blocked }
  }

  async function scanScope(scopeRoot: ScopeRoot): Promise<ScopeScan> {
    const warnings: string[] = []
    const json = await scanJsonFiles(scopeRoot, warnings)
    const markdown = await scanMarkdownFiles(
      scopeRoot,
      AGENT_DIRS,
      false,
      warnings
    )
    const legacy = await scanMarkdownFiles(
      scopeRoot,
      LEGACY_AGENT_DIRS,
      true,
      warnings
    )
    const markdownSources = markdown.sources
    const legacySources = legacy.sources

    const sources = new Map<string, ScannedAgent>()
    for (const [id, scanned] of json.sources) sources.set(id, scanned)
    for (const [id, scanned] of markdownSources) sources.set(id, scanned)
    // OpenCode scans mode/modes after agent/agents, so legacy mode files win.
    for (const [id, scanned] of legacySources) sources.set(id, scanned)

    const jsonc = json.files.get("opencode.jsonc")
    const jsonFile = json.files.get("opencode.json")
    let defaultJsonc: AgentConfigSource | null = null
    if (jsonc?.valid) {
      defaultJsonc = jsonc.source
    } else if (!jsonc && jsonFile?.valid) {
      defaultJsonc = jsonFile.source
    } else if (!jsonc && jsonFile && !jsonFile.valid) {
      defaultJsonc = null
      warnings.push(
        `${scopeRoot.label} opencode.json is invalid; no new override was prepared.`
      )
    } else if (!jsonc && !jsonFile) {
      defaultJsonc = defaultJsoncSource(
        scopeRoot.label,
        "opencode.jsonc",
        false,
        null
      )
    } else if (jsonc && !jsonc.valid) {
      defaultJsonc = null
      warnings.push(
        `${scopeRoot.label} opencode.jsonc is invalid; no new override was prepared.`
      )
    }
    if (markdown.blocked || legacy.blocked) {
      defaultJsonc = null
      warnings.push(
        `${scopeRoot.label} has agent files that could not be checked safely; no new override was prepared.`
      )
    }

    return {
      jsonFiles: json.files,
      jsonSources: json.sources,
      markdownSources,
      legacySources,
      sources,
      defaultJsonc,
      warnings,
    }
  }

  async function fetchAgents(
    project: ProjectSummary | null
  ): Promise<NativeAgent[]> {
    const query = project
      ? `?location[directory]=${encodeURIComponent(project.canonical)}`
      : ""
    const body = await fetchJson(`/api/agent${query}`)
    const rows = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.data)
        ? body.data
        : []
    return rows.flatMap((row) => {
      const agent = normalizeNativeAgent(row)
      return agent ? [agent] : []
    })
  }

  async function fetchConfigPaths(
    project: ProjectSummary | null
  ): Promise<string[]> {
    const query = project
      ? `?location[directory]=${encodeURIComponent(project.canonical)}`
      : ""
    const body = await fetchJson(`/api/config${query}`)
    const rows = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.data)
        ? body.data
        : []
    const paths = rows.flatMap((row) => {
      if (!isRecord(row) || typeof row.path !== "string") return []
      return [resolve(row.path)]
    })
    return Promise.all(
      paths.map(async (path) => {
        try {
          return await realpath(path)
        } catch {
          return path
        }
      })
    )
  }

  async function fetchModels(
    project: ProjectSummary | null
  ): Promise<NativeModel[]> {
    const query = project
      ? `?location[directory]=${encodeURIComponent(project.canonical)}`
      : ""
    const body = await fetchJson(`/api/model${query}`)
    const rows = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.data)
        ? body.data
        : []
    return rows.flatMap((row) => {
      const model = normalizeNativeModel(row)
      return model ? [model] : []
    })
  }

  function effectiveFromNative(agent: NativeAgent): AgentConfigEffective {
    return {
      model: agent.model,
      description: agent.description,
      mode: agent.mode,
      hidden: agent.hidden,
      steps: agent.steps,
      disabled: null,
    }
  }

  function mergeAgents(
    scopeRoot: ScopeRoot,
    scan: ScopeScan,
    nativeAgents: NativeAgent[]
  ): AgentConfigEntry[] {
    const entries = new Map<string, AgentConfigEntry>()
    for (const agent of nativeAgents) {
      if (!AGENT_ID.test(agent.id)) continue
      entries.set(agent.id, {
        id: agent.id,
        name: agent.name,
        effective: effectiveFromNative(agent),
        source: null,
        target: null,
        readonly: false,
        permissionsReadOnly: false,
        warnings: [],
      })
    }

    for (const [id, scanned] of scan.sources) {
      const existing = entries.get(id)
      const warnings = [...scanned.warnings]
      if (
        scan.jsonSources.has(id) &&
        scan.markdownSources.has(id) &&
        scan.markdownSources.get(id) === scanned
      ) {
        warnings.push(
          `${scan.jsonSources.get(id)?.source.label ?? "JSONC"} also defines this agent, but Markdown takes precedence.`
        )
      }
      if (scanned.readonly) {
        warnings.push("This source is read-only here; edit the file manually.")
      }
      entries.set(id, {
        id,
        name: existing?.name ?? id,
        effective: existing?.effective ?? null,
        source: scanned.source,
        target: scanned.readonly ? null : scanned.source,
        readonly: scanned.readonly,
        permissionsReadOnly:
          scanned.readonly || scanned.permissionsReadOnly,
        warnings,
      })
    }

    for (const entry of entries.values()) {
      if (entry.source) continue
      const target = scan.defaultJsonc
      if (!target) {
        entry.readonly = true
        entry.warnings.push(
          "No safe JSONC target is available for a new override."
        )
        continue
      }
      entry.target = target
      if (!target.exists) {
        entry.warnings.push(
          `Saving creates ${scopeRoot.label} ${target.relativePath}.`
        )
      }
    }

    return [...entries.values()].sort(compareAgentEntries)
  }

  async function buildCatalog(scopeRoot: ScopeRoot): Promise<CatalogBuild> {
    if (isRemoteTarget()) {
      // A remote engine owns the agent catalog. Never merge in agent files
      // from the machine running the UI: those belong to a different engine.
      // Also do not suppress a failed fetch — showing local files instead
      // would silently present the wrong engine's agents as current.
      let nativeAgents: NativeAgent[]
      try {
        nativeAgents = await fetchAgents(scopeRoot.project)
      } catch {
        throw new AgentConfigError(
          503,
          "remote_catalog_unavailable",
          "The remote engine's agent list could not be loaded."
        )
      }
      const agents = nativeAgents
        .filter((agent) => AGENT_ID.test(agent.id))
        .map((agent): AgentConfigEntry => ({
          id: agent.id,
          name: agent.name,
          effective: effectiveFromNative(agent),
          source: null,
          target: null,
          readonly: true,
          permissionsReadOnly: true,
          warnings: [],
        }))
        .sort(compareAgentEntries)
      return {
        nativeAvailable: true,
        catalog: {
          scope: scopeRoot.scope,
          project: scopeRoot.project
            ? { id: scopeRoot.project.id, name: scopeRoot.project.name }
            : null,
          sourceLabel: "Remote engine agents",
          remote: true,
          agents,
          warnings: [
            "Agents are provided by the selected remote engine and are read-only here. Edit them on that engine.",
          ],
        },
      }
    }
    const scan = await scanScope(scopeRoot)
    const warnings = [...scan.warnings]
    let nativeAgents: NativeAgent[] = []
    let nativeAvailable = false
    try {
      nativeAgents = await fetchAgents(scopeRoot.project)
      nativeAvailable = true
    } catch {
      warnings.push(
        "The native agent catalog is unavailable; showing editable file sources only."
      )
    }
    if (scopeRoot.rootExists) {
      try {
        const paths = await fetchConfigPaths(scopeRoot.project)
        const found = paths.some(
          (path) =>
            path === scopeRoot.root ||
            path.startsWith(`${scopeRoot.root}${sep}`)
        )
        if (!found) {
          warnings.push(
            scopeRoot.scope === "global"
              ? "The engine did not report this global config directory among its loaded sources. If OPENCODE_CONFIG_DIR or XDG_CONFIG_HOME differs for the app server, a global edit may not apply."
              : "The engine did not report this project's .opencode directory among its loaded sources. A newly created directory or disabled project config may require the native /reload action."
          )
        }
      } catch {
        warnings.push(
          "The engine's config source list could not be verified for this scope."
        )
      }
    }
    const sourceLabel =
      scopeRoot.scope === "project"
        ? "Project .opencode configuration"
        : "Global configuration"
    return {
      nativeAvailable,
      catalog: {
        scope: scopeRoot.scope,
        project: scopeRoot.project
          ? { id: scopeRoot.project.id, name: scopeRoot.project.name }
          : null,
        sourceLabel,
        agents: mergeAgents(scopeRoot, scan, nativeAgents),
        warnings,
      },
    }
  }

  function validateTarget(
    scopeRoot: ScopeRoot,
    agentID: string,
    target: {
      kind: AgentConfigSourceKind
      relativePath: string
    }
  ): string {
    const relativePath = safeRelativePath(target.relativePath)
    if (!relativePath) {
      throw new AgentConfigError(
        400,
        "invalid_target",
        "The configuration target is invalid."
      )
    }
    if (target.kind === "jsonc") {
      if (!(JSON_CONFIG_NAMES as readonly string[]).includes(relativePath)) {
        throw new AgentConfigError(
          400,
          "invalid_target",
          "Only the scope's opencode.json or opencode.jsonc may be edited."
        )
      }
    } else if (target.kind === "markdown") {
      const match = /^(agent|agents)\/([^/]+)\.md$/.exec(relativePath)
      if (!match || match[2] !== agentID) {
        throw new AgentConfigError(
          400,
          "invalid_target",
          "That Markdown agent target is invalid."
        )
      }
    } else {
      throw new AgentConfigError(
        400,
        "invalid_target",
        "The configuration target kind is invalid."
      )
    }
    const absolute = resolve(scopeRoot.root, relativePath)
    if (!insideRoot(absolute, scopeRoot.root)) {
      throw new AgentConfigError(
        403,
        "outside_root",
        "That configuration target is outside the allowed scope."
      )
    }
    return absolute
  }

  async function getCatalog(url: URL): Promise<Response> {
    const scope = url.searchParams.get("scope")
    if (scope !== "global" && scope !== "project") {
      throw new AgentConfigError(
        400,
        "invalid_scope",
        "Choose the global or project scope."
      )
    }
    const projectID = url.searchParams.get("projectID")
    if (projectID && !PROJECT_ID.test(projectID)) {
      throw new AgentConfigError(400, "invalid_project", "The project ID is invalid.")
    }
    const scopeRoot = await resolveScope(scope, projectID || null, false)
    const { catalog } = await buildCatalog(scopeRoot)
    return jsonResponse(200, catalog)
  }

  async function putCatalog(request: Request): Promise<Response> {
    const contentType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase()
    if (
      contentType !== "application/json" &&
      !contentType?.endsWith("+json")
    ) {
      throw new AgentConfigError(
        415,
        "content_type",
        "Agent configuration mutations must use JSON."
      )
    }
    let body: unknown
    try {
      const text = await request.text()
      if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
        throw new AgentConfigError(
          413,
          "too_large",
          "The request is too large."
        )
      }
      body = JSON.parse(text)
    } catch (error) {
      if (error instanceof AgentConfigError) throw error
      throw new AgentConfigError(400, "invalid_json", "The request is not valid JSON.")
    }
    if (!isRecord(body)) {
      throw new AgentConfigError(400, "invalid_request", "The request is invalid.")
    }

    const scope = body.scope
    if (scope !== "global" && scope !== "project") {
      throw new AgentConfigError(
        400,
        "invalid_scope",
        "Choose the global or project scope."
      )
    }
    const projectID =
      typeof body.projectID === "string" && body.projectID
        ? body.projectID
        : null
    if (projectID && !PROJECT_ID.test(projectID)) {
      throw new AgentConfigError(400, "invalid_project", "The project ID is invalid.")
    }
    const agentID = body.agentID
    if (typeof agentID !== "string" || !AGENT_ID.test(agentID)) {
      throw new AgentConfigError(400, "invalid_agent", "The agent ID is invalid.")
    }
    if (!isRecord(body.target)) {
      throw new AgentConfigError(400, "invalid_target", "The target is invalid.")
    }
    const targetKind = body.target.kind
    const targetPath = body.target.relativePath
    if (
      (targetKind !== "jsonc" && targetKind !== "markdown") ||
      typeof targetPath !== "string"
    ) {
      throw new AgentConfigError(400, "invalid_target", "The target is invalid.")
    }
    const expectedHash = body.expectedHash
    if (
      expectedHash !== null &&
      (typeof expectedHash !== "string" || !HASH.test(expectedHash))
    ) {
      throw new AgentConfigError(
        400,
        "invalid_hash",
        "The expected file revision is invalid."
      )
    }
    const patch = validatePatch(body.patch)

    const readScopeRoot = await resolveScope(scope, projectID, false)
    const { catalog, nativeAvailable } = await buildCatalog(readScopeRoot)
    const entry = catalog.agents.find((candidate) => candidate.id === agentID)
    if (!entry) {
      if (!nativeAvailable) {
        throw new AgentConfigError(
          503,
          "catalog_unavailable",
          "The native agent catalog is unavailable."
        )
      }
      throw new AgentConfigError(404, "agent_not_found", "That agent was not found.")
    }
    if (!entry.target || entry.readonly) {
      throw new AgentConfigError(
        409,
        "read_only",
        "That agent source is read-only in this editor."
      )
    }
    if (
      entry.target.kind !== targetKind ||
      entry.target.relativePath !== targetPath
    ) {
      throw new AgentConfigError(
        409,
        "target_changed",
        "The configuration source changed. Refresh and try again."
      )
    }
    if (patch.permissions !== undefined && entry.permissionsReadOnly) {
      throw new AgentConfigError(
        409,
        "permissions_read_only",
        "This source's permission rules contain comments or fields that cannot be safely preserved. Other fields can still be saved."
      )
    }

    if (patch.model) {
      let models: NativeModel[]
      try {
        models = await fetchModels(readScopeRoot.project)
      } catch {
        throw new AgentConfigError(
          503,
          "model_catalog_unavailable",
          "The model catalog is unavailable, so the model was not changed."
        )
      }
      const model = models.find(
        (candidate) =>
          candidate.providerID === patch.model?.providerID &&
          candidate.id === patch.model?.id
      )
      if (
        !model ||
        (patch.model.variant !== undefined &&
          !model.variants.includes(patch.model.variant))
      ) {
        throw new AgentConfigError(
          400,
          "invalid_model",
          "That model is not in the native catalog."
        )
      }
    }

    const scopeRoot = await resolveScope(scope, projectID, true)
    const absoluteTarget = validateTarget(scopeRoot, agentID, {
      kind: targetKind,
      relativePath: targetPath,
    })

    return withLock(absoluteTarget, async () => {
      const current = await readTextFile(
        scopeRoot.root,
        targetPath,
        maxFileBytes
      )
      if (current) {
        if (expectedHash !== current.hash) {
          throw new AgentConfigError(
            409,
            "conflict",
            "This configuration file changed on disk. Refresh and reapply your changes."
          )
        }
      } else if (expectedHash !== null) {
        throw new AgentConfigError(
          409,
          "conflict",
          "This configuration file changed on disk. Refresh and reapply your changes."
        )
      }
      if (!current && targetKind === "markdown") {
        throw new AgentConfigError(
          409,
          "conflict",
          "This agent file is no longer present. Refresh and try again."
        )
      }

      const before = current?.text ?? createNewJsoncText()
      const after =
        targetKind === "jsonc"
          ? updateJsonc(before, agentID, patch)
          : updateMarkdown(before, patch)
      if (Buffer.byteLength(after, "utf8") > maxFileBytes) {
        throw new AgentConfigError(
          413,
          "too_large",
          "The edited configuration would be too large to save here."
        )
      }
      if (after === before) {
        const hash = current?.hash ?? hashBytes(after)
        return jsonResponse(200, {
          source: {
            kind: targetKind,
            relativePath: targetPath,
            label: entry.target?.label ?? targetPath,
          },
          hash,
          unchanged: true,
          warnings: entry.warnings,
        } satisfies AgentConfigUpdateResult)
      }

      // Narrow the lost-update window: another process may have replaced the
      // file while the patch was being prepared. Do not rename over it.
      const latest = await readTextFile(
        scopeRoot.root,
        targetPath,
        maxFileBytes
      )
      if ((latest?.hash ?? null) !== (current?.hash ?? null)) {
        throw new AgentConfigError(
          409,
          "conflict",
          "This configuration file changed on disk. Refresh and reapply your changes."
        )
      }
      const mode = current?.mode || 0o600
      await writeAtomic(scopeRoot.root, absoluteTarget, after, mode)
      return jsonResponse(200, {
        source: {
          kind: targetKind,
          relativePath: targetPath,
          label: entry.target?.label ?? targetPath,
        },
        hash: hashBytes(after),
        unchanged: false,
        warnings: entry.warnings,
      } satisfies AgentConfigUpdateResult)
    })
  }

  async function deleteAgent(request: Request): Promise<Response> {
    const contentType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      ?.toLowerCase()
    if (
      contentType !== "application/json" &&
      !contentType?.endsWith("+json")
    ) {
      throw new AgentConfigError(
        415,
        "content_type",
        "Agent configuration mutations must use JSON."
      )
    }
    let body: unknown
    try {
      const text = await request.text()
      if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
        throw new AgentConfigError(
          413,
          "too_large",
          "The request is too large."
        )
      }
      body = JSON.parse(text)
    } catch (error) {
      if (error instanceof AgentConfigError) throw error
      throw new AgentConfigError(400, "invalid_json", "The request is not valid JSON.")
    }
    if (!isRecord(body)) {
      throw new AgentConfigError(400, "invalid_request", "The request is invalid.")
    }
    const scope = body.scope
    if (scope !== "global" && scope !== "project") {
      throw new AgentConfigError(
        400,
        "invalid_scope",
        "Choose the global or project scope."
      )
    }
    const projectID =
      typeof body.projectID === "string" && body.projectID
        ? body.projectID
        : null
    if (projectID && !PROJECT_ID.test(projectID)) {
      throw new AgentConfigError(400, "invalid_project", "The project ID is invalid.")
    }
    const agentID = body.agentID
    if (typeof agentID !== "string" || !AGENT_ID.test(agentID)) {
      throw new AgentConfigError(400, "invalid_agent", "The agent ID is invalid.")
    }
    const expectedHash = body.expectedHash
    if (
      expectedHash !== null &&
      (typeof expectedHash !== "string" || !HASH.test(expectedHash))
    ) {
      throw new AgentConfigError(
        400,
        "invalid_hash",
        "The expected file revision is invalid."
      )
    }

    const scopeRoot = await resolveScope(scope, projectID, false)
    const { catalog } = await buildCatalog(scopeRoot)
    const entry = catalog.agents.find((candidate) => candidate.id === agentID)
    if (!entry) {
      throw new AgentConfigError(404, "agent_not_found", "That agent was not found.")
    }
    if (!entry.source) {
      throw new AgentConfigError(
        409,
        "built_in",
        "This agent is built in and has no definition to delete. Disable it instead."
      )
    }
    if (entry.readonly) {
      throw new AgentConfigError(
        409,
        "read_only",
        "That agent source is read-only in this editor."
      )
    }
    const source = entry.source
    const absoluteTarget = validateTarget(scopeRoot, agentID, {
      kind: source.kind,
      relativePath: source.relativePath,
    })

    return withLock(absoluteTarget, async () => {
      const current = await readTextFile(
        scopeRoot.root,
        source.relativePath,
        maxFileBytes
      )
      if (!current) {
        throw new AgentConfigError(
          409,
          "conflict",
          "This agent definition no longer exists."
        )
      }
      if (expectedHash !== null && expectedHash !== current.hash) {
        throw new AgentConfigError(
          409,
          "conflict",
          "This definition changed on disk. Refresh and try again."
        )
      }
      if (source.kind === "markdown") {
        await unlink(absoluteTarget)
      } else {
        const after = removeJsoncAgent(current.text, agentID)
        if (after === current.text) {
          throw new AgentConfigError(
            409,
            "agent_not_found",
            "That agent entry is no longer in this file."
          )
        }
        const latest = await readTextFile(
          scopeRoot.root,
          source.relativePath,
          maxFileBytes
        )
        if ((latest?.hash ?? null) !== current.hash) {
          throw new AgentConfigError(
            409,
            "conflict",
            "This definition changed on disk. Refresh and try again."
          )
        }
        await writeAtomic(scopeRoot.root, absoluteTarget, after, current.mode)
      }
      return jsonResponse(200, {
        agentID,
        warnings: entry.warnings,
      } satisfies AgentConfigDeleteResult)
    })
  }

  async function putDefaultAgent(request: Request): Promise<Response> {
    const contentType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      ?.toLowerCase()
    if (
      contentType !== "application/json" &&
      !contentType?.endsWith("+json")
    ) {
      throw new AgentConfigError(
        415,
        "content_type",
        "Agent configuration mutations must use JSON."
      )
    }
    let body: unknown
    try {
      const text = await request.text()
      if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
        throw new AgentConfigError(
          413,
          "too_large",
          "The request is too large."
        )
      }
      body = JSON.parse(text)
    } catch (error) {
      if (error instanceof AgentConfigError) throw error
      throw new AgentConfigError(400, "invalid_json", "The request is not valid JSON.")
    }
    if (!isRecord(body)) {
      throw new AgentConfigError(400, "invalid_request", "The request is invalid.")
    }
    if (body.scope !== "global") {
      throw new AgentConfigError(
        400,
        "invalid_scope",
        "The default agent is configured in the global scope only."
      )
    }
    const agentID = body.agentID
    if (typeof agentID !== "string" || !AGENT_ID.test(agentID)) {
      throw new AgentConfigError(400, "invalid_agent", "The agent ID is invalid.")
    }

    let nativeAgents: NativeAgent[]
    try {
      nativeAgents = await fetchAgents(null)
    } catch {
      throw new AgentConfigError(
        503,
        "catalog_unavailable",
        "The native agent catalog is unavailable."
      )
    }
    const target = nativeAgents.find((agent) => agent.id === agentID)
    if (!target) {
      throw new AgentConfigError(404, "agent_not_found", "That agent was not found.")
    }
    if (target.mode === "subagent" || target.hidden) {
      throw new AgentConfigError(
        400,
        "invalid_default",
        "The default agent must be a visible primary agent."
      )
    }

    const scopeRoot = await resolveScope("global", null, true)

    let relativePath: string = JSON_CONFIG_NAMES[1] as string
    let current = await readTextFile(scopeRoot.root, relativePath, maxFileBytes)
    if (!current) {
      const json = await readTextFile(
        scopeRoot.root,
        JSON_CONFIG_NAMES[0] as string,
        maxFileBytes
      )
      if (json) {
        relativePath = JSON_CONFIG_NAMES[0] as string
        current = json
      }
    }
    const absoluteTarget = resolve(scopeRoot.root, relativePath)

    return withLock(absoluteTarget, async () => {
      const latest = current
        ? await readTextFile(scopeRoot.root, relativePath, maxFileBytes)
        : null
      if (current && (latest?.hash ?? null) !== current.hash) {
        throw new AgentConfigError(
          409,
          "conflict",
          "The configuration file changed on disk. Refresh and try again."
        )
      }
      const before = latest?.text ?? createNewJsoncText()
      const after = updateDefaultAgent(before, agentID)
      if (Buffer.byteLength(after, "utf8") > maxFileBytes) {
        throw new AgentConfigError(
          413,
          "too_large",
          "The edited configuration would be too large to save here."
        )
      }
      const unchanged = after === before
      if (!unchanged) {
        const fresh = await readTextFile(scopeRoot.root, relativePath, maxFileBytes)
        if ((fresh?.hash ?? null) !== (latest?.hash ?? null)) {
          throw new AgentConfigError(
            409,
            "conflict",
            "The configuration file changed on disk. Refresh and try again."
          )
        }
        const mode = latest?.mode || 0o600
        await writeAtomic(scopeRoot.root, absoluteTarget, after, mode)
      }
      return jsonResponse(200, {
        agentID,
        unchanged,
        warnings: [],
      } satisfies AgentConfigDefaultResult)
    })
  }

  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const isDefault = url.pathname === AGENT_CONFIG_DEFAULT_ROUTE
    if (url.pathname !== AGENT_CONFIG_ROUTE && !isDefault) {
      return jsonResponse(404, {
        error: { code: "not_found", message: "Agent configuration route not found." },
      })
    }
    // A remote engine owns its configuration files. Reject every mutation
    // here, centrally, so putCatalog, deleteAgent and the default route can
    // never write files on the machine running the UI. Reads stay available.
    if (
      isRemoteTarget() &&
      (request.method === "PUT" || request.method === "DELETE")
    ) {
      return errorResponse(
        new AgentConfigError(
          403,
          "remote_read_only",
          "Agent configuration is read-only for a remote engine. Edit it on that engine."
        )
      )
    }
    if (request.method === "GET") {
      if (isDefault) {
        return jsonResponse(405, {
          error: { code: "method_not_allowed", message: "Method not allowed." },
        })
      }
      try {
        return await getCatalog(url)
      } catch (error) {
        return errorResponse(error)
      }
    }
    if (request.method === "PUT") {
      try {
        return isDefault ? await putDefaultAgent(request) : await putCatalog(request)
      } catch (error) {
        return errorResponse(error)
      }
    }
    if (request.method === "DELETE") {
      if (isDefault) {
        return jsonResponse(405, {
          error: { code: "method_not_allowed", message: "Method not allowed." },
        })
      }
      try {
        return await deleteAgent(request)
      } catch (error) {
        return errorResponse(error)
      }
    }
    return jsonResponse(405, {
      error: { code: "method_not_allowed", message: "Method not allowed." },
    })
  }

  return {
    handleRequest,
    maxBodyBytes,
  }
}

export type AgentConfigService = ReturnType<typeof createAgentConfigService>

function headersFromNode(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (typeof value === "string") {
      headers.set(key, value)
    }
  }
  return headers
}

async function readNodeBody(
  request: IncomingMessage,
  limit: number
): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    total += buffer.byteLength
    if (total > limit) throw new Error("body too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function createAgentConfigMiddleware(
  service: AgentConfigService
) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void
  ) => {
    const pathname = new URL(request.url ?? "/", "http://local").pathname
    if (pathname !== AGENT_CONFIG_ROUTE) {
      next()
      return
    }
    void (async () => {
      try {
        const body =
          request.method === "PUT"
            ? await readNodeBody(request, service.maxBodyBytes)
            : undefined
        const webRequest = new Request(
          `http://${request.headers.host ?? "127.0.0.1"}${request.url ?? "/"}`,
          {
            method: request.method,
            headers: headersFromNode(request),
            ...(body && body.byteLength > 0
              ? { body, duplex: "half" as const }
              : {}),
          }
        )
        const webResponse = await service.handleRequest(webRequest)
        response.statusCode = webResponse.status
        webResponse.headers.forEach((value, key) =>
          response.setHeader(key, value)
        )
        response.end(await webResponse.text())
      } catch (error) {
        const tooLarge =
          error instanceof Error && error.message === "body too large"
        if (!response.headersSent) {
          response.statusCode = tooLarge ? 413 : 500
          response.setHeader("content-type", "application/json; charset=utf-8")
          response.setHeader("cache-control", "private, no-store")
        }
        response.end(
          JSON.stringify({
            error: {
              code: tooLarge ? "too_large" : "internal",
              message: tooLarge
                ? "The request is too large."
                : "The agent configuration request failed.",
            },
          })
        )
      }
    })()
  }
}
