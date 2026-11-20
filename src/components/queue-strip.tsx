import { BellIcon, ListEndIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
    <div className="mx-auto flex w-full max-w-[42.5rem] shrink-0 px-4 pb-1 md:max-w-none md:px-0">
      <Button
        type="button"
        variant="outline"
        onClick={() => nav.openInspector("activity")}
        aria-label={`${parts.join(" · ")}. Open activity`}
        className="h-11 w-full justify-start gap-2 px-3 text-xs"
      >
        {attention > 0 ? (
          <BellIcon aria-hidden="true" className="size-4 shrink-0 text-destructive" />
        ) : (
          <ListEndIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {queued > 0 ? (
            <Badge variant="secondary" className="min-w-0 shrink-0">
              {queued} queued
            </Badge>
          ) : null}
          {attention > 0 ? (
            <Badge variant="destructive" className="min-w-0 truncate">
              {attention} need{attention === 1 ? "s" : ""} an answer
            </Badge>
          ) : null}
        </span>
        <span className="ms-auto shrink-0 text-muted-foreground">Activity</span>
      </Button>
    </div>
  )
}
