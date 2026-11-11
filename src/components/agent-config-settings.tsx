import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
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
  Accordion,
} from "@/components/ui/accordion"
import { AccordionSection } from "@/components/ui/accordion-section"
import { PickerSelect } from "@/components/ui/picker-select"
import {
  AgentConfigRequestError,
  agentConfigModelFromKey,
  deleteAgentDefinition,
  fetchAgentConfigCatalog,
  saveAgentConfig,
  saveDefaultAgent,
} from "@/lib/agent-config"
import {
  agentModelLabel,
  groupedAgents,
  type AgentGroup,
} from "@/lib/agent-list"
import {
  AGENT_CONFIG_PERMISSION_ACTIONS,
  AGENT_CONFIG_PERMISSION_EFFECTS,
  agentConfigModelKey,
  type AgentConfigCatalog,
  type AgentConfigPatch,
  type AgentConfigPermissionRule,
  type AgentConfigSource,
  type AgentConfigValues,
} from "@/lib/agent-config-types"
import { recordPerfRender } from "@/lib/perf-probe"
import {
  effectiveDefaultAgent,
  modelKey,
  selectableModels,
  variantsForModel,
} from "@/lib/session-selection"
import type { OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"

const INHERIT = "__inherit__"
const AUTOSAVE_DELAY_MS = 600

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
  values: AgentConfigValues,
  draft: Draft,
  permissionsReadOnly: boolean
): { patch: AgentConfigPatch; error: null } | { patch: null; error: string } {
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

function applyPatchToValues(
  values: AgentConfigValues,
  patch: AgentConfigPatch
): AgentConfigValues {
  const next: Record<string, unknown> = { ...values }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next as AgentConfigValues
}

function AgentSettingSelect({
  label,
  value,
  options,
  disabled,
  busy,
  onValueChange,
}: {
  label: string
  value: string
  options: Option[]
  disabled?: boolean
  busy?: boolean
  onValueChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <PickerSelect
        label={label}
        value={value}
        options={options}
        disabled={disabled || busy}
        busy={busy}
        showDetail={label === "Model"}
        onValueChange={onValueChange}
        triggerClassName="px-2.5 text-[14px]"
      />
    </Field>
  )
}

const GROUP_LABELS: Record<AgentGroup, string> = {
  primary: "Primary agents",
  subagents: "Subagents",
  hidden: "Hidden",
}

function AgentList({
  catalog,
  defaultAgentID,
  busy,
  onSelect,
}: {
  catalog: AgentConfigCatalog
  defaultAgentID: string | null
  busy: boolean
  onSelect: (id: string) => void
}) {
  const groups = groupedAgents(catalog.agents).filter(
    ({ agents }) => agents.length > 0
  )
  return (
    <Accordion
      multiple
      defaultValue={groups.map(({ group }) => group)}
      className="space-y-2"
    >
      {groups.map(({ group, agents }) => (
        <AccordionSection
          key={group}
          value={group}
          title={GROUP_LABELS[group]}
          count={agents.length}
        >
          <ul className="space-y-1">
            {agents.map((agent) => {
              const model =
                agent.effective?.model ?? agent.source?.values.model ?? null
              const description = agent.effective?.description ?? ""
              const isDefault = agent.id === defaultAgentID
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-start hover:bg-accent focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                    onClick={() => onSelect(agent.id)}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[14px] font-medium">
                        {agent.name && agent.name !== agent.id
                          ? agent.name
                          : agent.id}
                      </span>
                      {isDefault ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          default
                        </span>
                      ) : null}
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="ms-auto size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                      />
                    </span>
                    {description ? (
                      <span className="w-full truncate text-[12px] text-muted-foreground">
                        {description}
                      </span>
                    ) : null}
                    <span
                      dir="ltr"
                      className="w-full truncate font-mono text-[11px] text-muted-foreground"
                    >
                      {agentModelLabel(model)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </AccordionSection>
      ))}
    </Accordion>
  )
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
  const [view, setView] = useState<"list" | "detail">("list")
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState<AgentConfigValues>({})
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [openSection, setOpenSection] = useState<
    "model" | "agent" | "permissions" | null
  >("model")
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null)
  const requestRef = useRef(0)
  const catalogRef = useRef<AgentConfigCatalog | null>(null)
  const wasActiveRef = useRef(active)
  const hashRef = useRef<string | null>(null)
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePromiseRef = useRef<Promise<boolean> | null>(null)

  const load = useCallback(async (expectAbsent?: string) => {
    const request = ++requestRef.current
    setLoading(true)
    setCatalogError(null)
    try {
      const next = await fetchAgentConfigCatalog({
        scope: "global",
        projectID: null,
      })
      if (request !== requestRef.current) return
      const catalogNext = expectAbsent
        ? { ...next, agents: next.agents.filter((agent) => agent.id !== expectAbsent) }
        : next
      setCatalog(catalogNext)
      setSelectedID((current) =>
        current && catalogNext.agents.some((agent) => agent.id === current)
          ? current
          : (catalogNext.agents[0]?.id ?? null)
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

  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current
    wasActiveRef.current = active
    if (!active) return
    if (becameActive && catalogRef.current) return
    void load()
  }, [active, load])

  const selected =
    catalog?.agents.find((agent) => agent.id === selectedID) ??
    catalog?.agents[0] ??
    null
  const source = selected?.source ?? null
  const defaultAgentID = useMemo(
    () => effectiveDefaultAgent(nav.agents, nav.configEntries),
    [nav.agents, nav.configEntries]
  )
  const isDefaultAgent = Boolean(selected && defaultAgentID === selected.id)
  const canMakeDefault = Boolean(
    selected &&
      selected.effective?.mode === "primary" &&
      !selected.effective?.hidden
  )
  const selectedKey = selected
    ? `${selected.id}:${selected.source?.hash ?? ""}:${selected.target?.hash ?? ""}:${selected.target?.relativePath ?? ""}`
    : ""

  useEffect(() => {
    // A new selected source identity intentionally resets the editor state.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(draftFromSource(source))
    setBaseline(source?.values ?? {})
    hashRef.current = selected?.target?.hash ?? null
    setSaveError(null)
    setSaveState("idle")
    setOpenSection("model")
    setExpandedRuleKey(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  useEffect(() => {
    baselineRef.current = baseline
  }, [baseline])

  const models = useMemo(() => selectableModels(nav.models), [nav.models])
  const baselineModel = baseline.model ?? null
  const baselineModelKey = agentConfigModelKey(baselineModel)
  const base = modelBase(draft.model)
  const variant = modelVariant(draft.model)
  const selectedModelInfo =
    models.find((model) => modelKey(model) === base) ?? null
  const variantIds = variantsForModel(selectedModelInfo)
  const modelOptions: Option[] = [
    { value: INHERIT, label: "Inherit / remove model override" },
    ...(baselineModelKey &&
    !models.some((model) => modelKey(model) === modelBase(baselineModelKey))
      ? [
          {
            value: modelBase(baselineModelKey),
            label: `${modelBase(baselineModelKey)} (unavailable)`,
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
    () => buildPatch(baseline, draft, permissionsReadOnly),
    [baseline, draft, permissionsReadOnly]
  )
  const patch = patchResult.error === null ? patchResult.patch : null
  const invalidSteps =
    draft.steps !==
      (baseline.steps === undefined || baseline.steps === null
        ? ""
        : String(baseline.steps)) &&
    draft.steps !== "" &&
    (!Number.isSafeInteger(Number(draft.steps)) || Number(draft.steps) < 0)
  const modelBusy = nav.modelsStatus === "loading"
  const selectedReadonly = Boolean(selected?.readonly || !selected?.target)
  const deletable = Boolean(selected?.source && !selected.readonly)
  const permissionEditingDisabled =
    Boolean(selectedReadonly) || permissionsReadOnly
  const hasPendingPatch = Boolean(
    patch && Object.keys(patch).length > 0 && !patchResult.error
  )
  const saving = saveState === "saving"

  useEffect(() => {
    onDirtyChange?.(hasPendingPatch || saving)
  }, [hasPendingPatch, saving, onDirtyChange])

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!selected?.target || selectedReadonly) return true
    if (savePromiseRef.current) await savePromiseRef.current
    const result = buildPatch(
      baselineRef.current,
      draftRef.current,
      permissionsReadOnly
    )
    if (result.error || !result.patch) return true
    if (Object.keys(result.patch).length === 0) return true
    const run = (async () => {
      setSaveState("saving")
      setSaveError(null)
      try {
        const response = await saveAgentConfig({
          scope: "global",
          projectID: null,
          agentID: selected.id,
          target: {
            kind: selected.target!.kind,
            relativePath: selected.target!.relativePath,
          },
          expectedHash: hashRef.current,
          patch: result.patch,
        })
        hashRef.current = response.hash
        const next = applyPatchToValues(baselineRef.current, result.patch)
        baselineRef.current = next
        setBaseline(next)
        setSaveState("saved")
        return true
      } catch (error) {
        setSaveState("idle")
        setSaveError(
          error instanceof AgentConfigRequestError
            ? error.message
            : "Changes could not be saved."
        )
        if (error instanceof AgentConfigRequestError && error.status === 409) {
          void load()
        }
        return false
      }
    })()
    savePromiseRef.current = run
    const saved = await run
    savePromiseRef.current = null
    return saved
  }, [selected, selectedReadonly, permissionsReadOnly, load])

  useEffect(() => {
    if (view !== "detail" || selectedReadonly) return
    if (!hasPendingPatch) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void saveNow()
    }, AUTOSAVE_DELAY_MS)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [draft, baseline, view, selectedReadonly, hasPendingPatch, saveNow])

  async function openAgent(next: string) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const ok = await saveNow()
    if (!ok) return
    setSelectedID(next)
    setView("detail")
    setSaveError(null)
    setExpandedRuleKey(null)
    setOpenSection("model")
  }

  async function requestBack() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const ok = await saveNow()
    if (!ok) return
    setView("list")
    setSaveError(null)
  }

  async function handleMakeDefault() {
    if (!selected) return
    setBusy(true)
    setSaveError(null)
    try {
      await saveDefaultAgent({ scope: "global", agentID: selected.id })
      await nav.reloadConfiguration()
    } catch (error) {
      setSaveError(
        error instanceof AgentConfigRequestError
          ? error.message
          : "The default agent could not be saved."
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!selected?.source) return
    const agentID = selected.id
    const expectedHash = selected.source.hash
    setDeleting(true)
    setSaveError(null)
    try {
      await deleteAgentDefinition({
        scope: "global",
        projectID: null,
        agentID,
        expectedHash,
      })
      setDeleteOpen(false)
      setView("list")
      setSelectedID(null)
      // Hide the deleted agent immediately, then reconcile with the engine.
      setCatalog((current) =>
        current
          ? {
              ...current,
              agents: current.agents.filter((agent) => agent.id !== agentID),
            }
          : current
      )
      await nav.reloadConfiguration()
      await load(agentID)
    } catch (error) {
      setDeleteOpen(false)
      setSaveError(
        error instanceof AgentConfigRequestError
          ? error.message
          : "The agent could not be deleted."
      )
    } finally {
      setDeleting(false)
    }
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
  }

  function addPermissionRule() {
    const key = nextPermissionKey()
    setExpandedRuleKey(key)
    setDraft((current) => ({
      ...current,
      permissions: [
        ...current.permissions,
        { key, action: "", resource: "*", effect: "ask" },
      ],
    }))
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
  }

  const permissionCounts = draft.permissions.reduce(
    (counts, rule) => {
      counts[rule.effect] += 1
      return counts
    },
    { ask: 0, allow: 0, deny: 0 }
  )

  return (
    <div className="space-y-4 px-1 pb-2">
      {loading ? (
        <p
          role="status"
          className="flex items-center gap-2 text-[12px] text-muted-foreground"
        >
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Loading agents…
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

      {catalog && catalog.agents.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground">
          No agents are available in the global catalog.
        </p>
      ) : null}

      {catalog && view === "list" ? (
        <AgentList
          catalog={catalog}
          defaultAgentID={defaultAgentID}
          busy={busy}
          onSelect={(id) => void openAgent(id)}
        />
      ) : null}

      {selected && view === "detail" ? (
        <>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Back to all agents"
              className="size-11 shrink-0 rounded-full"
              onClick={() => void requestBack()}
            >
              <ArrowLeftIcon aria-hidden="true" className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  dir="ltr"
                  className="min-w-0 break-words text-[15px] font-medium"
                >
                  {selected.name && selected.name !== selected.id
                    ? selected.name
                    : selected.id}
                </span>
                {isDefaultAgent ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    default agent
                  </span>
                ) : null}
              </div>
              {selected.effective?.description ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 break-words text-muted-foreground">
                  {selected.effective.description}
                </p>
              ) : null}
            </div>
            {canMakeDefault ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 px-3"
                disabled={busy || isDefaultAgent}
                onClick={() => void handleMakeDefault()}
              >
                {isDefaultAgent ? "Default" : "Make default"}
              </Button>
            ) : null}
          </div>

          {selectedReadonly ? (
            <p className="text-[12px] text-muted-foreground">
              This source is read-only here.
            </p>
          ) : null}

          {saveError ? (
            <p role="alert" className="text-xs break-words text-destructive">
              {saveError}
            </p>
          ) : null}
          {!saveError && patchResult.error ? (
            <p role="alert" className="text-xs break-words text-destructive">
              {patchResult.error}
            </p>
          ) : null}
          {!saveError && !patchResult.error && saving ? (
            <p role="status" className="text-[11px] text-muted-foreground">
              Saving…
            </p>
          ) : null}

          <fieldset disabled={busy} className="min-w-0">
            <Accordion
              value={openSection ? [openSection] : []}
              onValueChange={(value) => {
                const next = value[0]
                setOpenSection(
                  next === "model" || next === "agent" || next === "permissions"
                    ? next
                    : null
                )
              }}
              className="space-y-2"
            >
              <AccordionSection value="model" title="Model">
              <FieldGroup>
                <AgentSettingSelect
                  label="Model"
                  value={base}
                  options={modelOptions}
                  disabled={
                    busy || selectedReadonly || nav.modelsStatus !== "ready"
                  }
                  busy={modelBusy}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, model: value }))
                  }
                />
                <AgentSettingSelect
                  label="Thinking Level"
                  value={variant || INHERIT}
                  options={variantOptions}
                  disabled={
                    busy ||
                    selectedReadonly ||
                    base === INHERIT ||
                    variantIds.length === 0
                  }
                  onValueChange={(value) => {
                    const nextVariant = value === INHERIT ? "" : value
                    setDraft((current) => ({
                      ...current,
                      model: nextVariant ? `${base}#${nextVariant}` : base,
                    }))
                  }}
                />
              </FieldGroup>
              </AccordionSection>

              <AccordionSection value="agent" title="Agent">
              <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="agent-config-description">
                        Description
                      </FieldLabel>
                      <Input
                        id="agent-config-description"
                        value={draft.description}
                        disabled={busy || selectedReadonly}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        className="h-11! text-[14px]"
                      />
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
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, mode: value }))
                      }
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
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, hidden: value }))
                      }
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
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            steps: event.target.value,
                          }))
                        }
                        className="h-11! text-[14px]"
                      />
                      {invalidSteps ? (
                        <p className="text-xs text-destructive">
                          Steps must be a whole number of 0 or more.
                        </p>
                      ) : null}
                    </Field>
                    <AgentSettingSelect
                      label="State"
                      value={draft.disabled}
                      options={[
                        { value: INHERIT, label: "Inherit / remove override" },
                        { value: "false", label: "Enabled" },
                        { value: "true", label: "Disabled" },
                      ]}
                      disabled={busy || selectedReadonly}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, disabled: value }))
                      }
                    />
                  </FieldGroup>
              </AccordionSection>

              <AccordionSection
                value="permissions"
                title="Permissions"
                count={draft.permissions.length}
              >
                <div className="space-y-3">
                <span className="text-[11px] text-muted-foreground">
                  {draft.permissions.length}{" "}
                  {draft.permissions.length === 1 ? "rule" : "rules"}
                  {draft.permissions.length > 0
                    ? ` · ${permissionCounts.allow}/${permissionCounts.ask}/${permissionCounts.deny}`
                    : ""}
                </span>

              {permissionsReadOnly ? (
                <p className="text-[11px] text-muted-foreground">
                  These rules cannot be edited here.
                </p>
              ) : null}

              {draft.permissions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No rules.</p>
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
                        className="rounded-lg border border-border"
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
                                    onChange={(event) =>
                                      updatePermissionRule(index, {
                                        action: event.target.value,
                                      })
                                    }
                                    className="h-11! font-mono text-[14px]"
                                    dir="ltr"
                                  />
                                  {!rule.action.trim() ? (
                                    <p className="text-xs text-destructive">
                                      Action is required.
                                    </p>
                                  ) : null}
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
                                    onChange={(event) =>
                                      updatePermissionRule(index, {
                                        resource: event.target.value,
                                      })
                                    }
                                    className="h-11! font-mono text-[14px]"
                                    dir="ltr"
                                  />
                                  {!rule.resource.trim() ? (
                                    <p className="text-xs text-destructive">
                                      Resource is required.
                                    </p>
                                  ) : null}
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
              </div>
              </AccordionSection>
            </Accordion>
          </fieldset>

          {deletable ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full text-destructive"
              disabled={busy || deleting}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Delete agent
            </Button>
          ) : null}
        </>
      ) : null}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {selected?.id ?? "this agent"} from its definition file.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
