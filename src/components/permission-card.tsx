import { useState } from "react"
import { ShieldAlertIcon, WrenchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { PermissionReply, PermissionRequest } from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

export function PermissionCard({
  nav,
  request,
}: {
  nav: OpenCodeController
  request: PermissionRequest
}) {
  const [error, setError] = useState<string | null>(null)
  const pending = Boolean(nav.permissionBusy[request.id])
  const savable = Boolean(request.save && request.save.length > 0)
  const toolName = request.source?.type === "tool" ? request.source.id : null

  async function reply(decision: PermissionReply) {
    setError(null)
    const failure = await nav.replyPermission(request.id, decision)

    if (failure) {
      setError(failure)
    }
  }

  return (
    <section
      aria-label={`Permission request: ${request.action}`}
      className="space-y-3 rounded-xl border border-border/70 p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <ShieldAlertIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        {request.action}
      </h3>

      {toolName ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WrenchIcon aria-hidden="true" className="size-3.5" />
          Tool: <span dir="ltr" className="font-mono">{toolName}</span>
        </p>
      ) : null}

      {request.message ? (
        <p className="text-xs break-words text-muted-foreground">
          {request.message}
        </p>
      ) : null}

      <div>
        <span className="text-xs text-muted-foreground">
          Requests access to:
        </span>
        <ul className="mt-1 space-y-0.5">
          {request.resources.map((resource) => (
            <li key={resource} dir="ltr" className="font-mono text-[12px] break-all">
              {resource}
            </li>
          ))}
        </ul>
      </div>

      {savable ? (
        <p className="text-xs text-muted-foreground">
          “Always allow” saves{" "}
          <span dir="ltr" className="font-mono">{request.action}</span> for{" "}
          {request.save?.map((pattern) => (
            <span key={pattern} dir="ltr" className="font-mono">
              {pattern}
              {request.save && request.save.indexOf(pattern) < request.save.length - 1
                ? ", "
                : ""}
            </span>
          ))}{" "}
          in this project.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          This request cannot be saved; “Always allow” would act as “Allow once”.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void reply("once")}
          disabled={pending}
          className="h-11 px-4"
        >
          Allow once
        </Button>
        {savable ? (
          <Button
            onClick={() => void reply("always")}
            disabled={pending}
            aria-busy={pending}
            className="h-11 px-4"
          >
            Always allow
          </Button>
        ) : null}
        <Button
          variant="destructive"
          onClick={() => void reply("reject")}
          disabled={pending}
          className="h-11 px-4"
        >
          Reject
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Rejecting denies this action and any other pending requests in this
        session.
      </p>
    </section>
  )
}
