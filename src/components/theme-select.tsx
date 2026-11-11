import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { ACCENTS, PALETTES } from "@/lib/theme-appearance"

const modes = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const

/**
 * Appearance controls. Rendered inside the Settings workspace (Appearance
 * section); the old sidebar trigger/dialog entry points are retired.
 */
export function AppearancePanel() {
  const { theme, setTheme, palette, setPalette, accent, setAccent } = useTheme()
  return (
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
  )
}
