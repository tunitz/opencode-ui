import type * as React from "react"
import { cn } from "cn"

import { DialogContent } from "@/components/ui/dialog"
import { SheetContent } from "@/components/ui/sheet"
import { fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import { useIsDesktop } from "@/lib/use-is-desktop"

/** Dialog and Sheet share Base UI's dialog root, title, and focus management. */
export function ResponsiveDialogContent({
  className,
  style,
  forceRenderBackdrop,
  ...props
}: React.ComponentProps<typeof DialogContent> & { forceRenderBackdrop?: boolean }) {
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return <DialogContent className={className} style={style} {...props} />
  }

  return (
    <SheetContent
      side="bottom"
      forceRenderBackdrop={forceRenderBackdrop}
      className={cn(
        "w-full max-w-none overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none",
        className
      )}
      style={{ ...style, ...fixedMobileDrawerStyle() }}
      {...props}
    />
  )
}
