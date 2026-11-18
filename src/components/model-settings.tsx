import { useMemo, useRef, useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PickerSelect } from "@/components/ui/picker-select"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { recordPerfRender } from "@/lib/perf-probe"
import { useLiveRunStatus } from "@/lib/use-live-run"
import { useModelFavorites } from "@/lib/model-favorites"

const DEFAULT_VARIANT = "__default__"

type Option = {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

type ModelSettingsState = ReturnType<typeof useModelSettingsState>

function useModelSettingsState(
  nav: OpenCodeController,
  onError?: (message: string | null) => void
) {
  const [selectorError, setSelectorErrorState] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const { favorites, toggle: toggleFavorite } = useModelFavorites()

  function setSelectorError(message: string | null) {
    setSelectorErrorState(message)
    setStatusMessage(null)
    onError?.(message)
  }

  const session = nav.activeSession
  const model = session?.model ?? null
  const explicitAgentID = session?.agent ?? null
  const defaultAgentID = useMemo(
    () => effectiveDefaultAgent(nav.agents, nav.configEntries),
    [nav.agents, nav.configEntries]
  )
  const agentID = session ? (explicitAgentID ?? defaultAgentID) : null

  const selectableModelList = useMemo(
    () => selectableModels(nav.models),
    [nav.models]
  )
  const selectableAgentList = useMemo(
    () => selectableAgents(nav.agents),
    [nav.agents]
  )
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

  const agentOptions = useMemo<Option[]>(
    () => [
      ...selectableAgentList.map((agent) => ({
        value: agent.id,
        label: agent.id,
        detail: agent.name && agent.name !== agent.id ? agent.name : undefined,
      })),
      ...(explicitAgentID &&
      !selectableAgentList.some((candidate) => candidate.id === explicitAgentID)
        ? [
            {
              value: explicitAgentID,
              label: `${explicitAgentID} (unavailable)`,
              disabled: true,
            },
          ]
        : []),
    ],
    [explicitAgentID, selectableAgentList]
  )

  const modelOptions = useMemo<Option[]>(
    () => [
      ...[...selectableModelList]
        .sort((left, right) => {
          const leftFavorite = favorites.has(modelKey(left)) ? 0 : 1
          const rightFavorite = favorites.has(modelKey(right)) ? 0 : 1
          return (
            leftFavorite - rightFavorite ||
            modelKey(left).localeCompare(modelKey(right))
          )
        })
        .map((candidate) => ({
          value: modelKey(candidate),
          label: candidate.id,
          detail: `${candidate.providerID}/${candidate.id}`,
        })),
      ...(model &&
      !nav.models.some(
        (candidate) =>
          candidate.providerID === model.providerID &&
          candidate.id === model.id
      )
        ? [
            {
              value: modelRefKey(model),
              label: `${model.providerID}/${model.id} (unavailable)`,
              disabled: true,
            },
          ]
        : []),
    ],
    [favorites, model, nav.models, selectableModelList]
  )

  const variantOptions = useMemo<Option[]>(
    () => [
      { value: DEFAULT_VARIANT, label: "Default", detail: "No explicit variant" },
      ...variantsForModel(selectedModelInfo).map((id) => ({
        value: id,
        label: id,
      })),
    ],
    [selectedModelInfo]
  )

  const running = useLiveRunStatus(nav.activeSessionID) === "running"
  const catalogError = nav.agentsStatus === "error" || nav.modelsStatus === "error"

  async function handleAgentChange(next: string) {
    if (next === (agentID ?? "")) return
    setSelectorError(null)
    const failure = await nav.switchAgentWithDefaults(next)
    if (failure) setSelectorError(failure)
    else setStatusMessage(`Agent ${next} selected`)
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
    else setStatusMessage(`Model ${info.providerID}/${info.id} selected`)
  }

  async function handleVariantChange(next: string) {
    if (!selectedModelInfo) return
    setSelectorError(null)
    const failure = await nav.switchModel(
      buildModelRef(selectedModelInfo, next === DEFAULT_VARIANT ? null : next)
    )
    if (failure) setSelectorError(failure)
    else setStatusMessage(`Thinking Level ${next === DEFAULT_VARIANT ? "Default" : next} selected`)
  }

  return {
    nav,
    session,
    model,
    agentID,
    selectableModelList,
    selectableAgentList,
    selectedModelInfo,
    explicitVariant,
    variantSelectValue,
    agentOptions,
    modelOptions,
    variantOptions,
    running,
    catalogError,
    selectorError,
    statusMessage,
    favorites,
    toggleFavorite,
    handleAgentChange,
    handleModelChange,
    handleVariantChange,
  }
}

function SettingSelect({
  name,
  value,
  options,
  disabled,
  busy,
  showDetail,
  onValueChange,
  favorites,
  onToggleFavorite,
}: {
  name: string
  value: string
  options: Option[]
  disabled?: boolean
  busy?: boolean
  showDetail?: boolean
  onValueChange: (value: string) => void
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (value: string) => void
}) {
  const selected = options.find((option) => option.value === value)
  const fallbackLabel = value || "Default"
  const triggerLabel =
    showDetail && selected?.detail
      ? selected.detail
      : selected?.label ?? fallbackLabel
  const ariaValue = triggerLabel

  return (
    <PickerSelect
      label={name}
      ariaLabel={`${name}, ${ariaValue}`}
      value={value}
      options={options}
      disabled={disabled}
      busy={busy}
      showDetail={showDetail}
      placeholder={value || "Default"}
      triggerProps={{ "aria-busy": busy }}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      onValueChange={onValueChange}
      triggerClassName="h-11! w-full min-w-0 gap-2 overflow-hidden px-3 text-sm"
    />
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

function SwitchStatus({ message }: { message: string | null }) {
  return <p role="status" className="sr-only">{message ?? ""}</p>
}

function ModelSettingsForm({ state }: { state: ModelSettingsState }) {
  return (
    <div className="grid gap-4">
      <SwitchStatus message={state.statusMessage} />
      <SettingRow label="Agent">
        <SettingSelect
          name="Agent"
          value={state.agentID ?? ""}
          options={state.agentOptions}
          disabled={!state.session || state.nav.switchingAgent}
          busy={state.nav.switchingAgent}
          onValueChange={(value) => void state.handleAgentChange(value)}
        />
      </SettingRow>
      <SettingRow label="Model">
        <SettingSelect
          name="Model"
          showDetail
          value={modelRefKey(state.model)}
          options={state.modelOptions}
          disabled={!state.session || state.nav.switchingModel}
          busy={state.nav.switchingModel}
          favorites={state.favorites}
          onToggleFavorite={state.toggleFavorite}
          onValueChange={(value) => void state.handleModelChange(value)}
        />
      </SettingRow>
      <SettingRow label="Thinking Level">
        <SettingSelect
          name="Thinking Level"
          value={state.variantSelectValue}
          options={state.variantOptions}
          disabled={!state.session || !state.selectedModelInfo || state.nav.switchingModel}
          busy={state.nav.switchingModel}
          onValueChange={(value) => void state.handleVariantChange(value)}
        />
      </SettingRow>
      {state.model && state.explicitVariant ? (
        <p className="px-1 text-[11px] leading-5 text-muted-foreground">
          Changing Model keeps Thinking Level when the new model supports
          it; otherwise it uses Default.
        </p>
      ) : null}
      {state.running ? (
        <p className="text-xs text-muted-foreground">
          Changes apply to the next turn; the current run is unaffected.
        </p>
      ) : null}
      {state.selectorError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {state.selectorError}
        </p>
      ) : null}
      {state.catalogError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          Agents or models could not be loaded.{" "}
          <Button
            type="button"
            variant="link"
            onClick={state.nav.retryCatalogs}
            className="h-11 min-w-11 px-2 align-middle text-xs underline"
          >
            Retry
          </Button>
        </p>
      ) : null}
    </div>
  )
}

export function ModelSettingsDrawer({ nav, open: controlledOpen, onOpenChange }: { nav: OpenCodeController; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  recordPerfRender("ModelSettingsDrawer")
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const isDesktop = useIsDesktop()
  const state = useModelSettingsState(nav)

  const { model, agentID } = state
  const thinkingLabel = model ? state.explicitVariant || "Default" : null
  const triggerLabel = model
    ? `${model.providerID}/${model.id} · Thinking Level ${thinkingLabel}`
    : "No model"

  const triggerContents = (
    <>
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
    </>
  )

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      aria-label={`Active model, ${triggerLabel}${agentID ? `, agent ${agentID}` : ""}`}
      className="relative h-11 min-w-11 max-w-full shrink justify-start gap-1 rounded-lg px-1.5 text-[14px] leading-6 font-medium text-foreground hover:bg-muted/60"
    />
  )

  if (!isDesktop) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger}>{triggerContents}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 rounded-t-xl bg-card p-0"
          style={{
            bottom:
              "calc(100dvh - var(--app-viewport-top, 0px) - var(--app-viewport-height, 100dvh))",
            maxHeight: "var(--app-viewport-height, 85svh)",
          }}
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
            <ModelSettingsForm state={state} />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>{triggerContents}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(30rem,calc(100vw-2rem))] gap-0 p-0"
      >
        <PopoverHeader className="px-5 pt-5 pb-3">
          <PopoverTitle className="text-[17px] font-semibold tracking-tight">
            Model settings
          </PopoverTitle>
          <PopoverDescription className="sr-only">
            Agent, model, and thinking level for the next turn.
          </PopoverDescription>
        </PopoverHeader>
        <ScrollArea viewportClassName="max-h-[min(60svh,32rem)]" className="px-4 pb-5">
          <ModelSettingsForm state={state} />
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

