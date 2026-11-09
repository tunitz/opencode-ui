import { useRef, useState, type RefObject } from "react"
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fixedDesktopSettingsStyle, fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import { ACCENTS, PALETTES } from "@/lib/theme-appearance"
import { useIsDesktop } from "@/lib/use-is-desktop"
import { cn } from "@/lib/utils"

const modes = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const

function AppearancePanel() {
  const { theme, setTheme, palette, setPalette, accent, setAccent } = useTheme()
  return (
    <>
      <div className="shrink-0 border-b px-5 py-4 pe-14">
        <h2 id="appearance-title" className="text-base font-semibold">Appearance</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="grid gap-6">
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-2 text-sm font-medium">Theme</legend>
            <div className="grid grid-cols-3 gap-2">
              {modes.map(({ value, label, Icon }) => (
                <label key={value} className="relative min-w-0 cursor-pointer">
                  <input className="peer sr-only" type="radio" name="appearance-theme" value={value} checked={theme === value} onChange={() => setTheme(value)} />
                  <span className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-input px-2 text-sm peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />{label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-2 text-sm font-medium">Palette</legend>
            <div className="grid grid-cols-3 gap-2">
              {PALETTES.map((value) => (
                <label key={value} className="relative min-w-0 cursor-pointer">
                  <input className="peer sr-only" type="radio" name="appearance-palette" value={value} checked={palette === value} onChange={() => setPalette(value)} />
                  <span className="flex flex-col gap-2 rounded-lg border border-input p-2 peer-checked:border-primary peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                    <span aria-hidden="true" data-preview-palette={value} className="appearance-preview flex h-16 overflow-hidden rounded-md border p-1.5" dir="ltr">
                      <span className="appearance-preview-sidebar w-1/4 rounded-sm" />
                      <span className="flex flex-1 flex-col gap-1.5 p-1.5"><span className="appearance-preview-line w-3/4" /><span className="appearance-preview-line w-1/2" /><span className="appearance-preview-accent w-1/3" /></span>
                    </span>
                    <span className="flex min-h-6 items-center justify-between gap-1 text-sm font-medium"><span className="truncate">{value[0].toUpperCase() + value.slice(1)}</span>{palette === value && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-2 text-sm font-medium">Accent</legend>
            <div className="grid grid-cols-2 gap-2">
              {ACCENTS.map((value) => (
                <label key={value} className="relative min-w-0 cursor-pointer">
                  <input className="peer sr-only" type="radio" name="appearance-accent" value={value} checked={accent === value} onChange={() => setAccent(value)} />
                  <span className="flex min-h-11 items-center gap-2 rounded-lg border border-input px-3 text-sm peer-checked:border-primary peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                    <span aria-hidden="true" data-preview-accent={value} className="appearance-accent-swatch size-4 shrink-0 rounded-full border border-foreground/20" />
                    <span className="min-w-0 flex-1 truncate">{value[0].toUpperCase() + value.slice(1)}</span>
                    {accent === value && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <div className="text-sm font-medium">Preview</div>
            <div dir="ltr" className="rounded-lg border bg-background p-3 font-mono text-sm leading-6 text-foreground">
              <div><span className="text-primary">~/project</span> $ opencode</div>
              <div className="font-semibold text-primary">Summary</div>
              <div>Ready to build.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export function AppearanceTrigger({ onClick, buttonRef }: { onClick: () => void; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  const { theme } = useTheme()
  const Icon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon
  return <Tooltip><TooltipTrigger render={<button ref={buttonRef} type="button" onClick={onClick} aria-label={`Theme: ${theme}`} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />}><Icon className="size-[18px] text-muted-foreground" aria-hidden="true" /></TooltipTrigger><TooltipContent side="top">Appearance</TooltipContent></Tooltip>
}

export function AppearanceDialog({ open, onOpenChange, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; finalFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null) }) {
  const isDesktop = useIsDesktop()
  return isDesktop ? <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent finalFocus={finalFocus} aria-labelledby="appearance-title" aria-describedby={undefined} className="flex w-[min(48rem,92vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none" style={fixedDesktopSettingsStyle()}><AppearancePanel /></DialogContent>
  </Dialog> : <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent finalFocus={finalFocus} side="bottom" aria-labelledby="appearance-title" aria-describedby={undefined} className="gap-0 overflow-hidden rounded-t-xl p-0" style={fixedMobileDrawerStyle()}><AppearancePanel /></SheetContent>
  </Sheet>
}

export function ThemeSelect({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return <div className={cn("flex min-w-0", className)}>
    <AppearanceTrigger buttonRef={triggerRef} onClick={() => setOpen(true)} />
    <AppearanceDialog open={open} onOpenChange={setOpen} finalFocus={triggerRef} />
  </div>
}
