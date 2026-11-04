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
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return <DialogContent className={className} style={style} {...props} />
  }

  return (
    <SheetContent
      side="bottom"
      className={cn(
        "p-4",
        className,
        "w-full max-w-none overflow-y-auto rounded-t-xl sm:max-w-none [&>*]:shrink-0"
      )}
      style={{ ...style, ...fixedMobileDrawerStyle() }}
      {...props}
    />
  )
}
