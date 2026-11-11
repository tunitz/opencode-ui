import { useEffect, useRef } from "react"
import { ArrowLeftIcon, SettingsIcon } from "lucide-react"

import {
  useOptionalSettingsWorkspace,
  useSettingsWorkspace,
} from "@/components/settings-context"
import {
  SETTINGS_SECTIONS,
  settingsSection,
} from "@/components/settings-sections"
import { Button } from "@/components/ui/button"
import { recordPerfRender } from "@/lib/perf-probe"
import type { OpenCodeController } from "@/lib/use-opencode"
import { cn } from "@/lib/utils"

export function SettingsTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label="Settings"
      className="size-11 shrink-0 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
      onClick={onClick}
    >
      <SettingsIcon aria-hidden="true" className="size-[18px] text-muted-foreground" />
    </Button>
  )
}

/** Sidebar entry point. The workspace itself is rendered by the app shell. */
export function SettingsButton() {
  const settings = useOptionalSettingsWorkspace()
  return <SettingsTriggerButton onClick={() => settings?.openSettings()} />
}

/**
 * Full-width Settings workspace, following the Notes workspace pattern:
 * selector list + detail at `@[40rem]`, one pane below it, nav rows with
 * `aria-current`, and an in-pane back button on mobile.
 */
export function SettingsWorkspace({ nav }: { nav: OpenCodeController }) {
  recordPerfRender("SettingsWorkspace")
  const settings = useSettingsWorkspace()
  const rootRef = useRef<HTMLElement>(null)
  const active = settingsSection(settings.section)
  const Section = active.Component

  // Move focus into the workspace on open; the shell restores it on close.
  useEffect(() => {
    if (settings.open) rootRef.current?.focus?.()
  }, [settings.open])

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label="Settings"
      className="@container flex min-h-0 flex-1 flex-col focus:outline-none"
    >
      <div className="flex min-h-0 flex-1 gap-6">
        <div
          className={cn(
            "min-h-0 flex-col overflow-y-auto @[40rem]:flex @[40rem]:w-56 @[40rem]:shrink-0 @[40rem]:border-e @[40rem]:border-border @[40rem]:pe-6",
            settings.detailView ? "hidden" : "flex"
          )}
        >
          <nav aria-label="Settings sections" className="py-1">
            <ul className="grid gap-1">
              {SETTINGS_SECTIONS.map(({ id, label, Icon }) => {
                const selected = id === settings.section
                return (
                  <li key={id}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-current={selected ? "page" : undefined}
                      onClick={() => settings.selectSection(id)}
                      className={cn(
                        "min-h-11 w-full justify-start gap-3 px-3 text-sm",
                        selected && "bg-accent text-accent-foreground hover:bg-accent"
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-2 @[40rem]:flex",
            settings.detailView ? "flex" : "hidden"
          )}
        >
          <div className="grid gap-4">
            <div className="@[40rem]:hidden">
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-fit"
                onClick={settings.showSectionList}
              >
                <ArrowLeftIcon
                  data-icon="inline-start"
                  className="rtl:rotate-180"
                  aria-hidden="true"
                />
                All settings
              </Button>
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight">
                {active.label}
              </h2>
              {active.description ? (
                <p className="text-sm text-muted-foreground">
                  {active.description}
                </p>
              ) : null}
            </div>
            <Section nav={nav} />
          </div>
        </div>
      </div>
    </section>
  )
}
