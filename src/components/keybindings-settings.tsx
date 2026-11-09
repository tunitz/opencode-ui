import { useEffect, useMemo, useState } from "react"
import { KeyboardIcon, RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useKeybindings } from "@/lib/use-keybindings"
import {
  findKeybindingConflicts,
  keybindingSignature,
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

export function KeybindingsSettings() {
  const { bindings, save, reset, error } = useKeybindings()
  const [capturing, setCapturing] = useState<KeybindingCommand | null>(null)
  const [draft, setDraft] = useState<readonly Keybinding[]>(bindings)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    void Promise.resolve().then(() => setDraft(bindings))
  }, [bindings])

  useEffect(() => {
    if (!capturing) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return
      if (MODIFIER_KEYS.has(event.key)) return
      if (event.key === "Escape" || event.key === "Tab") {
        setCapturing(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey
      const namedAllowed = ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
      if (!hasModifier && !namedAllowed) {
        setCapturing(null)
        setSaved("Add a modifier to this shortcut. Nothing was changed.")
        return
      }
      const existing = draft.find((binding) => binding.command === capturing)
      if (!existing) return
      const next: Keybinding = {
        ...existing,
        key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
        mod: event.metaKey || event.ctrlKey,
        ctrl: false,
        alt: event.altKey,
        shift: event.shiftKey,
      }
      setDraft(
        draft.map((binding) => (binding.command === capturing ? next : binding))
      )
      setCapturing(null)
      setSaved(null)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [capturing, draft])

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
      <ul className="space-y-2">
        {draft.map((binding) => {
          const conflict = conflicts.find(
            (entry) =>
              entry.a.command === binding.command ||
              entry.b.command === binding.command
          )
          return (
            <li
              key={binding.command}
              className="rounded-lg border border-border/70 p-2"
            >
              <div className="flex min-h-11 items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{COMMAND_LABELS[binding.command]}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {COMMAND_DESCRIPTIONS[binding.command]}
                  </p>
                </div>
                <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-1 font-mono text-[11px]">
                  {capturing === binding.command ? "Press keys…" : keyLabel(binding)}
                </kbd>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-3 text-xs"
                  onClick={() => setCapturing(binding.command)}
                >
                  Change
                </Button>
                {conflict ? (
                  <span role="alert" className="text-[11px] text-destructive">
                    Conflicts with{" "}
                    {COMMAND_LABELS[
                      conflict.a.command === binding.command
                        ? conflict.b.command
                        : conflict.a.command
                    ]}
                    .
                  </span>
                ) : null}
                <span className="ms-auto text-[10px] text-muted-foreground">
                  {binding.when}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
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
      <p className="text-[10px] text-muted-foreground">
        {draft.map((binding) => keybindingSignature(binding)).join(" · ")}
      </p>
    </div>
  )
}
