import { useState } from "react"
import { BellIcon, MessageCircleQuestionIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { FormView } from "@/components/form-view"
import { PermissionCard } from "@/components/permission-card"
import { fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import { useIsDesktop } from "@/lib/use-is-desktop"
import type { OpenCodeController } from "@/lib/use-opencode"

function PendingList({ nav }: { nav: OpenCodeController }) {
  return (
    <ScrollArea viewportClassName="max-h-[min(60vh,30rem)]" className="min-h-0 flex-1 pe-1">
      <div className="space-y-4">
        {nav.pendingPermissions.map((request) => (
          <PermissionCard key={request.id} nav={nav} request={request} />
        ))}
        {nav.pendingForms.map((form) => (
          <FormView key={form.id} nav={nav} form={form} />
        ))}
      </div>
    </ScrollArea>
  )
}

export function PendingInbox({ nav }: { nav: OpenCodeController }) {
  const [open, setOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const count = nav.pendingPermissions.length + nav.pendingForms.length
  const questionCount = nav.pendingForms.length

  if (count === 0) {
    return null
  }

  const description =
    count === 1
      ? "One request is waiting for your answer."
      : `${count} requests are waiting for your answer.`

  const trigger = questionCount > 0 ? (
    <Button
      variant="outline"
      className="mx-4 mt-2 h-auto min-h-14 w-[calc(100%-2rem)] justify-between gap-3 whitespace-normal border-amber-500/70 bg-amber-500/15 px-4 py-3 text-start text-foreground shadow-sm ring-1 ring-amber-500/30 hover:bg-amber-500/20 dark:border-amber-400/70 dark:bg-amber-400/15 dark:ring-amber-400/30 dark:hover:bg-amber-400/20"
    >
      <span className="flex min-w-0 items-center gap-3">
        <MessageCircleQuestionIcon aria-hidden="true" className="size-5 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold">
          {questionCount === 1 ? "A question needs your answer" : `${questionCount} questions need your answer`}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-amber-700 underline underline-offset-4 dark:text-amber-300">
        Review
      </span>
    </Button>
  ) : (
    <Button
      variant="outline"
      aria-label={`${count} pending request${count === 1 ? "" : "s"}`}
      className="h-11 gap-2 rounded-full px-4 text-[13px] font-medium"
    >
      <BellIcon aria-hidden="true" className="size-4" />
      {count}
    </Button>
  )

  const list = <PendingList nav={nav} />

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={trigger} />
        <DialogContent className="max-w-lg md:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold tracking-tight">
              Pending requests
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {list}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="bottom" className="overflow-hidden rounded-t-xl px-4 pb-4" style={fixedMobileDrawerStyle()}>
        <SheetHeader className="shrink-0 px-0 pe-12">
          <SheetTitle className="text-base font-semibold tracking-tight">
            Pending requests
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {list}
      </SheetContent>
    </Sheet>
  )
}
