import { useMemo, useState } from "react"
import { ChevronDownIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  buildModelRef,
  effectiveDefaultAgent,
  modelKey,
  modelRefKey,
  selectableAgents,
  selectableModels,
  variantValue,
  variantsForModel,
} from "@/lib/session-selection"
import type { OpenCodeController } from "@/lib/use-opencode"
import { useIsDesktop } from "@/lib/use-is-desktop"
import { cn } from "@/lib/utils"
import { recordPerfRender } from "@/lib/perf-probe"
import { useLiveRunStatus } from "@/lib/use-live-run"

const DEFAULT_VARIANT = "__default__"

type Option = {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

function SettingSelect({
  name,
  value,
  options,
  disabled,
  busy,
  showDetail,
  onValueChange,
}: {
  name: string
  value: string
  options: Option[]
  disabled?: boolean
  busy?: boolean
  showDetail?: boolean
  onValueChange: (value: string) => void
}) {
  const selected = options.find((option) => option.value === value)
  const fallbackLabel = value || "Default"
  const triggerLabel =
    showDetail && selected?.detail
      ? selected.detail
      : selected?.label ?? fallbackLabel
  const ariaValue = triggerLabel

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) {
          onValueChange(next)
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={`${name}, ${ariaValue}`}
        aria-busy={busy}
        className="h-11! w-full min-w-0 gap-2 overflow-hidden px-3 text-sm"
      >
        <SelectValue className="min-w-0">
          {() => (
            <span className="flex min-w-0 items-center gap-2">
              {busy ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                />
              ) : null}
              <span dir="ltr" data-slot="select-label" className="min-w-0 truncate">
                {triggerLabel}
              </span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        sideOffset={6}
        className="p-1"
        style={{
          width: "max-content",
          minWidth: "var(--anchor-width)",
          maxWidth: "min(22rem, calc(100vw - 2rem))",
        }}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="min-h-11 py-2 ps-2 [&>span]:items-start [&>span]:whitespace-normal"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] break-words">{option.label}</span>
              {option.detail ? (
                <span dir="ltr" className="font-mono text-[11px] break-all text-muted-foreground">
                  {option.detail}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SettingRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <span className="px-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

export function ModelSettingsDrawer({ nav }: { nav: OpenCodeController }) {
  recordPerfRender("ModelSettingsDrawer")
  const [open, setOpen] = useState(false)
  const [selectorError, setSelectorError] = useState<string | null>(null)
  const isDesktop = useIsDesktop()

  const session = nav.activeSession
  const model = session?.model ?? null
  const explicitAgentID = session?.agent ?? null
  const defaultAgentID = useMemo(
    () => effectiveDefaultAgent(nav.agents, nav.configEntries),
    [nav.agents, nav.configEntries]
  )
  const agentID = session ? (explicitAgentID ?? defaultAgentID) : null

  const selectableModelList = selectableModels(nav.models)
  const selectableAgentList = selectableAgents(nav.agents)
  const selectedModelInfo =
    model !== null
      ? (nav.models.find(
          (candidate) =>
            candidate.providerID === model.providerID &&
            candidate.id === model.id
        ) ?? null)
      : null

  const explicitVariant = variantValue(model)
  const variantSelectValue = explicitVariant || DEFAULT_VARIANT

  const agentOptions: Option[] = [
    ...(explicitAgentID &&
    !selectableAgentList.some((candidate) => candidate.id === explicitAgentID)
      ? [{ value: explicitAgentID, label: `${explicitAgentID} (unavailable)`, disabled: true }]
      : []),
    ...selectableAgentList.map((agent) => ({
      value: agent.id,
      label: agent.id,
      detail: agent.name && agent.name !== agent.id ? agent.name : undefined,
    })),
  ]

  const modelOptions: Option[] = [
    ...(model &&
    !nav.models.some(
      (candidate) =>
        candidate.providerID === model.providerID && candidate.id === model.id
    )
      ? [{ value: modelRefKey(model), label: `${model.providerID}/${model.id} (unavailable)`, disabled: true }]
      : []),
    ...selectableModelList.map((candidate) => ({
      value: modelKey(candidate),
      label: candidate.id,
      detail: `${candidate.providerID}/${candidate.id}`,
    })),
  ]

  const variantIds = variantsForModel(selectedModelInfo)
  const variantOptions: Option[] = [
    { value: DEFAULT_VARIANT, label: "Default", detail: "No explicit variant" },
    ...variantIds.map((id) => ({ value: id, label: id })),
  ]

  const running = useLiveRunStatus(nav.activeSessionID) === "running"
  const catalogError = nav.agentsStatus === "error" || nav.modelsStatus === "error"

  async function handleAgentChange(next: string) {
    if (next === (agentID ?? "")) return
    setSelectorError(null)
    const failure = await nav.switchAgent(next)
    if (failure) setSelectorError(failure)
  }

  async function handleModelChange(next: string) {
    const info = selectableModelList.find((candidate) => modelKey(candidate) === next)
    if (!info || modelRefKey(model) === next) return
    setSelectorError(null)
    const nextVariant =
      explicitVariant && variantsForModel(info).includes(explicitVariant)
        ? explicitVariant
        : null
    const failure = await nav.switchModel(buildModelRef(info, nextVariant))
    if (failure) setSelectorError(failure)
  }

  async function handleVariantChange(next: string) {
    if (!selectedModelInfo) return
    setSelectorError(null)
    const failure = await nav.switchModel(
      buildModelRef(selectedModelInfo, next === DEFAULT_VARIANT ? null : next)
    )
    if (failure) setSelectorError(failure)
  }

  const thinkingLabel = model ? explicitVariant || "Default" : null
  const triggerLabel = model
    ? `${model.providerID}/${model.id} · Thinking Level ${thinkingLabel}`
    : "No model"

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            aria-label={`Active model, ${triggerLabel}${agentID ? `, agent ${agentID}` : ""}`}
            className="relative h-11 min-w-11 max-w-full shrink justify-start gap-1 rounded-lg px-1.5 text-[14px] leading-6 font-medium text-foreground hover:bg-muted/60"
          />
        }
      >
        <span dir="ltr" className="min-w-0 truncate">
          {model ? (
            <>
              <span className="text-muted-foreground">{model.providerID}/</span>
              {model.id}
            </>
          ) : (
            "No model"
          )}
        </span>
        {thinkingLabel ? (
          <span className="shrink-0 text-[13px] text-muted-foreground">
            {thinkingLabel}
          </span>
        ) : null}
        <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </SheetTrigger>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={cn(
          "gap-0 bg-card p-0",
          isDesktop ? "w-[min(26rem,92vw)]" : "max-h-[85svh] rounded-t-xl"
        )}
        style={
          isDesktop
            ? undefined
            : {
                bottom:
                  "calc(100dvh - var(--app-viewport-top, 0px) - var(--app-viewport-height, 100dvh))",
                maxHeight: "var(--app-viewport-height, 85svh)",
              }
        }
      >
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-[17px] font-semibold tracking-tight">
            Model settings
          </SheetTitle>
          <SheetDescription className="sr-only">
            Agent, model, and thinking level for the next turn.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea viewportClassName="max-h-[min(65svh,38rem)]" className="px-4 pb-5">
          <div className="grid gap-4">
            <SettingRow label="Agent">
              <SettingSelect
                name="Agent"
                value={agentID ?? ""}
                options={agentOptions}
                disabled={!session || nav.switchingAgent}
                busy={nav.switchingAgent}
                onValueChange={(value) => void handleAgentChange(value)}
              />
            </SettingRow>
            <SettingRow label="Model">
              <SettingSelect
                name="Model"
                showDetail
                value={modelRefKey(model)}
                options={modelOptions}
                disabled={!session || nav.switchingModel}
                busy={nav.switchingModel}
                onValueChange={(value) => void handleModelChange(value)}
              />
            </SettingRow>
            <SettingRow label="Thinking Level">
              <SettingSelect
                name="Thinking Level"
                value={variantSelectValue}
                options={variantOptions}
                disabled={!session || !selectedModelInfo || nav.switchingModel}
                busy={nav.switchingModel}
                onValueChange={(value) => void handleVariantChange(value)}
              />
            </SettingRow>
            {model && explicitVariant ? (
              <p className="px-1 text-[11px] leading-5 text-muted-foreground">
                Changing Model keeps Thinking Level when the new model supports
                it; otherwise it uses Default.
              </p>
            ) : null}
            {running ? (
              <p className="text-xs text-muted-foreground">
                Changes apply to the next turn; the current run is unaffected.
              </p>
            ) : null}
            {selectorError ? (
              <p role="alert" className="text-xs break-words text-destructive">
                {selectorError}
              </p>
            ) : null}
            {catalogError ? (
              <p role="alert" className="text-xs break-words text-destructive">
                Agents or models could not be loaded.{" "}
                <Button
                  type="button"
                  variant="link"
                  onClick={nav.retryCatalogs}
                  className="h-11 min-w-11 px-2 align-middle text-xs underline"
                >
                  Retry
                </Button>
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
