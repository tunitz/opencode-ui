import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/** Compact toggle with a 44px touch target and a clearly checked state. */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  className?: string
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn(
        "relative inline-flex h-11 w-20 shrink-0 cursor-pointer items-center rounded-full border border-input bg-muted p-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary",
        className
      )}
    >
      <SwitchPrimitive.Thumb className="size-8 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-9 motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  )
}
