import { useState } from "react"
import { ChevronDownIcon, InfoIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/**
 * On-demand supplementary help for a control or section.
 *
 * The trigger keeps a 44px touch target and full keyboard/expanded semantics
 * through Base UI Collapsible. Use it for secondary explanation only: current
 * values, state, consequences, and errors stay visible outside it.
 */
function HelpDisclosure({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-11 w-full justify-start gap-1.5 rounded-lg px-1.5 py-1 text-start text-[12px] font-normal whitespace-normal text-muted-foreground hover:text-foreground"
          />
        }
      >
        <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0">{label}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 motion-safe:transition-transform",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1.5 pb-1 ps-6 text-[12px] leading-5 text-muted-foreground">
        <div className="space-y-1.5 pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { HelpDisclosure }
