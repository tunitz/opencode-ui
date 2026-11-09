import { BellIcon, ListEndIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { OpenCodeController } from "@/lib/use-opencode"

/**
 * Compact queue/attention indicator directly above the composer. It is a
 * shortcut into the inspector's Activity tab, not a second queue surface.
 */
export function QueueStrip({ nav }: { nav: OpenCodeController }) {
  const queued = nav.inbox.length
  const attention = nav.pendingPermissions.length + nav.pendingForms.length
  if (!nav.activeSession || (queued === 0 && attention === 0)) return null

  const parts = [
    queued > 0 ? `${queued} queued` : null,
    attention > 0 ? `${attention} need${attention === 1 ? "s" : ""} an answer` : null,
  ].filter(Boolean)

  return (
    <div className="mx-auto flex w-full max-w-[42.5rem] shrink-0 px-4 pb-1 md:max-w-none md:px-6 lg:px-8">
      <Button
        type="button"
        variant="outline"
        onClick={() => nav.openInspector("activity")}
        className={
          attention > 0
            ? "h-11 w-full justify-start gap-2 border-amber-500/70 bg-amber-500/10 px-3 text-xs text-foreground"
            : "h-11 w-full justify-start gap-2 px-3 text-xs"
        }
      >
        {attention > 0 ? (
          <BellIcon aria-hidden="true" className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <ListEndIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="min-w-0 truncate">{parts.join(" · ")}</span>
        <span className="ms-auto shrink-0 text-muted-foreground">Activity</span>
      </Button>
    </div>
  )
}
