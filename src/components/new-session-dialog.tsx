import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import { useEffect, useMemo, useRef, useState } from "react"
import { FolderOpenIcon, LoaderCircleIcon, PlusIcon } from "lucide-react"

import { DirectoryBrowser } from "@/components/directory-browser"
import { Button } from "@/components/ui/button"
import { PickerSelect, type PickerOption } from "@/components/ui/picker-select"
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { primaryAgents } from "@/lib/agent-list"
import { resolveNewSessionDefaults } from "@/lib/new-session-defaults"
import { newSessionProjectError } from "@/lib/new-session-target"
import {
  agentModelDefaults,
  buildModelRef,
  modelKey,
  selectableModels,
  variantsForModel,
} from "@/lib/session-selection"
import type { ModelRef } from "@/lib/opencode"
import { openCode } from "@/lib/opencode"
import { useModelFavorites } from "@/lib/model-favorites"
import { createAsyncCache } from "@/lib/async-cache"
import { fetchSessionHome } from "@/lib/ui-environment"
import type { OpenCodeController } from "@/lib/use-opencode"

const CREATE_REASON_ID = "new-session-create-reason"
const DEFAULT_VARIANT = "__default__"

type ResolvedLocation = {
  project: {
    id: string
    directory?: string | null
    canonical?: string | null
  }
  directory?: string | null
}
const locationCache = createAsyncCache<ResolvedLocation>(30_000)

function loadLocation(directory: string): Promise<ResolvedLocation> {
  return openCode
    .location.get({ location: { directory } })
    .then((location) => location as ResolvedLocation)
}

type FolderState = "checking" | "available" | "unavailable"

type FolderProbe = { directory: string; available: boolean }
type SessionDraft = {
  agentID: string | null
  model: ModelRef | null
  variant: string | null
}

// All transient target state lives in one object so async location/folder
// results are applied as a single batched update instead of a render cascade.
type TargetState = {
  directory: string
  selected: { directory: string; id: string | null } | null
  probe: FolderProbe | null
}

function initialTarget(directory: string): TargetState {
  return { directory, selected: null, probe: null }
}

export type NewSessionButtonProps = {
  nav: OpenCodeController
  onCreated?: () => void
  compact?: boolean
}

export type NewSessionDialogProps = {
  nav: OpenCodeController
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDirectory?: string
  expectedProjectID?: string
  onCreated?: () => void
}

