import { LoaderCircleIcon, PlugZapIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CommandDialogShell } from "@/components/session-command-dialogs"
import { usePty } from "@/lib/terminal/use-pty"

export type TerminalDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absolute working directory for the PTY location. */
  directory: string
  /** Optional session id, used only for the accessible terminal label. */
  sessionID?: string
}

/**
 * Browser-only terminal surface. Render it from the composer with
 * `<TerminalDialog open={...} onOpenChange={...} directory={...} />`; it owns
 * its xterm instance, WebSocket, and native PTY for the lifetime of `open`.
 */
export function TerminalDialog({
  open,
  onOpenChange,
  directory,
  sessionID,
}: TerminalDialogProps) {
  const { containerRef, status, message, label, reattach } = usePty({
    directory,
    sessionID,
    enabled: open,
  })

  if (!open) return null

  const disconnected = status === "disconnected" || status === "error"

  return (
    <CommandDialogShell
      contentClassName="w-[min(56rem,94vw)] overflow-hidden"
      bodyClassName="overflow-hidden"
      title="Terminal"
      description={`Shell in ${directory}`}
      pending={status === "connecting"}
      onClose={() => onOpenChange(false)}
      footer={
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      }
    >
      <div className="relative h-full min-h-64 overflow-hidden rounded-lg border border-border bg-[#0b0b0f] p-1.5">
        <div
          ref={containerRef}
          role="textbox"
          aria-label={label}
          className="h-full w-full overflow-hidden [&_.xterm]:h-full"
        />
        {status === "connecting" ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Connecting to terminal…
          </div>
        ) : null}
        {disconnected ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-4 text-center"
          >
            <div>
              <p className="text-sm font-medium">Terminal disconnected</p>
              {message ? (
                <p className="mt-1 max-w-sm text-xs text-muted-foreground break-words">
                  {message}
                </p>
              ) : null}
            </div>
            <Button type="button" className="h-11 px-4" onClick={reattach}>
              <PlugZapIcon aria-hidden="true" className="size-4" />
              Reattach
            </Button>
          </div>
        ) : null}
      </div>
    </CommandDialogShell>
  )
}
