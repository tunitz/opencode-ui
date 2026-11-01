import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  InfoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AgentConfigRequestError,
  agentConfigModelFromKey,
  fetchAgentConfigCatalog,
  saveAgentConfig,
} from "@/lib/agent-config"
import {
  AGENT_CONFIG_PERMISSION_ACTIONS,
  AGENT_CONFIG_PERMISSION_EFFECTS,
  agentConfigModelKey,
  type AgentConfigCatalog,
  type AgentConfigEffective,
  type AgentConfigEntry,
  type AgentConfigPatch,
  type AgentConfigPermissionRule,
  type AgentConfigSource,
} from "@/lib/agent-config-types"
import { recordPerfRender } from "@/lib/perf-probe"
import {
  modelKey,
  selectableModels,
  variantsForModel,
} from "@/lib/session-selection"
import type { OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"

const INHERIT = "__inherit__"

type DraftPermissionRule = AgentConfigPermissionRule & { key: string }

type Draft = {
  model: string
  description: string
  mode: string
  hidden: string
  steps: string
  disabled: string
  permissions: DraftPermissionRule[]
}

let permissionKeySequence = 0
function nextPermissionKey(): string {
  permissionKeySequence += 1
  return `permission-rule-${permissionKeySequence}`
}

type PendingChange =
  | { kind: "agent"; agentID: string }
  | { kind: "reload" }

const EMPTY_DRAFT: Draft = {
  model: INHERIT,
  description: "",
  mode: INHERIT,
  hidden: INHERIT,
  steps: "",
  disabled: INHERIT,
  permissions: [],
}

type Option = {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

function draftFromSource(source: AgentConfigSource | null): Draft {
  const values = source?.values ?? {}
  return {
    model: values.model ? agentConfigModelKey(values.model) : INHERIT,
    description: values.description ?? "",
    mode: values.mode ?? INHERIT,
    hidden:
      values.hidden === undefined || values.hidden === null
        ? INHERIT
        : String(values.hidden),
    steps:
      values.steps === undefined || values.steps === null
        ? ""
        : String(values.steps),
    disabled:
      values.disabled === undefined || values.disabled === null
        ? INHERIT
        : String(values.disabled),
    permissions: (values.permissions ?? []).map((rule) => ({
      ...rule,
      key: nextPermissionKey(),
    })),
  }
}

function modelBase(model: string): string {
  const hash = model.indexOf("#")
  return hash === -1 ? model : model.slice(0, hash)
}

function modelVariant(model: string): string {
  const hash = model.indexOf("#")
  return hash === -1 ? "" : model.slice(hash + 1)
}

function valueText(value: unknown): string {
  if (value === undefined || value === null) return INHERIT
  return String(value)
}

function permissionEffectLabel(
  effect: AgentConfigPermissionRule["effect"]
): string {
  return effect === "allow" ? "Allow" : effect === "deny" ? "Deny" : "Ask"
}

function permissionEffectClass(
  effect: AgentConfigPermissionRule["effect"]
): string {
  return effect === "allow"
    ? "text-diff-added"
    : effect === "deny"
      ? "text-diff-removed"
      : "text-muted-foreground"
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

function buildPatch(
  source: AgentConfigSource | null,
  draft: Draft,
  permissionsReadOnly: boolean
): { patch: AgentConfigPatch; error: null } | { patch: null; error: string } {
  const values = source?.values ?? {}
  const patch: AgentConfigPatch = {}
  const sourceModel = values.model
    ? agentConfigModelKey(values.model)
    : INHERIT
  if (draft.model !== sourceModel) {
    if (draft.model === INHERIT) {
      patch.model = null
    } else {
      const model = agentConfigModelFromKey(draft.model)
      if (!model) {
        return { patch: null, error: "Choose a valid model." }
      }
      patch.model = model
    }
  }

  if (draft.description !== (values.description ?? "")) {
    const description = draft.description.trim()
    patch.description = description || null
  }

  if (draft.mode !== (values.mode ?? INHERIT)) {
    patch.mode =
      draft.mode === INHERIT
        ? null
        : (draft.mode as AgentConfigPatch["mode"])
  }

  const sourceHidden = valueText(values.hidden)
  if (draft.hidden !== sourceHidden) {
    patch.hidden =
      draft.hidden === INHERIT ? null : draft.hidden === "true"
  }

  const sourceSteps =
    values.steps === undefined || values.steps === null
      ? ""
      : String(values.steps)
  if (draft.steps !== sourceSteps) {
    if (!draft.steps) {
      patch.steps = null
    } else {
      const steps = Number(draft.steps)
      if (!Number.isSafeInteger(steps) || steps < 0) {
        return { patch: null, error: "Steps must be a whole number of 0 or more." }
      }
      patch.steps = steps
    }
  }

  const sourceDisabled = valueText(values.disabled)
  if (draft.disabled !== sourceDisabled) {
    patch.disabled =
      draft.disabled === INHERIT ? null : draft.disabled === "true"
  }

  if (!permissionsReadOnly) {
    const sourceRules = values.permissions ?? []
    const draftRules = draft.permissions.map(
      ({ action, resource, effect }) => ({ action, resource, effect })
    )
    for (const [index, rule] of draftRules.entries()) {
      if (!rule.action.trim() || !rule.resource.trim()) {
        return {
          patch: null,
          error: `Rule ${index + 1}: ${!rule.action.trim() ? "Action" : "Resource"} is required.`,
        }
      }
    }
    if (!permissionRulesEqual(sourceRules, draftRules)) {
      patch.permissions = draftRules.length > 0 ? draftRules : null
    }
  }

  return { patch, error: null }
}

function AgentSettingSelect({
  label,
  description,
  value,
  options,
  disabled,
  busy,
  onValueChange,
}: {
  label: string
  description?: string
  value: string
  options: Option[]
  disabled?: boolean
  busy?: boolean
  onValueChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next)
        }}
        disabled={disabled || busy}
        modal={false}
      >
        <SelectTrigger
          aria-label={label}
          className="h-11! w-full min-w-0 px-2.5 text-[14px]"
        >
          <SelectValue className="min-w-0">
            {(selected: string | null) => {
              const option = options.find((item) => item.value === selected)
              return (
                <span className="min-w-0 truncate">
                  {option?.detail && label === "Model"
                    ? option.detail
                    : (option?.label ?? "Unavailable")}
                </span>
              )
            }}
          </SelectValue>
          {busy ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin text-muted-foreground"
            />
          ) : null}
        </SelectTrigger>
        <SelectContent
          align="start"
          sideOffset={6}
          className="max-w-[min(26rem,calc(100vw-2rem))]"
        >
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="min-h-11 py-2 ps-2"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] leading-5 whitespace-normal">
                  {option.label}
                </span>
                {option.detail ? (
                  <span
                    dir="ltr"
                    className="text-[11px] break-all text-muted-foreground"
                  >
                    {option.detail}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function effectiveLabel(
  effective: AgentConfigEffective | null,
  source: AgentConfigSource | null
): string {
  if (!effective && source?.values.disabled) {
    return "Disabled; not in the active engine catalog"
  }
  const model = effective?.model ?? source?.values.model ?? null
  const parts: string[] = []
  parts.push(model ? agentConfigModelKey(model) : "Backend default model")
  if (effective) {
    parts.push(effective.mode)
    if (effective.hidden) parts.push("hidden")
    if (effective.steps !== null) parts.push(`${effective.steps} steps`)
  } else if (source?.values.mode) {
    parts.push(source.values.mode)
  }
  return parts.join(" · ")
}

function sourceLabel(entry: AgentConfigEntry): string {
  if (entry.source) return entry.source.label
  if (entry.target) {
    return `No ${entry.readonly ? "" : "scope "}override; ${entry.target.label}`
  }
  return "No editable source"
}

export function AgentConfigSettings({
  nav,
  active,
  onDirtyChange,
}: {
  nav: OpenCodeController
  active: boolean
  onDirtyChange?: (dirty: boolean) => void
}) {
  recordPerfRender("AgentConfigSettings")
  const [catalog, setCatalog] = useState<AgentConfigCatalog | null>(null)
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const requestRef = useRef(0)
  const catalogRef = useRef<AgentConfigCatalog | null>(null)
  const dirtyRef = useRef(false)
  const wasActiveRef = useRef(active)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setCatalogError(null)
    try {
      const next = await fetchAgentConfigCatalog({
        scope: "global",
        projectID: null,
      })
      if (request !== requestRef.current) return
      setCatalog(next)
      setSelectedID((current) =>
        current && next.agents.some((agent) => agent.id === current)
          ? current
          : (next.agents[0]?.id ?? null)
      )
    } catch (error) {
      if (request !== requestRef.current) return
      setCatalog(null)
      setCatalogError(
        error instanceof AgentConfigRequestError
          ? error.message
          : "Agent configuration could not be loaded."
      )
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  // Sync the ref used by the activation gate below in an effect (never during
  // render). Declared before the gate so a catalog update and an activation in
  // the same commit observe the new catalog.
  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current
    wasActiveRef.current = active
    if (!active) return
    if (becameActive && dirtyRef.current && catalogRef.current) {
      return
    }
    void load()
  }, [active, load])

  const selected =
    catalog?.agents.find((agent) => agent.id === selectedID) ??
    catalog?.agents[0] ??
    null
  const source = selected?.source ?? null
  const selectedKey = selected
    ? `${selected.id}:${selected.source?.hash ?? ""}:${selected.target?.hash ?? ""}:${selected.target?.relativePath ?? ""}`
    : ""

  useEffect(() => {
    // A new selected source identity intentionally resets the editor state.
    // Source refreshes with the same identity must not clobber the draft, so
    // this effect is keyed by `selectedKey` rather than the source object.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(draftFromSource(source))
    setSaveError(null)
    setAdvancedOpen(false)
    setExpandedRuleKey(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const models = useMemo(() => selectableModels(nav.models), [nav.models])
  const sourceModel = source?.values.model ?? null
  const sourceModelKey = agentConfigModelKey(sourceModel)
  const base = modelBase(draft.model)
  const variant = modelVariant(draft.model)
  const selectedModelInfo =
    models.find((model) => modelKey(model) === base) ?? null
  const variantIds = variantsForModel(selectedModelInfo)
  const modelOptions: Option[] = [
    { value: INHERIT, label: "Inherit / remove model override" },
    ...(sourceModelKey &&
    !models.some((model) => modelKey(model) === modelBase(sourceModelKey))
      ? [
          {
            value: modelBase(sourceModelKey),
            label: `${modelBase(sourceModelKey)} (unavailable)`,
          },
        ]
      : []),
    ...models.map((model) => ({
      value: modelKey(model),
      label: model.id,
      detail: `${model.providerID}/${model.id}`,
    })),
  ]
  const variantOptions: Option[] = [
    { value: INHERIT, label: "Default variant" },
    ...variantIds.map((id) => ({ value: id, label: id })),
  ]
  if (variant && !variantIds.includes(variant)) {
    variantOptions.push({
      value: variant,
      label: `${variant} (unavailable)`,
    })
  }

  const permissionsReadOnly = Boolean(selected?.permissionsReadOnly)
  const patchResult = useMemo(
    () => buildPatch(source, draft, permissionsReadOnly),
    [draft, permissionsReadOnly, source]
  )
  const patch = patchResult.error === null ? patchResult.patch : null
  const invalidRuleIndex = !permissionsReadOnly
    ? draft.permissions.findIndex((rule) => !rule.action.trim() || !rule.resource.trim())
    : -1
  const invalidSteps = draft.steps !== (source?.values.steps == null ? "" : String(source.values.steps)) &&
    draft.steps !== "" && (!Number.isSafeInteger(Number(draft.steps)) || Number(draft.steps) < 0)
  const dirty = patch !== null && Object.keys(patch).length > 0
  const hasUnsavedDraft = dirty || patchResult.error !== null
  const modelBusy = nav.modelsStatus === "loading"
  const selectedReadonly = Boolean(selected?.readonly || !selected?.target)
  const sourceStepsValue = source?.values.steps
  const sourceStepsText =
    sourceStepsValue === undefined || sourceStepsValue === null
      ? ""
      : String(sourceStepsValue)
  const advancedConfigured =
    source?.values.description !== undefined ||
    source?.values.mode !== undefined ||
    source?.values.hidden !== undefined ||
    source?.values.steps !== undefined ||
    source?.values.disabled !== undefined
  const advancedDirty =
    draft.description !== (source?.values.description ?? "") ||
    draft.mode !== (source?.values.mode ?? INHERIT) ||
    draft.hidden !== valueText(source?.values.hidden) ||
    draft.steps !== sourceStepsText ||
    draft.disabled !== valueText(source?.values.disabled)
  const permissionCounts = draft.permissions.reduce(
    (counts, rule) => {
      counts[rule.effect] += 1
      return counts
    },
    { ask: 0, allow: 0, deny: 0 }
  )

  useEffect(() => {
    dirtyRef.current = hasUnsavedDraft
    onDirtyChange?.(hasUnsavedDraft)
  }, [hasUnsavedDraft, onDirtyChange])

  const permissionEditingDisabled =
    Boolean(selectedReadonly) || permissionsReadOnly

  function applyAgent(next: string) {
    setSelectedID(next)
    setStatus(null)
    setSaveError(null)
    setPendingChange(null)
    setExpandedRuleKey(null)
    setAdvancedOpen(false)
  }

  function requestAgentChange(next: string) {
    if (next === selected?.id) return
    if (hasUnsavedDraft) {
      setPendingChange({ kind: "agent", agentID: next })
      return
    }
    applyAgent(next)
  }

  function requestReload() {
    if (hasUnsavedDraft) {
      setPendingChange({ kind: "reload" })
      return
    }
    setStatus(null)
    void load()
  }

  function confirmPendingChange() {
    const change = pendingChange
    setPendingChange(null)
    if (!change) return
    if (change.kind === "agent") {
      applyAgent(change.agentID)
      return
    }
    setDraft(draftFromSource(source))
    setExpandedRuleKey(null)
    setAdvancedOpen(false)
    setSaveError(null)
    setStatus(null)
    void load()
  }

  function updatePermissionRule(
    index: number,
    patch: Partial<AgentConfigPermissionRule>
  ) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule
      ),
    }))
    setStatus(null)
  }

  function addPermissionRule() {
    const key = nextPermissionKey()
    setExpandedRuleKey(key)
    setDraft((current) => ({
      ...current,
      permissions: [
        ...current.permissions,
        {
          key,
          action: "",
          resource: "*",
          effect: "ask",
        },
      ],
    }))
    setStatus(null)
  }

  function removePermissionRule(index: number) {
    const removed = draft.permissions[index]
    if (removed && removed.key === expandedRuleKey) {
      setExpandedRuleKey(null)
    }
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.filter(
        (_rule, ruleIndex) => ruleIndex !== index
      ),
    }))
    setStatus(null)
  }

  function movePermissionRule(index: number, offset: -1 | 1) {
    setDraft((current) => {
      const target = index + offset
      if (target < 0 || target >= current.permissions.length) return current
      const permissions = [...current.permissions]
      const [rule] = permissions.splice(index, 1)
      if (!rule) return current
      permissions.splice(target, 0, rule)
      return { ...current, permissions }
    })
    setStatus(null)
  }

  async function handleSave() {
    if (!selected || !selected.target || selectedReadonly) return
    if (!patch) {
      setSaveError(patchResult.error ?? "The changes are invalid.")
      return
    }
    if (Object.keys(patch).length === 0) {
      setStatus("No changes to save.")
      return
    }
    setBusy(true)
    setSaveError(null)
    setStatus(null)
    try {
      const result = await saveAgentConfig({
        scope: "global",
        projectID: null,
        agentID: selected.id,
        target: {
          kind: selected.target.kind,
          relativePath: selected.target.relativePath,
        },
        expectedHash: selected.target.hash,
        patch,
      })
      setStatus(
        result.unchanged
          ? "No file change was needed."
          : "Saved. OpenCode normally reloads watched config automatically; this editor never triggers a live reload."
      )
      await load()
    } catch (error) {
      setSaveError(
        error instanceof AgentConfigRequestError
          ? error.message
          : "Agent configuration could not be saved."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-1 pb-2">
      <FieldGroup>
        {loading ? (
          <p
            role="status"
            className="flex items-center gap-2 text-[12px] text-muted-foreground"
          >
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-4 animate-spin"
            />
            Loading agent configuration…
          </p>
        ) : null}

        {catalogError ? (
          <div className="space-y-2">
            <p role="alert" className="text-xs break-words text-destructive">
              {catalogError}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => void load()}
            >
              <RefreshCwIcon aria-hidden="true" className="size-4" />
              Retry
            </Button>
          </div>
        ) : null}

        {catalog && catalog.warnings.length > 0 ? (
          <details className="group rounded-lg border border-border bg-muted/20">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-muted-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
              <span>Configuration notes ({catalog.warnings.length})</span>
              <ChevronDownIcon
                aria-hidden="true"
                className="ms-auto size-4 shrink-0 transition-transform group-open:rotate-180 motion-safe:transition-transform"
              />
            </summary>
            <ul className="space-y-1 border-t border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {catalog.warnings.map((warning) => (
                <li key={warning} className="break-words">
                  {warning}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {catalog && catalog.agents.length === 0 && !loading ? (
          <p className="text-xs text-muted-foreground">
            No agents are available in the global catalog.
          </p>
        ) : null}

        {selected ? (
          <>
            <AgentSettingSelect
              label="Agent"
              value={selected.id}
              busy={busy}
              options={catalog?.agents.map((agent) => ({
                value: agent.id,
                label: agent.id,
                detail: sourceLabel(agent),
              })) ?? []}
              onValueChange={requestAgentChange}
              description="Existing agents from the engine catalog or its global source."
            />

            <div className="rounded-xl border border-border bg-background/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="text-[14px] font-medium">
                  {selected.id}
                </span>
                {selected.effective?.mode ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {selected.effective.mode}
                  </span>
                ) : null}
                {(selected.effective
                  ? selected.effective.hidden
                  : selected.source?.values.hidden) ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    hidden
                  </span>
                ) : null}
                {selected.source?.values.disabled ||
                selected.effective?.disabled ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    disabled
                  </span>
                ) : null}
                {selected.readonly ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    source read-only
                  </span>
                ) : null}
                {permissionsReadOnly ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    permission rules read-only
                  </span>
                ) : null}
                <span className="ms-auto text-[11px] text-muted-foreground">
                  {source?.kind === "markdown"
                    ? "Markdown frontmatter"
                    : source?.kind === "jsonc"
                      ? "JSONC"
                      : selected.target?.kind === "markdown"
                        ? "Markdown frontmatter"
                        : "JSONC"}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px] leading-5">
                <dt className="text-muted-foreground">Source</dt>
                <dd dir="auto" className="min-w-0 break-words">
                  {sourceLabel(selected)}
                </dd>
                <dt className="text-muted-foreground">Effective here</dt>
                <dd dir="auto" className="min-w-0 break-words">
                  {effectiveLabel(selected.effective, source)}
                </dd>
              </dl>
              {selected.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px] leading-5 text-muted-foreground">
                  {selected.warnings.map((warning) => (
                    <li key={warning} className="break-words">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {selectedReadonly ? (
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-[12px] leading-5 text-muted-foreground">
                This agent source is read-only here. Edit the file manually, or
                choose an agent whose source is editable in the global scope.
              </p>
            ) : null}

            <fieldset disabled={busy} className="min-w-0 space-y-4">
            <FieldGroup>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-medium">Model & thinking</h3>
                <span className="text-[11px] text-muted-foreground">
                  Inherit or override
                </span>
              </div>
              <AgentSettingSelect
                label="Model"
                value={base}
                options={modelOptions}
                disabled={
                  busy || selectedReadonly || nav.modelsStatus !== "ready"
                }
                busy={modelBusy}
                onValueChange={(value) => {
                  setDraft((current) => ({ ...current, model: value }))
                  setStatus(null)
                }}
                description={
                  nav.modelsStatus === "error"
                    ? "The model catalog is unavailable; model changes are disabled. Other fields can still be saved."
                    : nav.modelsStatus === "ready"
                      ? "Inherit removes the model override. The engine falls back to the agent or provider default."
                      : "Loading the model catalog; other fields can still be saved."
                }
              />
              <AgentSettingSelect
                label="Thinking Level"
                value={variant || INHERIT}
                options={variantOptions}
                disabled={
                  busy || selectedReadonly ||
                  base === INHERIT ||
                  variantIds.length === 0
                }
                onValueChange={(value) => {
                  const nextVariant = value === INHERIT ? "" : value
                  setDraft((current) => ({
                    ...current,
                    model: nextVariant ? `${base}#${nextVariant}` : base,
                  }))
                  setStatus(null)
                }}
                description="Only variants exposed by the selected model are offered."
              />
              <Collapsible
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
                className="rounded-xl border border-border"
              >
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-between rounded-xl px-3 py-2.5 text-start hover:bg-muted/50"
                    />
                  }
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] font-medium">
                      Advanced agent settings
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Description, mode, visibility, steps, state
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {advancedDirty ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        Unsaved
                      </span>
                    ) : advancedConfigured ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        Configured
                      </span>
                    ) : null}
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 text-muted-foreground motion-safe:transition-transform",
                        advancedOpen && "rotate-180"
                      )}
                    />
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border p-3">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="agent-config-description">
                        Description
                      </FieldLabel>
                      <Input
                        id="agent-config-description"
                        value={draft.description}
                        disabled={busy || selectedReadonly}
                        onChange={(event) => {
                          const value = event.target.value
                          setDraft((current) => ({
                            ...current,
                            description: value,
                          }))
                          setStatus(null)
                        }}
                        placeholder="Optional short description"
                        className="h-11! text-[14px]"
                      />
                      <FieldDescription>
                        Blank removes the description override.
                      </FieldDescription>
                    </Field>
                    <AgentSettingSelect
                      label="Mode"
                      value={draft.mode}
                      options={[
                        { value: INHERIT, label: "Inherit / remove override" },
                        { value: "primary", label: "Primary" },
                        { value: "subagent", label: "Subagent" },
                        { value: "all", label: "Primary and subagent" },
                      ]}
                      disabled={busy || selectedReadonly}
                      onValueChange={(value) => {
                        setDraft((current) => ({ ...current, mode: value }))
                        setStatus(null)
                      }}
                    />
                    <AgentSettingSelect
                      label="Visibility"
                      value={draft.hidden}
                      options={[
                        { value: INHERIT, label: "Inherit / remove override" },
                        { value: "false", label: "Visible" },
                        { value: "true", label: "Hidden from primary picker" },
                      ]}
                      disabled={busy || selectedReadonly}
                      onValueChange={(value) => {
                        setDraft((current) => ({ ...current, hidden: value }))
                        setStatus(null)
                      }}
                    />
                    <Field>
                      <FieldLabel htmlFor="agent-config-steps">Steps</FieldLabel>
                      <Input
                        id="agent-config-steps"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={draft.steps}
                        disabled={busy || selectedReadonly}
                        aria-invalid={invalidSteps || undefined}
                        aria-describedby={invalidSteps ? "agent-config-steps-error" : undefined}
                        onChange={(event) => {
                          const value = event.target.value
                          setDraft((current) => ({ ...current, steps: value }))
                          setStatus(null)
                        }}
                        placeholder="Inherit"
                        className="h-11! text-[14px]"
                      />
                      <FieldDescription>
                        A whole number of 0 or more. Blank removes the override.
                      </FieldDescription>
                      {invalidSteps ? <p id="agent-config-steps-error" className="text-xs text-destructive">Steps must be a whole number of 0 or more.</p> : null}
                    </Field>
                    <AgentSettingSelect
                      label="Agent state"
                      value={draft.disabled}
                      options={[
                        { value: INHERIT, label: "Inherit / remove override" },
                        { value: "false", label: "Enabled" },
                        { value: "true", label: "Disabled" },
                      ]}
                      disabled={busy || selectedReadonly}
                      onValueChange={(value) => {
                        setDraft((current) => ({ ...current, disabled: value }))
                        setStatus(null)
                      }}
                      description="Disabling removes the agent from the active catalog. Sessions that already reference it may be affected."
                    />
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            </FieldGroup>

            <section className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium">Tool access</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Agent-level permission rules
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {draft.permissions.length}{" "}
                  {draft.permissions.length === 1 ? "rule" : "rules"}
                  {draft.permissions.length > 0
                    ? ` · ${permissionCounts.allow} allow · ${permissionCounts.deny} deny · ${permissionCounts.ask} ask`
                    : ""}
                </span>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Rules apply in order; the last matching rule wins. No match
                falls back to ask. Allow/deny here only changes this agent&apos;s
                source rules; policies, instructions, tool exposure, and
                provider/auth can still block or avoid a tool.
              </p>

              <Collapsible
                open={helpOpen}
                onOpenChange={setHelpOpen}
                className="rounded-lg border border-border bg-muted/20"
              >
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-between rounded-lg px-3 py-2 text-start hover:bg-muted/50"
                    />
                  }
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <InfoIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="text-[12px]">Rule syntax & limits</span>
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
                      helpOpen && "rotate-180"
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 border-t border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  <p>Actions name tools, including custom plugin and MCP actions. Resources are commands or paths; <code>*</code> matches any sequence and <code>?</code> one character. Shell matches raw command text; path actions expand <code>~</code>/<code>$HOME</code>.</p>
                  <p>New rules are appended. These are source rules, not the merged engine ruleset. A broad <code>shell</code> + <code>*</code> + <code>allow</code> permits arbitrary commands within the limits of other policies and tool availability.</p>
                </CollapsibleContent>
              </Collapsible>

              {permissionsReadOnly ? (
                <p
                  role="note"
                  className="rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] leading-5 text-muted-foreground"
                >
                  This source&apos;s permission rules contain comments or
                  unknown fields that cannot be safely preserved here, so they
                  are read-only. Edit this file manually to change them.{" "}
                  {selectedReadonly
                    ? "This whole source is read-only here."
                    : "Other fields can still be saved."}
                </p>
              ) : null}

              {draft.permissions.length === 0 ? (
                <p className="text-[11px] leading-5 text-muted-foreground">
                  No agent-specific permission rules. No matching rule defaults
                  to ask.
                </p>
              ) : (
                <ol className="space-y-2">
                  {draft.permissions.map((rule, index) => {
                    const expanded = expandedRuleKey === rule.key
                    const editable = !permissionEditingDisabled
                    const summary = (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {index + 1}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium",
                            permissionEffectClass(rule.effect)
                          )}
                        >
                          {permissionEffectLabel(rule.effect)}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span
                            dir="ltr"
                            className="break-all font-mono text-[12px]"
                          >
                            {rule.action || "action needed"}
                          </span>
                          <span
                            dir="ltr"
                            className="break-all font-mono text-[11px] text-muted-foreground"
                          >
                            {rule.resource || "resource needed"}
                          </span>
                        </span>
                      </span>
                    )

                    return (
                      <li
                        key={rule.key}
                        className="rounded-lg border border-border bg-background/60"
                      >
                        {editable ? (
                          <Collapsible
                            open={expanded}
                            onOpenChange={(open) =>
                              setExpandedRuleKey(open ? rule.key : null)
                            }
                          >
                            <CollapsibleTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="flex h-auto min-h-11 w-full justify-between gap-2 rounded-lg px-2.5 py-2 text-start whitespace-normal hover:bg-muted/50"
                                />
                              }
                            >
                              {summary}
                              <ChevronDownIcon
                                aria-hidden="true"
                                className={cn(
                                  "ms-2 size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
                                  expanded && "rotate-180"
                                )}
                              />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="border-t border-border p-3">
                              <FieldGroup>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`agent-permission-action-${index}`}
                                  >
                                    Action
                                  </FieldLabel>
                                  <Input
                                    id={`agent-permission-action-${index}`}
                                    list="agent-permission-actions"
                                    value={rule.action}
                                    aria-invalid={!rule.action.trim() || undefined}
                                    aria-describedby={!rule.action.trim() ? `agent-permission-action-error-${index}` : undefined}
                                    onChange={(event) =>
                                      updatePermissionRule(index, {
                                        action: event.target.value,
                                      })
                                    }
                                    placeholder="shell"
                                    className="h-11! font-mono text-[14px]"
                                    dir="ltr"
                                  />
                                  <FieldDescription>
                                    Tool or action name. Custom plugin/MCP
                                    actions are allowed.
                                  </FieldDescription>
                                  {!rule.action.trim() ? <p id={`agent-permission-action-error-${index}`} className="text-xs text-destructive">Action is required.</p> : null}
                                </Field>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`agent-permission-resource-${index}`}
                                  >
                                    Resource
                                  </FieldLabel>
                                  <Input
                                    id={`agent-permission-resource-${index}`}
                                    value={rule.resource}
                                    aria-invalid={!rule.resource.trim() || undefined}
                                    aria-describedby={!rule.resource.trim() ? `agent-permission-resource-error-${index}` : undefined}
                                    onChange={(event) =>
                                      updatePermissionRule(index, {
                                        resource: event.target.value,
                                      })
                                    }
                                    placeholder="*"
                                    className="h-11! font-mono text-[14px]"
                                    dir="ltr"
                                  />
                                  <FieldDescription>
                                    Command, path, or wildcard pattern. Use the
                                    syntax guide above for examples.
                                  </FieldDescription>
                                  {!rule.resource.trim() ? <p id={`agent-permission-resource-error-${index}`} className="text-xs text-destructive">Resource is required.</p> : null}
                                </Field>
                                <AgentSettingSelect
                                  label="Effect"
                                  disabled={busy}
                                  value={rule.effect}
                                  options={AGENT_CONFIG_PERMISSION_EFFECTS.map(
                                    (effect) => ({
                                      value: effect,
                                      label: permissionEffectLabel(effect),
                                    })
                                  )}
                                  onValueChange={(value) =>
                                    updatePermissionRule(index, {
                                      effect:
                                        value as AgentConfigPermissionRule["effect"],
                                    })
                                  }
                                />
                              </FieldGroup>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-11 min-w-28 flex-1"
                                  disabled={index === 0}
                                  onClick={() => movePermissionRule(index, -1)}
                                >
                                  <ArrowUpIcon
                                    aria-hidden="true"
                                    className="size-4"
                                  />
                                  Move up
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-11 min-w-28 flex-1"
                                  disabled={
                                    index === draft.permissions.length - 1
                                  }
                                  onClick={() => movePermissionRule(index, 1)}
                                >
                                  <ArrowDownIcon
                                    aria-hidden="true"
                                    className="size-4"
                                  />
                                  Move down
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-11 min-w-28 flex-1 text-destructive"
                                  onClick={() => removePermissionRule(index)}
                                >
                                  <Trash2Icon
                                    aria-hidden="true"
                                    className="size-4"
                                  />
                                  Remove
                                </Button>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ) : (
                          <div className="flex min-h-11 items-start px-2.5 py-2">
                            {summary}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}

              {!permissionEditingDisabled ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  onClick={addPermissionRule}
                >
                  Add permission rule
                </Button>
              ) : null}
              <datalist id="agent-permission-actions">
                {AGENT_CONFIG_PERMISSION_ACTIONS.map((action) => (
                  <option key={action} value={action} />
                ))}
              </datalist>
            </section>
            </fieldset>

            <div className="sticky bottom-0 z-10 -mx-1 mt-3 space-y-2 border-t border-border bg-background/95 px-1 py-2 backdrop-blur-sm">
              {patchResult.error ? (
                <p
                  role="alert"
                  className="text-xs break-words text-destructive"
                >
                  {patchResult.error}
                  {(invalidSteps && patchResult.error.startsWith("Steps")) || (invalidRuleIndex >= 0 && patchResult.error.startsWith("Rule")) ? (
                    <button
                      type="button"
                      className="ms-2 underline"
                      onClick={() => {
                        const isStepsError = patchResult.error?.startsWith("Steps")
                        const id = isStepsError ? "agent-config-steps" :
                          `agent-permission-${draft.permissions[invalidRuleIndex]?.action.trim() ? "resource" : "action"}-${invalidRuleIndex}`
                        if (isStepsError) setAdvancedOpen(true)
                        else setExpandedRuleKey(draft.permissions[invalidRuleIndex]?.key ?? null)
                        requestAnimationFrame(() => document.getElementById(id)?.focus())
                      }}
                    >
                      Go to field
                    </button>
                  ) : null}
                </p>
              ) : null}
              {saveError ? (
                <p
                  role="alert"
                  className="text-xs break-words text-destructive"
                >
                  {saveError}
                </p>
              ) : null}
              {status ? (
                <p
                  role="status"
                  className="text-[12px] leading-5 break-words text-muted-foreground"
                >
                  {status}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {patchResult.error
                    ? "Unsaved changes need attention"
                    : hasUnsavedDraft
                      ? "Unsaved changes"
                      : selectedReadonly
                        ? "Read-only source"
                        : "No unsaved changes"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="h-11 min-w-28 flex-1 sm:flex-none"
                    disabled={
                      !dirty ||
                      busy ||
                      selectedReadonly ||
                      Boolean(patchResult.error)
                    }
                    onClick={() => void handleSave()}
                  >
                    {busy ? (
                      <LoaderCircleIcon
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                    ) : null}
                    Save changes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 min-w-28 flex-1 sm:flex-none"
                    disabled={busy || !hasUnsavedDraft}
                    onClick={() => {
                      setDraft(draftFromSource(source))
                      setExpandedRuleKey(null)
                      setSaveError(null)
                      setStatus(null)
                    }}
                  >
                    Discard changes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 min-w-28 flex-1 sm:flex-none"
                    disabled={busy || loading}
                    onClick={requestReload}
                  >
                    <RefreshCwIcon aria-hidden="true" className="size-4" />
                    Reload
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </FieldGroup>

      <AlertDialog
        open={pendingChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingChange(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingChange?.kind === "agent"
                ? `Selecting another agent will discard unsaved edits for ${selected?.id ?? "the current agent"}.`
                : "Reloading will replace unsaved edits with the file's current content."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={confirmPendingChange}
            >
              Discard and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
