import { useState, type ReactNode } from "react"
import {
  LoaderCircleIcon,
  SettingsIcon,
  XIcon,
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
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { HelpDisclosure } from "@/components/ui/help-disclosure"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { AgentConfigSettings } from "@/components/agent-config-settings"
import { NotificationsSettings } from "@/components/notifications-settings"
import { UiSyncSettings } from "@/components/ui-sync-settings"
import { useWebUiPreferences } from "@/components/web-ui-preferences-provider"
import {
  fixedDesktopSettingsStyle,
  fixedMobileDrawerStyle,
} from "@/lib/drawer-layout"
import { recordPerfRender } from "@/lib/perf-probe"
import type { AgentInfo, ModelInfo } from "@/lib/opencode"
import {
  selectableAgents,
  selectableModels,
  variantsForModel,
} from "@/lib/session-selection"
import { useIsDesktop } from "@/lib/use-is-desktop"
import { useTargetCatalog } from "@/lib/use-target-catalog"
import {
  DEFAULT_SESSION_DIRECTORY,
  type OpenCodeController,
} from "@/lib/use-opencode"
import {
  modelPreferenceFromRef,
  type ModelPreference,
} from "@/lib/web-ui-preferences"
import {
  isWorktreeParentDirectoryValid,
  normalizeWorktreeParentDirectory,
} from "@/lib/worktree-defaults"

const BACKEND_DEFAULT = "__backend_default__"
const FALLBACK_MODEL = "__fallback_model__"
const DEFAULT_THINKING = "__default_thinking__"

function optionDetail(providerID: string, id: string) {
  return `${providerID}/${id}`
}

function unavailableOption(
  value: string,
  label: string
): { value: string; label: string; disabled: true } {
  return { value, label, disabled: true }
}

function SettingSelect({
  label,
  help,
  showDetail,
  value,
  options,
  disabled,
  busy,
  onValueChange,
}: {
  label: string
  help?: ReactNode
  showDetail?: boolean
  value: string
  options: {
    value: string
    label: string
    detail?: string
    disabled?: boolean
  }[]
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
          if (next) onValueChange(next)
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
                <span dir={showDetail ? "ltr" : undefined} className="min-w-0 truncate">
                  {showDetail && option?.detail
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
          className="max-w-[min(24rem,calc(100vw-2rem))]"
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
                  <span className="font-mono text-[11px] break-all text-muted-foreground">
                    {option.detail}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help ? <div className="-mt-1">{help}</div> : null}
    </Field>
  )
}

function agentOptions(agents: AgentInfo[], selected: string | null) {
  const available = selectableAgents(agents)
  return [
    { value: BACKEND_DEFAULT, label: "Backend default" },
    ...(selected && !available.some((agent) => agent.id === selected)
      ? [unavailableOption(selected, `${selected} (unavailable)`)]
      : []),
    ...available.map((agent) => ({
      value: agent.id,
      label: agent.id,
      detail: agent.name && agent.name !== agent.id ? agent.name : undefined,
    })),
  ]
}

function modelOptions(
  models: ModelInfo[],
  selected: ModelPreference | null
) {
  const available = selectableModels(models)
  return [
    { value: FALLBACK_MODEL, label: "Automatic safe fallback" },
    ...(selected &&
    !available.some(
      (model) =>
        model.providerID === selected.providerID &&
        model.id === selected.modelID
    )
      ? [
          unavailableOption(
            `${selected.providerID}/${selected.modelID}`,
            `${selected.providerID}/${selected.modelID} (unavailable)`
          ),
        ]
      : []),
    ...available.map((model) => ({
      value: `${model.providerID}/${model.id}`,
      label: model.id,
      detail: optionDetail(model.providerID, model.id),
    })),
  ]
}

function selectedModelInfo(
  models: ModelInfo[],
  preference: ModelPreference | null
) {
  if (!preference) return null
  return (
    models.find(
      (model) =>
        model.providerID === preference.providerID &&
        model.id === preference.modelID
    ) ?? null
  )
}

function PreferencesPanel({
  nav,
  close,
  onAgentDirtyChange,
}: {
  nav: OpenCodeController
  close: () => void
  onAgentDirtyChange: (dirty: boolean) => void
}) {
  const {
    ready,
    preferences,
    storageWarning,
    saveStatus,
    setGlobal,
    resetGlobal,
    clearAllProjects,
  } = useWebUiPreferences()
  const [tab, setTab] = useState("defaults")

  const currentCatalog = useTargetCatalog(DEFAULT_SESSION_DIRECTORY)

  const globalModelInfo = selectedModelInfo(
    currentCatalog.models,
    preferences.global.model
  )
  const globalVariants = variantsForModel(globalModelInfo)
  const projectOverrideCount = Object.keys(
    preferences.projectOverrides
  ).length

  const globalAgentValue = preferences.global.agentID ?? BACKEND_DEFAULT
  const globalModelValue = preferences.global.model
    ? `${preferences.global.model.providerID}/${preferences.global.model.modelID}`
    : FALLBACK_MODEL
  const globalThinkingValue =
    preferences.global.thinkingLevel ?? DEFAULT_THINKING
  const savedWorktreeDirectory =
    preferences.global.worktreeParentDirectory ?? ""
  // Null while not editing, so the field always reflects the saved value after
  // loading, reset, or blur without synchronizing state from an effect.
  const [worktreeDirectoryDraft, setWorktreeDirectoryDraft] = useState<
    string | null
  >(null)
  const worktreeDirectory = worktreeDirectoryDraft ?? savedWorktreeDirectory
  const worktreeDirectoryValid =
    isWorktreeParentDirectoryValid(worktreeDirectory)

  const updateWorktreeDirectory = (value: string) => {
    setWorktreeDirectoryDraft(value)
    if (!isWorktreeParentDirectoryValid(value)) return
    const next = normalizeWorktreeParentDirectory(value)
    if (next !== preferences.global.worktreeParentDirectory) {
      setGlobal({ worktreeParentDirectory: next })
    }
  }

  const resetDefaults = () => {
    setWorktreeDirectoryDraft(null)
    resetGlobal()
  }

  const setGlobalModel = (value: string) => {
    if (value === FALLBACK_MODEL) {
      setGlobal({ model: null, thinkingLevel: null })
      return
    }
    const model = currentCatalog.models.find(
      (candidate) => `${candidate.providerID}/${candidate.id}` === value
    )
    if (!model) return
    const nextThinking = variantsForModel(model).includes(
      preferences.global.thinkingLevel ?? ""
    )
      ? preferences.global.thinkingLevel
      : null
    setGlobal({
      model: modelPreferenceFromRef({
        providerID: model.providerID,
        id: model.id,
      }),
      thinkingLevel: nextThinking,
    })
  }

  const isAgentsTab = tab === "agents"
  const isNotificationsTab = tab === "notifications"
  const statusText =
    isAgentsTab || isNotificationsTab || !ready
      ? null
      : saveStatus === "saved"
        ? "Saved locally"
        : saveStatus === "unsaved"
          ? "Not saved"
          : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-2">
        <div className="min-w-0 space-y-1">
          <h2
            id="preferences-title"
            className="text-[17px] leading-6 font-semibold tracking-tight"
          >
            {isAgentsTab ? "Agent definitions" : "Preferences"}
          </h2>
          <p className="text-[12px] leading-5 text-muted-foreground">
            {isAgentsTab
              ? "Global engine agent config. Save is explicit."
              : isNotificationsTab
                ? "Once enabled, alerts are saved by this backend for this browser's notification device."
                : "Saved in this browser for this backend."}
          </p>
          {statusText ? (
            <p
              role="status"
              className="text-[11px] text-muted-foreground"
            >
              {statusText}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close settings"
          className="size-11 shrink-0 rounded-full p-0 text-muted-foreground"
          onClick={close}
        >
          <XIcon aria-hidden="true" className="size-5" />
        </Button>
      </div>

      {isNotificationsTab ? (
        <div className="px-4 pb-1">
            <HelpDisclosure
              key="alert-storage"
              label="Where alert settings are saved"
            >
              <p>
                Once enabled, alert preferences, watched sessions, and the push
                subscription are saved by this backend for this browser&apos;s
                notification device. This app keeps only the device ID in this
                browser.
              </p>
              <p>
                Permission is controlled by your browser and OS. Changes save
                automatically.
              </p>
            </HelpDisclosure>
        </div>
      ) : null}

      {!isAgentsTab && !isNotificationsTab && storageWarning ? (
        <p
          role="alert"
          className="mx-5 mb-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs break-words text-destructive"
        >
          {storageWarning}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList className="mx-4 mb-1 w-[calc(100%-2rem)]">
          <TabsTrigger
            value="defaults"
            aria-label="New session defaults"
            className="px-1 text-[12px]"
          >
            Defaults
          </TabsTrigger>
          <TabsTrigger
            value="agents"
            aria-label="Engine agent definitions"
            className="px-1 text-[12px]"
          >
            Agents
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            aria-label="Notifications"
            className="px-1 text-[12px]"
          >
            Alerts
          </TabsTrigger>
        </TabsList>
        <ScrollArea
          viewportClassName="h-full"
          className="min-h-0 flex-1 px-4 pb-5"
        >
          <TabsContent value="notifications">
            <NotificationsSettings />
          </TabsContent>
          <TabsContent value="agents" keepMounted>
            <AgentConfigSettings
              nav={nav}
              active={tab === "agents"}
              onDirtyChange={onAgentDirtyChange}
            />
          </TabsContent>
          <TabsContent value="defaults">
            <div className="mb-1">
              <HelpDisclosure label="About new-session defaults">
                <p>
                  Browser-local defaults applied only when a new session is
                  created. They do not edit engine agent definitions; use
                  Agents for those.
                </p>
                <p>
                  Agent and Model options come from the new-session target
                  catalog ({DEFAULT_SESSION_DIRECTORY}). Saved defaults apply
                  globally; if the target catalog lacks one, new-session creation
                  reports it instead of switching silently.
                </p>
                <p>
                  Project-specific defaults are no longer supported. Any project
                  overrides saved by an older version are cleared when these
                  settings load, leaving only these global defaults.
                </p>
                <p>
                  Automatic model uses the safe free fallback; paid models are
                  always an explicit choice.
                </p>
                <p>
                  Worktree parent directory prefills new worktree creation. It
                  stays in this browser and is never sent to the backend until a
                  worktree is created.
                </p>
              </HelpDisclosure>
            </div>
            <FieldGroup>
              <SettingSelect
                label="Agent"
                value={globalAgentValue}
                disabled={currentCatalog.status !== "ready"}
                busy={currentCatalog.status === "loading"}
                onValueChange={(value) =>
                  setGlobal({
                    agentID: value === BACKEND_DEFAULT ? null : value,
                  })
                }
                options={agentOptions(
                  currentCatalog.agents,
                  preferences.global.agentID
                )}
              />
              <SettingSelect
                label="Model"
                showDetail
                value={globalModelValue}
                disabled={currentCatalog.status !== "ready"}
                busy={currentCatalog.status === "loading"}
                onValueChange={setGlobalModel}
                options={modelOptions(
                  currentCatalog.models,
                  preferences.global.model
                )}
                help={
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    Changing Model keeps Thinking Level only when the new model
                    supports it; otherwise it returns to Default.
                  </p>
                }
              />
              <SettingSelect
                label="Thinking Level"
                value={globalThinkingValue}
                disabled={
                  currentCatalog.status !== "ready" || !globalModelInfo
                }
                onValueChange={(value) =>
                  setGlobal({
                    thinkingLevel:
                      value === DEFAULT_THINKING ? null : value,
                  })
                }
                options={[
                  { value: DEFAULT_THINKING, label: "Default" },
                  ...(preferences.global.thinkingLevel &&
                  !globalVariants.includes(preferences.global.thinkingLevel)
                    ? [
                        unavailableOption(
                          preferences.global.thinkingLevel,
                          `${preferences.global.thinkingLevel} (unavailable)`
                        ),
                      ]
                    : []),
                  ...globalVariants.map((variant) => ({
                    value: variant,
                    label: variant,
                  })),
                ]}
              />
              <Field>
                <FieldLabel htmlFor="worktree-parent-directory">
                  Worktree parent directory
                </FieldLabel>
                <Input
                  id="worktree-parent-directory"
                  value={worktreeDirectory}
                  onFocus={() =>
                    setWorktreeDirectoryDraft(worktreeDirectory)
                  }
                  onChange={(event) =>
                    updateWorktreeDirectory(event.target.value)
                  }
                  onBlur={() => {
                    if (isWorktreeParentDirectoryValid(worktreeDirectory)) {
                      setWorktreeDirectoryDraft(null)
                    }
                  }}
                  placeholder="Backend default"
                  className="h-11 font-mono text-[12px]"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!ready}
                  aria-invalid={!worktreeDirectoryValid}
                  aria-describedby="worktree-parent-directory-help"
                />
                <p
                  id="worktree-parent-directory-help"
                  className="text-[11px] leading-5 text-muted-foreground"
                >
                  Blank uses the backend default. New worktrees start here
                  unless changed for one creation.
                </p>
                {!worktreeDirectoryValid ? (
                  <p role="alert" className="text-xs text-destructive">
                    Use an absolute directory or leave this blank.
                  </p>
                ) : null}
              </Field>
              {currentCatalog.error ? (
                <p role="alert" className="text-xs break-words text-destructive">
                  Agent or model catalog unavailable for the new-session target
                  ({DEFAULT_SESSION_DIRECTORY}): {currentCatalog.error}
                </p>
              ) : null}
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  onClick={resetDefaults}
                >
                  Reset global defaults
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Resets Agent, Model, Thinking Level, and Worktree parent
                  directory. Global defaults apply everywhere.
                </p>
              </div>
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={!ready}
                  onClick={clearAllProjects}
                >
                  Clear all project overrides
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  {projectOverrideCount === 0
                    ? "No project overrides are saved in this browser."
                    : `Removes ${projectOverrideCount} saved project ${
                        projectOverrideCount === 1 ? "override" : "overrides"
                      }; global defaults are unchanged.`}
                </p>
              </div>
            </FieldGroup>
            <UiSyncSettings backendVersion={nav.serverVersion} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

export function SettingsTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label="Settings"
      className="size-11 shrink-0 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
      onClick={onClick}
    >
      <SettingsIcon aria-hidden="true" className="size-[18px] text-muted-foreground" />
    </Button>
  )
}

export function SettingsDialog({
  nav,
  open,
  onOpenChange,
}: {
  nav: OpenCodeController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  recordPerfRender("SettingsDialog")
  const isDesktop = useIsDesktop()
  const [agentDirty, setAgentDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const requestOpenChange = (next: boolean) => {
    if (!next && agentDirty) {
      setConfirmClose(true)
      return
    }
    if (!next) setAgentDirty(false)
    onOpenChange(next)
  }

  const panel = (
    <PreferencesPanel
      nav={nav}
      close={() => requestOpenChange(false)}
      onAgentDirtyChange={setAgentDirty}
    />
  )

  const dialog = isDesktop ? (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby="preferences-title"
        data-fixed-drawer="settings"
        className="flex w-[min(32rem,92vw)] flex-col gap-0 overflow-hidden p-0"
        style={fixedDesktopSettingsStyle()}
      >
        {panel}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-labelledby="preferences-title"
        data-fixed-drawer="settings"
        className="gap-0 overflow-hidden rounded-t-xl p-0"
        style={fixedMobileDrawerStyle()}
      >
        {panel}
      </SheetContent>
    </Sheet>
  )

  return (
    <>
      {dialog}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved agent changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to an engine agent definition have not been saved.
              Closing Settings will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmClose(false)
                setAgentDirty(false)
                onOpenChange(false)
              }}
            >
              Discard and close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function SettingsButton({ nav }: { nav: OpenCodeController }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <SettingsTriggerButton onClick={() => setOpen(true)} />
      <SettingsDialog nav={nav} open={open} onOpenChange={setOpen} />
    </>
  )
}
