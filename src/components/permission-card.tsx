import { useState } from "react"
import { ShieldAlertIcon, WrenchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
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
      className="flex flex-col gap-3 rounded-xl border border-border/70 p-4"
    >
      <Item variant="outline" className="flex-wrap items-start gap-3">
        <ItemMedia variant="icon" className="self-start text-muted-foreground">
          <ShieldAlertIcon aria-hidden="true" className="size-4" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-none text-sm font-semibold tracking-tight">
            {request.action}
          </ItemTitle>

          {toolName ? (
            <ItemDescription className="flex items-center gap-1.5 text-xs">
              <WrenchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              Tool: <span dir="ltr" className="font-mono">{toolName}</span>
            </ItemDescription>
          ) : null}

          {request.message ? (
            <ItemDescription className="line-clamp-none text-xs break-words">
              {request.message}
            </ItemDescription>
          ) : null}

          <div className="min-w-0">
            <span className="text-xs text-muted-foreground">
              Requests access to:
            </span>
            <ul className="mt-1 flex flex-col gap-0.5">
              {request.resources.map((resource) => (
                <li key={resource} dir="ltr" className="break-all font-mono text-[12px]">
                  {resource}
                </li>
              ))}
            </ul>
          </div>

          {savable ? (
            <ItemDescription className="line-clamp-none text-xs">
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
            </ItemDescription>
          ) : (
            <ItemDescription className="line-clamp-none text-xs">
              This request cannot be saved; “Always allow” would act as “Allow once”.
            </ItemDescription>
          )}
        </ItemContent>

        <ItemActions className="w-full flex-wrap gap-2 pt-1">
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
        </ItemActions>
      </Item>

      {error ? (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Rejecting denies this action and any other pending requests in this
        session.
      </p>
    </section>
  )
}
