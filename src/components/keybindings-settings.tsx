import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KeyboardIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useKeybindings } from "@/lib/use-keybindings"
import {
  findKeybindingConflicts,
  type Keybinding,
  type KeybindingCommand,
} from "@/lib/keybindings"

const COMMAND_LABELS: Record<KeybindingCommand, string> = {
  "command.open": "Open inspector Command",
  "find.open": "Find in conversation",
  "composer.stash": "Stash draft",
  "composer.backgroundSend": "Send and start a fresh draft",
}

const COMMAND_DESCRIPTIONS: Record<KeybindingCommand, string> = {
  "command.open": "Works anywhere outside a dialog.",
  "find.open": "Works when the conversation or inspector has focus.",
  "composer.stash": "In the composer; empty composer opens the stash menu.",
  "composer.backgroundSend": "In the composer; sends and leaves a fresh draft (same admission as Send).",
}

function keyLabel(binding: Keybinding): string {
  const parts: string[] = []
  if (binding.mod) parts.push("Mod")
  if (binding.ctrl) parts.push("Ctrl")
  if (binding.alt) parts.push("Alt")
  if (binding.shift) parts.push("Shift")
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return parts.join("+")
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"])

/**
 * Rows share one grid template so the header and every row line up in columns
 * once the Settings container is wide enough. Below that each shortcut stays a
 * single compact line: label + description on the left, scope + key cell on the
 * right. The third mobile column keeps the scope and key cells side by side so
 * every row keeps its three table cells at both widths.
 */
const ROW_CLASS =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 py-2.5 @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,7rem)_auto] @min-[40rem]:gap-x-4 @min-[40rem]:py-2"

// The header only has meaning once the columns line up; below that it stays
// available to assistive technology without pretending to label stacked rows.
const HEADER_CLASS =
  "sr-only @min-[40rem]:not-sr-only @min-[40rem]:grid @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,7rem)_auto] @min-[40rem]:gap-x-4 @min-[40rem]:px-3 @min-[40rem]:pt-2 @min-[40rem]:pb-1"

/** True only when the event target lives inside the capture cell. */
function insideCaptureCell(cell: HTMLElement | null, target: EventTarget | null): boolean {
  if (!cell || !target || typeof Node === "undefined") return false
  return target instanceof Node && cell.contains(target)
}