const INLINE_TRIGGER_CLASS =
  "h-11 w-auto min-w-11 justify-start gap-1 rounded-lg border-0 bg-transparent py-0 pe-1.5 ps-1.5 text-[14px] leading-6 font-medium text-foreground shadow-none hover:bg-muted/60 dark:bg-transparent dark:hover:bg-muted/60"

export function ModelSettingsInline({
  nav,
  open: controlledOpen,
  onOpenChange,
  onError,
}: {
  nav: OpenCodeController
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onError?: (message: string | null) => void
}) {
  recordPerfRender("ModelSettingsInline")
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const state = useModelSettingsState(nav, onError)
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null)

  const { session, model, agentID } = state
  const thinkingLabel = model ? state.explicitVariant || "Default" : "Default"

  return (
    <div className="relative flex min-w-0 items-center gap-0.5">
      <SwitchStatus message={state.statusMessage} />
      <PickerSelect
        label="Agent"
        ariaLabel={`Agent, ${agentID ?? "None"}`}
        value={agentID ?? ""}
        options={state.agentOptions}
        disabled={!session || nav.switchingAgent}
        busy={nav.switchingAgent}
        side="top"
        align="start"
        placeholder="Default"
        triggerProps={{ "aria-busy": nav.switchingAgent }}
        onValueChange={(value) => void state.handleAgentChange(value)}
        triggerClassName={`${INLINE_TRIGGER_CLASS} max-w-48`}
        iconClassName="size-3"
      />
      <PickerSelect
        label="Model"
        ariaLabel={`Model, ${model ? `${model.providerID}/${model.id}` : "No model"}`}
        value={modelRefKey(model)}
        options={state.modelOptions}
        disabled={!session || nav.switchingModel}
        busy={nav.switchingModel}
        favorites={state.favorites}
        onToggleFavorite={state.toggleFavorite}
        side="top"
        align="start"
        placeholder="No model"
        triggerProps={{
          "aria-busy": nav.switchingModel,
          ref: modelTriggerRef,
        }}
        renderValue={() =>
          model ? (
            <>
              <span className="text-muted-foreground">{model.providerID}/</span>
              {model.id}
            </>
          ) : (
            "No model"
          )
        }
        onValueChange={(value) => void state.handleModelChange(value)}
        triggerClassName={`${INLINE_TRIGGER_CLASS} max-w-[20rem]`}
        iconClassName="size-3"
      />
      <PickerSelect
        label="Thinking Level"
        ariaLabel={`Thinking Level, ${thinkingLabel}`}
        value={state.variantSelectValue}
        options={state.variantOptions}
        disabled={!session || !state.selectedModelInfo || nav.switchingModel}
        busy={nav.switchingModel}
        side="top"
        align="start"
        placeholder="Default"
        triggerProps={{ "aria-busy": nav.switchingModel }}
        onValueChange={(value) => void state.handleVariantChange(value)}
        triggerClassName={`${INLINE_TRIGGER_CLASS} max-w-32`}
        iconClassName="size-3"
      />
      {state.catalogError ? (
        <Button
          type="button"
          variant="ghost"
          aria-label="Retry loading agents and models"
          onClick={nav.retryCatalogs}
          className="h-11 min-w-11 shrink-0 px-2 text-xs text-muted-foreground"
        >
          Retry
        </Button>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          nativeButton={false}
          render={
            <button
              type="button"
              aria-label="Open model settings"
              className="sr-only"
            />
          }
        />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          finalFocus={modelTriggerRef}
          className="w-[min(30rem,calc(100vw-2rem))] gap-0 p-0"
        >
          <PopoverHeader className="px-5 pt-5 pb-3">
            <PopoverTitle className="text-[17px] font-semibold tracking-tight">
              Model settings
            </PopoverTitle>
            <PopoverDescription className="sr-only">
              Agent, model, and thinking level for the next turn.
            </PopoverDescription>
          </PopoverHeader>
          <ScrollArea viewportClassName="max-h-[min(60svh,32rem)]" className="px-4 pb-5">
            <ModelSettingsForm state={state} />
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
