import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTheme } from "@/components/theme-provider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Theme = "light" | "dark" | "system"

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

function ThemeIcon({ theme, className }: { theme: Theme; className?: string }) {
  if (theme === "light") {
    return <SunIcon className={className} aria-hidden="true" />
  }

  if (theme === "dark") {
    return <MoonIcon className={className} aria-hidden="true" />
  }

  return <MonitorIcon className={className} aria-hidden="true" />
}

export function ThemeSelect({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const label = OPTIONS.find((option) => option.value === theme)?.label ?? "System"

  return (
    <div className={cn("flex min-w-0", className)}>
      <Select
        value={theme}
        onValueChange={(value) => {
          if (value) {
            setTheme(value as Theme)
          }
        }}
        modal={false}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                aria-label={`Theme: ${label}`}
                showIcon={false}
                className="size-11! shrink-0 justify-center rounded-lg border-sidebar-border bg-transparent p-0 text-sidebar-foreground hover:bg-sidebar-accent dark:bg-transparent dark:hover:bg-sidebar-accent"
              >
                <SelectValue className="flex-none justify-center">
                  <ThemeIcon
                    theme={theme}
                    className="size-[18px] text-muted-foreground"
                  />
                </SelectValue>
              </SelectTrigger>
            }
          />
          <TooltipContent side="top">Theme: {label}</TooltipContent>
        </Tooltip>
        <SelectContent
          side="top"
          align="start"
          alignItemWithTrigger={false}
          sideOffset={8}
          className="p-1"
          style={{
            width: "min(14rem, calc(100vw - 2rem))",
          }}
        >
          {OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="min-h-11 py-2 ps-2"
            >
              <span className="flex items-center gap-2">
                <ThemeIcon
                  theme={option.value}
                  className="size-4 text-muted-foreground"
                />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
