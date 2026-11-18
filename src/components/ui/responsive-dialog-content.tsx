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
        "p-4",
        className,
        "w-full max-w-none overflow-y-auto rounded-t-xl sm:max-w-none"
      )}
      style={{ ...style, ...fixedMobileDrawerStyle() }}
      {...props}
    />
  )
}