export function NewSessionDialog({
  nav,
  open,
  onOpenChange,
  initialDirectory = "",
  expectedProjectID,
  onCreated,
}: NewSessionDialogProps) {
  const [target, setTarget] = useState<TargetState>(() =>
    initialTarget(initialDirectory)
  )
  const titleRef = useRef<HTMLHeadingElement>(null)
  const homeDirectoryRef = useRef<string | null>(null)
  useEffect(() => {
    void fetchSessionHome().then((home) => {
      homeDirectoryRef.current = home
    })
  }, [])
  const { directory, selected, probe } = target
  // Key the selection to its directory so changing folders immediately
  // invalidates the previous project.
  const selectedID = selected?.directory === directory ? selected.id : null

  const { createSession } = nav
  const [draft, setDraft] = useState<SessionDraft | null>(null)
  const userModifiedRef = useRef(false)

  // Reset transient state on the open transition instead of remounting the
  // whole dialog. The selection draft is intentionally not directory-scoped:
  // browsing must never overwrite a user's agent/model choices.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (justOpened) {
      userModifiedRef.current = false
      setDraft(null)
      setTarget(initialTarget(homeDirectoryRef.current ?? initialDirectory))
    }
  }, [open, initialDirectory])

  // Defaults come from the engine catalogs currently shown in Settings →
  // Agents, not from a project-scoped catalog discovered while browsing.
  const primaryAgentCatalog = useMemo(
    () => primaryAgents(nav.agents),
    [nav.agents]
  )
  const modelCatalog = useMemo(
    () => selectableModels(nav.models),
    [nav.models]
  )
  const defaults = useMemo(
    () =>
      resolveNewSessionDefaults({
        agents: primaryAgentCatalog,
        models: nav.models,
        configEntries: nav.configEntries,
      }),
    [primaryAgentCatalog, nav.models, nav.configEntries]
  )
  useEffect(() => {
    if (!open || userModifiedRef.current) return
    const next: SessionDraft = {
      agentID: defaults.agentID,
      model: defaults.model,
      variant: defaults.model?.variant ?? null,
    }
    setDraft((current) => {
      if (
        current &&
        current.agentID === next.agentID &&
        current.model?.providerID === next.model?.providerID &&
        current.model?.id === next.model?.id &&
        current.model?.variant === next.model?.variant &&
        current.variant === next.variant
      ) {
        return current
      }
      return next
    })
  }, [open, defaults])

  const agentOptions = useMemo<PickerOption[]>(
    () =>
      primaryAgentCatalog.map((agent) => ({
        value: agent.id,
        label: agent.id,
        detail:
          agent.name && agent.name !== agent.id ? agent.name : undefined,
      })),
    [primaryAgentCatalog]
  )
  const { favorites, toggle: toggleFavorite } = useModelFavorites()
  // Option objects are built once per catalog identity and reused afterwards;
  // only their *order* changes when a favorite toggles. Favorites stay ranked
  // first (the behaviour restored in the prior picker pass) without rebuilding
  // option objects or recomputing modelKey on every toggle.
  const stableModelOptions = useMemo(
    () =>
      modelCatalog.map((model) => {
        const key = modelKey(model)
        return {
          key,
          option: {
            value: key,
            label: model.id,
            detail: `${model.providerID}/${model.id}`,
          },
        }
      }),
    [modelCatalog]
  )
  const modelOptions = useMemo<PickerOption[]>(
    () =>
      stableModelOptions
        .slice()
        .sort(
          (left, right) =>
            Number(favorites.has(right.key)) - Number(favorites.has(left.key))
        )
        .map(({ option }) => option),
    [stableModelOptions, favorites]
  )
  const selectedModel = draft?.model ?? null
  const selectedModelInfo = useMemo(
    () =>
      selectedModel
        ? (nav.models.find(
            (candidate) =>
              candidate.providerID === selectedModel.providerID &&
              candidate.id === selectedModel.id
          ) ?? null)
        : null,
    [nav.models, selectedModel]
  )
  const variantOptions = useMemo(
    () => [
      { value: DEFAULT_VARIANT, label: "Default", detail: "No explicit variant" },
      ...variantsForModel(selectedModelInfo).map((id) => ({
        value: id,
        label: id,
      })),
    ],
    [selectedModelInfo]
  )

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    void locationCache
      .get(directory, () => loadLocation(directory))
      .then((location) => {
        if (!cancelled) {
          setTarget((current) =>
            current.directory === directory
              ? {
                  ...current,
                  selected: { directory, id: location.project.id },
                  probe: { directory, available: true },
                }
              : current
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTarget((current) =>
            current.directory === directory
              ? {
                  ...current,
                  selected: { directory, id: null },
                  probe: { directory, available: false },
                }
              : current
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, directory])

  const folder: FolderState =
    !probe || probe.directory !== directory
      ? "checking"
      : probe.available ? "available" : "unavailable"

  const projectError = newSessionProjectError(selectedID, expectedProjectID)
  const modelUnavailable = Boolean(draft?.model) && !selectedModelInfo

  const reason =
    nav.connection !== "connected"
      ? "Not connected. Reconnect to create a session."
      : folder === "checking"
        ? "Checking session folder…"
        : folder === "unavailable"
          ? "Selected session folder unavailable."
          : projectError
            ? projectError
            : nav.agentsStatus === "loading" || nav.modelsStatus === "loading"
              ? "Loading the Agent and Model catalog…"
              : nav.agentsStatus === "error" || nav.modelsStatus === "error"
                ? "The Agent and Model catalog could not be loaded."
                : modelUnavailable
                  ? "The selected model is unavailable in this project."
                  : !draft?.model
                    ? "Choose an available model for the new session."
                    : null

  const canCreate =
    nav.connection === "connected" &&
    Boolean(selectedID) &&
    !projectError &&
    folder === "available" &&
    Boolean(draft?.model) &&
    Boolean(selectedModelInfo) &&
    !nav.creating

  async function handleAgentChange(next: string) {
    const agent =
      nav.agents.find((candidate) => candidate.id === next) ?? null
    const model = agentModelDefaults(agent, nav.models)
    userModifiedRef.current = true
    setDraft({
      agentID: next,
      model: model ?? draft?.model ?? null,
      variant: model?.variant ?? draft?.variant ?? null,
    })
  }

  async function handleModelChange(next: string) {
    const info = modelCatalog.find((candidate) => modelKey(candidate) === next)
    if (!info) return
    const variant =
      draft?.variant && variantsForModel(info).includes(draft.variant)
        ? draft.variant
        : null
    userModifiedRef.current = true
    setDraft({ agentID: draft?.agentID ?? null, model: buildModelRef(info, variant), variant })
  }

  function handleVariantChange(next: string) {
    if (!selectedModelInfo) return
    const variant = next === DEFAULT_VARIANT ? null : next
    userModifiedRef.current = true
    setDraft({
      agentID: draft?.agentID ?? null,
      model: buildModelRef(selectedModelInfo, variant),
      variant,
    })
  }

  async function handleCreate() {
    if (!canCreate || !selectedID || !draft?.model) {
      return
    }

    const created = await createSession(
      selectedID,
      { agentID: draft.agentID, model: draft.model },
      directory
    )

    if (!created) {
      return
    }

    onOpenChange(false)
    onCreated?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        forceRenderBackdrop
        showCloseButton={false}
        initialFocus={() => titleRef.current}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto p-5 md:max-w-[40rem]"
      >
        <DialogHeader>
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-base font-semibold tracking-tight outline-none"
          >
            New session
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Session folder</p>
            <div className="mt-1 flex items-start gap-2">
              <FolderOpenIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p dir="ltr" className="min-w-0 font-mono text-xs break-all">{directory}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">An existing folder shares its files with other sessions using it. Choose a separate worktree folder for isolated file changes; worktrees still share machine resources such as network ports.</p>
          </div>
          <DirectoryBrowser
            id="new-session-directory"
            label="Browse folders"
            value={directory}
            initialBrowse={directory}
            disabled={nav.creating}
            placeholder="/home/user/project"
            onChange={(next) =>
              setTarget((current) => ({ ...current, directory: next }))
            }
            hint="Type an absolute folder or drill down from its parent. Only folders registered with OpenCode can host a session."
          />
          {draft ? (
            <div
              role="group"
              aria-label="New session agent and model"
              className="grid gap-3"
            >
              <div className="grid gap-1.5">
                <span className="px-1 text-xs font-medium text-muted-foreground">
                  Agent
                </span>
                <PickerSelect
                  label="Agent"
                  ariaLabel="New session agent"
                  value={draft.agentID ?? ""}
                  options={agentOptions}
                  placeholder="Backend default"
                  disabled={nav.creating}
                  onValueChange={(value) => void handleAgentChange(value)}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="px-1 text-xs font-medium text-muted-foreground">
                  Model
                </span>
                <PickerSelect
                  label="Model"
                  ariaLabel="New session model"
                  showDetail
                  value={
                    draft.model
                      ? `${draft.model.providerID}/${draft.model.id}`
                      : ""
                  }
                  options={modelOptions}
                  placeholder="No model"
                  disabled={nav.creating}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  onValueChange={(value) => void handleModelChange(value)}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="px-1 text-xs font-medium text-muted-foreground">
                  Thinking Level
                </span>
                <PickerSelect
                  label="Thinking Level"
                  ariaLabel="New session thinking level"
                  value={draft.variant ?? DEFAULT_VARIANT}
                  options={variantOptions}
                  disabled={nav.creating || !selectedModelInfo}
                  onValueChange={handleVariantChange}
                />
              </div>
            </div>
          ) : null}
        </div>
        {reason ? (
          <p
            id={CREATE_REASON_ID}
            role={folder === "checking" ? "status" : undefined}
            className={
              folder === "unavailable" ||
              Boolean(projectError) ||
              nav.agentsStatus === "error" ||
              nav.modelsStatus === "error" ||
              modelUnavailable || !draft?.model
                ? "text-xs break-words text-destructive"
                : "text-xs break-words text-muted-foreground"
            }
          >
            {reason}
          </p>
        ) : null}
        {nav.createError ? (
          <p role="alert" className="text-xs break-words text-destructive">
            {nav.createError}
          </p>
        ) : null}
        <DialogFooter className="mt-0 flex-row justify-end gap-2">
          <DialogClose
            render={<Button variant="outline" className="h-11 px-4" />}
            disabled={nav.creating}
          >
            Cancel
          </DialogClose>
          <Button
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            aria-busy={nav.creating}
            aria-describedby={reason ? CREATE_REASON_ID : undefined}
            className="h-11 px-4"
          >
            {nav.creating ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : null}
            Create session
          </Button>
        </DialogFooter>
      </ResponsiveDialogContent>
    </Dialog>
  )
}

export function NewSessionButton({ nav, onCreated, compact = false }: NewSessionButtonProps) {
  const [open, setOpen] = useState(false)

  function handleOpen() {
    // Warm the location cache the dialog reads, so its first render is not the
    // first location read. Agent/model catalogs come from the loaded Settings
    // state, not from the folder being browsed.
    const directory = nav.location?.directory ?? ""
    if (directory) {
      void locationCache.get(directory, () => loadLocation(directory)).catch(() => {})
    }
    setOpen(true)
  }

  return (
    <>
      <Button
        variant="ghost"
        onClick={handleOpen}
        disabled={nav.connection !== "connected"}
        aria-label={compact ? "New session" : undefined}
        className={
          compact
            ? "size-11 shrink-0 justify-center rounded-lg border-0 p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            : "h-11 w-full justify-start gap-2 rounded-lg border-0 px-2.5 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        {compact ? null : "New session"}
      </Button>
      <NewSessionDialog
        nav={nav}
        open={open}
        onOpenChange={setOpen}
        initialDirectory={nav.location?.directory ?? ""}
        onCreated={onCreated}
      />
    </>
  )
}
