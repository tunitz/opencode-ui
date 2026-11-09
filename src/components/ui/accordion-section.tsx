import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

export function AccordionSection({
  value,
  title,
  count,
  children,
  className,
  triggerClassName,
  contentClassName,
}: {
  value: string
  title: ReactNode
  count?: number
  children: ReactNode
  className?: string
  triggerClassName?: string
  contentClassName?: string
}) {
  return (
    <AccordionItem
      value={value}
      className={cn(
        "overflow-hidden rounded-xl border border-foreground/10 bg-card",
        className
      )}
    >
      <AccordionHeader>
        <AccordionTrigger
          className={cn(
            "group/accordion-section rounded-none px-3 hover:bg-muted/60",
            triggerClassName
          )}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-[13px] font-medium text-foreground">
              {title}
            </span>
            {typeof count === "number" ? (
              <span className="text-[11px] font-normal text-muted-foreground">
                {count}
              </span>
            ) : null}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/accordion-section:rotate-90 motion-reduce:transition-none"
          />
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel>
        <div className={cn("border-t border-foreground/10 px-3 py-3", contentClassName)}>
          {children}
        </div>
      </AccordionPanel>
    </AccordionItem>
  )
}