export function KeybindingsSettings() {
  const { bindings, save, reset, error } = useKeybindings()
  const [capturing, setCapturing] = useState<KeybindingCommand | null>(null)
  const [draft, setDraft] = useState<readonly Keybinding[]>(bindings)
  const [saved, setSaved] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const captureCellRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    void Promise.resolve().then(() => setDraft(bindings))
  }, [bindings])

  // A new combo persists immediately. A conflicting combo stays a pending draft
  // (the same policy as the old explicit save, which refused to write it).
  const commit = useCallback(
    (next: readonly Keybinding[]): boolean => {
      setDraft(next)
      setSaved(null)
      if (findKeybindingConflicts(next).length > 0) return false
      if (!save(next)) return false
      setSaved("Keybindings saved in this browser.")
      return true
    },
    [save]
  )

  useEffect(() => {
    if (!capturing) return
    const command = capturing
    function cancel() {
      setCapturing(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return
      if (MODIFIER_KEYS.has(event.key)) return
      if (event.key === "Escape" || event.key === "Tab") {
        cancel()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey
      const namedAllowed = ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
      if (!hasModifier && !namedAllowed) {
        cancel()
        setSaved("Add a modifier to this shortcut. Nothing was changed.")
        return
      }
      const existing = draft.find((binding) => binding.command === command)
      if (!existing) return
      const next: Keybinding = {
        ...existing,
        key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
        mod: event.metaKey || event.ctrlKey,
        ctrl: false,
        alt: event.altKey,
        shift: event.shiftKey,
      }
      cancel()
      if (commit(draft.map((binding) => (binding.command === command ? next : binding)))) {
        setAnnouncement(
          `Saved ${keyLabel(next)} for ${COMMAND_LABELS[command]}.`
        )
      }
    }
    function onMouseDown(event: MouseEvent) {
      // Any press outside the capturing cell cancels without saving.
      if (insideCaptureCell(captureCellRef.current, event.target)) return
      cancel()
    }
    window.addEventListener("keydown", onKeyDown, true)
    const hasDocument = typeof document !== "undefined"
    if (hasDocument) document.addEventListener("mousedown", onMouseDown, true)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      if (hasDocument) document.removeEventListener("mousedown", onMouseDown, true)
    }
  }, [capturing, draft, commit])

  const conflicts = useMemo(() => findKeybindingConflicts(draft), [draft])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyboardIcon aria-hidden="true" className="size-4" />
          Keyboard shortcuts
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Stored in this browser. Hardware keyboards work on mobile too.
        </p>
      </div>
      <div
        role="table"
        aria-label="Keyboard shortcuts"
        className="w-full min-w-0 rounded-lg border border-border/70"
      >
        <div role="rowgroup">
          <div role="row" className={HEADER_CLASS}>
            <div
              role="columnheader"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Shortcut
            </div>
            <div
              role="columnheader"
              className="text-end text-[11px] font-medium text-muted-foreground"
            >
              Scope
            </div>
            <div
              role="columnheader"
              className="text-end text-[11px] font-medium text-muted-foreground"
            >
              Keys
            </div>
          </div>
        </div>
        <div
          role="rowgroup"
          className="divide-y divide-border/70 @min-[40rem]:border-t @min-[40rem]:border-border/70"
        >
          {draft.map((binding) => {
            const capturingThis = capturing === binding.command
            const conflict = conflicts.find(
              (entry) =>
                entry.a.command === binding.command ||
                entry.b.command === binding.command
            )
            return (
              <div
                key={binding.command}
                role="row"
                className={`${ROW_CLASS} px-3`}
              >
                <div role="cell" className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {COMMAND_LABELS[binding.command]}
                  </p>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    {COMMAND_DESCRIPTIONS[binding.command]}
                  </p>
                  {conflict ? (
                    <p role="alert" className="mt-1 text-[11px] text-destructive">
                      Conflicts with{" "}
                      {COMMAND_LABELS[
                        conflict.a.command === binding.command
                          ? conflict.b.command
                          : conflict.a.command
                      ]}
                      .
                    </p>
                  ) : null}
                </div>
                <div
                  role="cell"
                  className="justify-self-end whitespace-nowrap text-end text-[11px] text-muted-foreground"
                >
                  {binding.when}
                </div>
                <div role="cell" className="justify-self-end">
                  <button
                    type="button"
                    ref={capturingThis ? captureCellRef : undefined}
                    aria-label={
                      capturingThis
                        ? `Press keys for ${COMMAND_LABELS[binding.command]}`
                        : `Change keybind for ${COMMAND_LABELS[binding.command]}, currently ${keyLabel(binding)}`
                    }
                    onClick={() => {
                      setAnnouncement(null)
                      setCapturing(capturingThis ? null : binding.command)
                    }}
                    onBlur={() => {
                      if (capturingThis) setCapturing(null)
                    }}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1.5 transition-colors hover:bg-accent/60 hover:ring-2 hover:ring-ring/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                  >
                    {capturingThis ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                        />
                        Press keys…
                      </span>
                    ) : (
                      <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-[11px]">
                        {keyLabel(binding)}
                      </kbd>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p role="status" className="sr-only">
        {capturing
          ? `Press keys for ${COMMAND_LABELS[capturing]}. Escape cancels.`
          : announcement ?? ""}
      </p>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {saved ? <p role="status" className="text-xs text-muted-foreground">{saved}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11"
          disabled={conflicts.length > 0}
          onClick={() => {
            if (save(draft)) setSaved("Keybindings saved in this browser.")
          }}
        >
          Save keybindings
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-1"
          onClick={() => {
            const next = reset()
            setDraft(next)
            setAnnouncement(null)
            setSaved("Keybindings reset to defaults.")
          }}
        >
          <RotateCcwIcon aria-hidden="true" className="size-4" />
          Reset
        </Button>
      </div>
      {conflicts.length > 0 ? (
        <p role="alert" className="text-[11px] text-destructive">
          Resolve duplicate shortcuts before saving.
        </p>
      ) : null}
    </div>
  )
}
