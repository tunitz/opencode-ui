import { EyeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  TOOL_VISIBILITY_MODES,
  toolVisibilityLabel,
  type ToolVisibilityMode,
} from "@/lib/tool-visibility"
import { useUndoToast } from "@/lib/undo-toast"
import { useToolVisibility } from "@/lib/use-tool-visibility"

/** Header control for tool-call visibility modes (avoids floating over chat content). */
export function ToolVisibilityMenu({ serverVersion }: { serverVersion: string | null }) {
  const { mode: toolMode, setMode: setToolMode, error: toolModeError } = useToolVisibility(serverVersion)
  const undo = useUndoToast()

  return (
    <div className="relative flex shrink-0 items-center">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label={`Tool visibility: ${toolVisibilityLabel(toolMode)}`}
              className="size-11 shrink-0 rounded-full text-muted-foreground"
            />
          }
        >
          <EyeIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="min-w-52">
          <DropdownMenuRadioGroup
            value={toolMode}
            onValueChange={(next) => {
              const mode = next as ToolVisibilityMode
              const previous = toolMode
              if (setToolMode(mode)) {
                undo.showUndo(
                  `Tool visibility: ${toolVisibilityLabel(mode)}`,
                  () => setToolMode(previous)
                )
              }
            }}
          >
            {TOOL_VISIBILITY_MODES.map((mode) => (
              <DropdownMenuRadioItem key={mode} value={mode} className="min-h-11">
                {toolVisibilityLabel(mode)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {toolModeError ? (
        <p role="alert" className="absolute top-full end-0 z-20 mt-1 max-w-56 rounded-lg bg-background px-2 py-1 text-[10px] text-destructive shadow">
          {toolModeError}
        </p>
      ) : null}
    </div>
  )
}
