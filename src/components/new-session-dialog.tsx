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
  isModelRefSelectable,
  modelKey,
  modelRefKey,
  selectableModels,
  variantsForModel,
} from "@/lib/session-selection"
import type { ModelRef } from "@/lib/opencode"
import { openCode } from "@/lib/opencode"
import { useModelFavorites } from "@/lib/model-favorites"
import { createAsyncCache } from "@/lib/async-cache"
import { fetchSessionHome } from "@/lib/ui-environment"
import { catalogCacheKey, useTargetCatalog } from "@/lib/use-target-catalog"
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

// Location reads are keyed by the same connection-scoped namespace as the
// catalogs so two profiles with the same folder cannot share a resolution.
const locationCache = createAsyncCache<ResolvedLocation>(30_000)
const locationKey = (directory: string) =>
  `location:${catalogCacheKey(directory)}`

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
  selected: { directory: string; location: ResolvedLocation | null } | null
  probe: FolderProbe | null
}

function initialTarget(directory: string): TargetState {
  return { directory, selected: null, probe: null }
}

function draftForModel(
  ref: ModelRef | null
): { model: ModelRef | null; variant: string | null } {
  if (!ref) return { model: null, variant: null }
  // Preserve the engine/configured reference verbatim, including an
  // unsupported variant. Availability is checked separately so an unavailable
  // default is shown and blocks creation instead of being silently rewritten.
  return { model: { ...ref }, variant: ref.variant ?? null }
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

  const { createSession } = nav
  const [userDraft, setUserDraft] = useState<SessionDraft | null>(null)
  const [modified, setModified] = useState(false)
  const [modelModified, setModelModified] = useState(false)

  // Reset transient state on the open transition instead of remounting the
  // whole dialog. The selection draft is intentionally not directory-scoped:
  // browsing must never overwrite a user's agent/model choices.
  const wasOpenRef = useRef(false)
  const [lastResolved, setLastResolved] = useState<ResolvedLocation | null>(null)
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (justOpened) {
      setModified(false)
      setModelModified(false)
      setUserDraft(null)
      setTarget(initialTarget(homeDirectoryRef.current ?? initialDirectory))
    }
  }, [open, initialDirectory])

  // Resolve the destination before reading catalogs. Agent/model/config are
  // LOCATION scoped: a nested folder can carry its own .opencode overrides even
  // inside the same project. Use the exact resolved destination directory that
  // session.create will receive, never the project's canonical folder.
  const selectedID = selected?.directory === directory
    ? (selected.location?.project.id ?? null)
    : null
  // Keep the last resolved catalog as a preview while a new folder is probed,
  // but creation requires a catalog read from the exact submitted directory.
  const resolved = selected?.location ?? lastResolved
  const catalogDirectory = resolved?.directory ?? null
  const catalog = useTargetCatalog(catalogDirectory)

  const primaryAgentCatalog = useMemo(
    () => primaryAgents(catalog.agents),
    [catalog.agents]
  )
  const modelCatalog = useMemo(
    () => selectableModels(catalog.models),
    [catalog.models]
  )
  const defaults = useMemo(
    () =>
      resolveNewSessionDefaults({
        agents: catalog.agents,
        models: catalog.models,
        configEntries: catalog.configEntries,
        defaultModel: catalog.defaultModel,
      }),
    [catalog.agents, catalog.models, catalog.configEntries, catalog.defaultModel]
  )

  // Defaults are derived, never written in an effect: changing folders or
  // engines can resolve a new destination catalog while the dialog is open.
  const defaultsDraft = useMemo<SessionDraft>(
    () => ({
      agentID: defaults.agentID,
      ...draftForModel(defaults.model),
    }),
    [defaults]
  )
  const draft: SessionDraft | null =
    catalog.status === "ready"
      ? modified && userDraft
        ? userDraft
        : defaultsDraft
      : null

  const agentOptions = useMemo<PickerOption[]>(() => {
    const options = primaryAgentCatalog.map((agent) => ({
      value: agent.id,
      label: agent.id,
      detail: agent.name && agent.name !== agent.id ? agent.name : undefined,
    }))
    // The engine may default to a primary-capable `all` agent that the primary
    // picker would otherwise hide. Show it explicitly rather than silently
    // choosing a different agent.
    const defaultAgent = defaults.agentID
      ? (catalog.agents.find((agent) => agent.id === defaults.agentID) ?? null)
      : null
    if (
      defaultAgent &&
      !options.some((option) => option.value === defaultAgent.id)
    ) {
      options.push({
        value: defaultAgent.id,
        label: defaultAgent.id,
        detail:
          defaultAgent.name && defaultAgent.name !== defaultAgent.id
            ? `${defaultAgent.name} · engine default`
            : "Engine default",
      })
    }
    return options
  }, [primaryAgentCatalog, defaults.agentID, catalog.agents])

  const { favorites, toggle: toggleFavorite } = useModelFavorites()
  // Option objects are built once per catalog identity and reused afterwards;
  // only their *order* changes when a favorite toggles. Favorites stay ranked
  // first without rebuilding option objects or recomputing modelKey on a toggle.
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
        ? (catalog.models.find(
            (candidate) =>
              candidate.providerID === selectedModel.providerID &&
              candidate.id === selectedModel.id
          ) ?? null)
        : null,
    [catalog.models, selectedModel]
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

  const locationConnectionRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!open) {
      return
    }

    if (locationConnectionRef.current !== catalog.connection) {
      locationConnectionRef.current = catalog.connection
      locationCache.invalidate()
    }

    let cancelled = false

    void locationCache
      .get(locationKey(directory), () => loadLocation(directory))
      .then((location) => {
        if (!cancelled) {
          setLastResolved(location)
          setTarget((current) =>
            current.directory === directory
              ? {
                  ...current,
                  selected: { directory, location },
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
                  selected: { directory, location: null },
                  probe: { directory, available: false },
                }
              : current
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, directory, catalog.connection])

  const folder: FolderState =
    !probe || probe.directory !== directory
      ? "checking"
      : probe.available ? "available" : "unavailable"

  const projectError = newSessionProjectError(selectedID, expectedProjectID)
  const modelUnavailable = Boolean(draft?.model) && !selectedModelInfo
  // Applies to derived engine defaults as well as explicit choices: a default
  // with an unsupported variant is never silently rewritten into another ref.
  const draftUnavailable = useMemo(() => {
    if (!draft || catalog.status !== "ready") {
      return false
    }
    if (
      draft.agentID &&
      !catalog.agents.some(
        (agent) =>
          agent.id === draft.agentID && !agent.hidden && agent.mode !== "subagent"
      )
    ) {
      return true
    }
    return !isModelRefSelectable(draft.model, catalog.models)
  }, [draft, catalog.agents, catalog.models, catalog.status])
  const variantUnavailable = Boolean(
    draft?.model?.variant &&
      selectedModelInfo &&
      !variantsForModel(selectedModelInfo).includes(draft.model.variant)
  )

  // A preview from a previous folder/profile must never authorize creation.
  // The selected location has to belong to the raw input, and the ready catalog
  // has to belong to the engine-resolved directory (which may canonicalize a
  // trailing slash or symlink). Comparing the catalog to raw input would block
  // perfectly valid, engine-normalized paths.
  const catalogMatchesTarget =
    selected?.directory === directory &&
    Boolean(selected.location) &&
    catalog.directory === selected?.location?.directory
  const catalogLoading =
    catalog.status === "idle" ||
    catalog.status === "loading" ||
    !catalogMatchesTarget
  const catalogError = catalog.status === "error" && catalogMatchesTarget

  const reason =
    nav.connection !== "connected"
      ? "Not connected. Reconnect to create a session."
      : folder === "checking"
        ? "Checking session folder…"
        : folder === "unavailable"
          ? "Selected session folder unavailable."
          : projectError
            ? projectError
            : catalogLoading
              ? "Loading the Agent and Model catalog for this folder…"
              : catalogError
                ? (catalog.error ??
                  "The Agent and Model catalog for this folder could not be loaded.")
                : variantUnavailable
                  ? "The selected thinking level is unavailable for this model. Choose another."
                  : draftUnavailable
                    ? "Your Agent or Model choice is unavailable in this folder. Choose another."
                  : modelUnavailable
                    ? "The selected model is unavailable in this folder."
                    : !draft?.model
                      ? (defaults.error ??
                        "Choose an available model for the new session.")
                      : null

  const canCreate =
    nav.connection === "connected" &&
    Boolean(selectedID) &&
    !projectError &&
    folder === "available" &&
    catalog.status === "ready" &&
    catalogMatchesTarget &&
    !draftUnavailable &&
    Boolean(draft?.model) &&
    Boolean(selectedModelInfo) &&
    !nav.creating

  function handleAgentChange(next: string) {
    const agent =
      catalog.agents.find((candidate) => candidate.id === next) ?? null
    setModified(true)
    setUserDraft((current) => {
      if (
        modelModified &&
        current &&
        isModelRefSelectable(current.model, catalog.models)
      ) {
        return { ...current, agentID: next }
      }
      const fromAgent = draftForModel(agentModelDefaults(agent))
      if (fromAgent.model) return { agentID: next, ...fromAgent }
      const kept =
        current && isModelRefSelectable(current.model, catalog.models)
          ? draftForModel(current.model)
          : null
      return {
        agentID: next,
        model: kept?.model ?? null,
        variant: kept?.variant ?? null,
      }
    })
  }

  function handleModelChange(next: string) {
    const info = modelCatalog.find((candidate) => modelKey(candidate) === next)
    if (!info) return
    const variant =
      draft?.variant && variantsForModel(info).includes(draft.variant)
        ? draft.variant
        : null
    setModified(true)
    setModelModified(true)
    setUserDraft({
      agentID: draft?.agentID ?? null,
      model: buildModelRef(info, variant),
      variant,
    })
  }

  function handleVariantChange(next: string) {
    if (!selectedModelInfo) return
    const variant = next === DEFAULT_VARIANT ? null : next
    setModified(true)
    setModelModified(true)
    setUserDraft({
      agentID: draft?.agentID ?? null,
      model: buildModelRef(selectedModelInfo, variant),
      variant,
    })
  }

  async function handleCreate() {
    if (!canCreate || !selectedID || !draft?.model) {
      return
    }

    // Exactly one session.create request, with the destination folder and the
    // user-visible agent/model/variant choices.
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

  const usingEngineDefault =
    defaults.modelSource === "engine-default" &&
    !modelModified &&
    Boolean(draft?.model) &&
    Boolean(defaults.model) &&
    modelRefKey(draft?.model) === modelRefKey(defaults.model)

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
                  onValueChange={handleAgentChange}
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
                  onValueChange={handleModelChange}
                />
                {usingEngineDefault ? (
                  <p className="px-1 text-[11px] leading-5 text-muted-foreground">
                    Engine default model: {draft.model?.providerID}/{draft.model?.id}. It may incur costs.
                  </p>
                ) : null}
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
              catalogError ||
              modelUnavailable ||
              draftUnavailable ||
              !draft?.model
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
    // Warm the connection-scoped destination cache so the dialog's first
    // catalog read is not the first native call.
    const directory = nav.location?.directory ?? ""
    if (directory) {
      void locationCache
        .get(locationKey(directory), () => loadLocation(directory))
        .catch(() => {})
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
