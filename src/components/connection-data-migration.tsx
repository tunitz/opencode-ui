import { useCallback, useEffect, useMemo, useState } from "react"
import { DatabaseZapIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PickerSelect, type PickerOption } from "@/components/ui/picker-select"
import type { EngineProfileSummary } from "@/lib/connections"
import { listLegacySpaces, notesRequest } from "@/lib/notes-api"
import type { NotesSpace } from "@/lib/notes-types"
import { assignLegacyShortcuts, readSessionShortcuts } from "@/lib/session-shortcuts-api"

type MigrationProps = {
  profiles: readonly EngineProfileSummary[]
  activeId: string | null
  onChanged?: () => void
}

/**
 * One-time home for data saved before pins and Notes were connection-scoped.
 * Nothing is guessed or overwritten: every legacy item stays hidden until the
 * user explicitly assigns it to a saved connection.
 */
export function ConnectionDataMigration({
  profiles,
  activeId,
  onChanged,
}: MigrationProps) {
  const [legacyCount, setLegacyCount] = useState(0)
  const [legacySpaces, setLegacySpaces] = useState<NotesSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pinTarget, setPinTarget] = useState<string | null>(activeId)
  const [spaceTargets, setSpaceTargets] = useState<Record<string, string>>({})

  const options = useMemo<PickerOption[]>(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        detail: profile.engineUrl,
      })),
    [profiles]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [pins, spaces] = await Promise.allSettled([
      readSessionShortcuts(activeId),
      listLegacySpaces(),
    ])
    if (pins.status === "fulfilled") setLegacyCount(pins.value.legacyCount)
    if (spaces.status === "fulfilled") {
      setLegacySpaces(
        spaces.value.filter(
          (space) => space.projectDir !== null && space.connectionId == null
        )
      )
    }
    if (pins.status === "rejected" || spaces.status === "rejected") {
      setError("Could not load unassigned data. Retry to try again.")
    }
    setLoading(false)
  }, [activeId])

  /* eslint-disable react-hooks/set-state-in-effect -- async load only mirrors server state */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable react-hooks/set-state-in-effect */

  const effectivePinTarget =
    pinTarget && profiles.some((profile) => profile.id === pinTarget)
      ? pinTarget
      : (activeId ?? profiles[0]?.id ?? null)

  const assignPins = useCallback(async () => {
    if (!effectivePinTarget || busy) return
    setBusy(true)
    setError(null)
    try {
      await assignLegacyShortcuts(effectivePinTarget)
      await load()
      onChanged?.()
    } catch {
      setError("Could not assign the pinned sessions. Try again.")
    } finally {
      setBusy(false)
    }
  }, [busy, effectivePinTarget, load, onChanged])

  const assignSpace = useCallback(
    async (space: NotesSpace) => {
      const target = spaceTargets[space.id] ?? activeId ?? profiles[0]?.id
      if (!target || busy) return
      setBusy(true)
      setError(null)
      try {
        await notesRequest("updateSpace", {
          spaceID: space.id,
          connectionId: target,
          ...(typeof space.revision === "number"
            ? { expectedRevision: space.revision }
            : {}),
        })
        await load()
        onChanged?.()
      } catch {
        setError(`Could not assign “${space.name}”. Refresh and try again.`)
      } finally {
        setBusy(false)
      }
    },
    [activeId, busy, load, onChanged, profiles, spaceTargets]
  )

  const hasLegacy = legacyCount > 0 || legacySpaces.length > 0
  if (loading) return null
  if (!hasLegacy) return null

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="space-y-0.5">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <DatabaseZapIcon aria-hidden="true" className="size-4 shrink-0" />
          Unassigned data
        </h3>
        <p className="text-xs text-muted-foreground">
          These items were saved before pins and Notes belonged to a connection.
          Choose where each one belongs; nothing is changed until you assign it.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      ) : null}

      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Add a connection before assigning this data.
        </p>
      ) : null}

      {legacyCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-3">
          <p className="min-w-0 flex-1 text-xs text-foreground">
            {legacyCount} pinned session{legacyCount === 1 ? "" : "s"} and labels
          </p>
          <PickerSelect
            value={effectivePinTarget}
            options={options}
            onValueChange={setPinTarget}
            label="Connection for pinned sessions"
            ariaLabel="Connection for pinned sessions"
            placeholder="Choose connection"
            disabled={busy}
            triggerClassName="w-52"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy || !effectivePinTarget}
            onClick={() => void assignPins()}
          >
            {busy ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            Assign pins
          </Button>
        </div>
      ) : null}

      {legacySpaces.map((space) => (
        <div
          key={space.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-3"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-xs font-medium text-foreground">
              {space.name}
            </p>
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {space.projectDir}
            </p>
          </div>
          <PickerSelect
            value={spaceTargets[space.id] ?? activeId ?? profiles[0]?.id ?? null}
            options={options}
            onValueChange={(value) =>
              setSpaceTargets((current) => ({ ...current, [space.id]: value }))
            }
            label={`Connection for ${space.name}`}
            ariaLabel={`Connection for ${space.name}`}
            placeholder="Choose connection"
            disabled={busy}
            triggerClassName="w-52"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => void assignSpace(space)}
          >
            Assign notes
          </Button>
        </div>
      ))}
    </div>
  )
}
