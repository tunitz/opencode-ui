import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { SettingsIcon } from "lucide-react"

import {
  useOptionalSettingsWorkspace,
  useSettingsWorkspace,
  type SettingsSectionID,
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

const tabID = (id: SettingsSectionID) => `settings-tab-${id}`
const panelID = (id: SettingsSectionID) => `settings-panel-${id}`

function documentDirection(): "ltr" | "rtl" {
  if (typeof document === "undefined") return "ltr"
  return document.documentElement?.getAttribute("dir") === "rtl" ? "rtl" : "ltr"
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Full-width Settings workspace: a sticky horizontal tab bar over one content
 * pane at every width. The tab bar is a WAI-ARIA tablist with roving focus;
 * switching tabs always lands on the section immediately, with no list/detail
 * step to back out of.
 */
export function SettingsWorkspace({ nav }: { nav: OpenCodeController }) {
  recordPerfRender("SettingsWorkspace")
  const settings = useSettingsWorkspace()
  const rootRef = useRef<HTMLElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<SettingsSectionID, HTMLButtonElement | null>())
  const [edges, setEdges] = useState({ start: false, end: false })
  const active = settingsSection(settings.section)
  const Section = active.Component

  // Fade an edge only while more tabs are scrolled out of view.
  const updateEdges = useCallback(() => {
    const element = tabListRef.current
    if (!element) return
    const max = element.scrollWidth - element.clientWidth
    const offset = Math.abs(element.scrollLeft)
    const next = {
      start: offset > 1,
      end: max > 1 && offset < max - 1,
    }
    setEdges((previous) =>
      previous.start === next.start && previous.end === next.end
        ? previous
        : next
    )
  }, [])

  useEffect(() => {
    const element = tabListRef.current
    if (!element) return
    updateEdges()
    element.addEventListener("scroll", updateEdges, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateEdges)
    observer?.observe(element)
    return () => {
      element.removeEventListener("scroll", updateEdges)
      observer?.disconnect()
    }
  }, [updateEdges])

  // Desktop mouse wheels (and shift+wheel) scroll the overflowing tab strip.
  // Trackpad horizontal gestures and rows with nothing to scroll stay native.
  // A native listener is required: React's delegated wheel handler is passive.
  useEffect(() => {
    const element = tabListRef.current
    if (!element) return
    const strip: HTMLDivElement = element
    function handleWheel(event: WheelEvent) {
      // Ctrl+wheel is zoom, never scroll.
      if (event.ctrlKey) return
      if (strip.scrollWidth - strip.clientWidth <= 1) return
      // A horizontal gesture belongs to the trackpad; leave it to the browser.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1
      const delta = (event.deltaX + event.deltaY) * unit
      strip.scrollLeft += delta * (documentDirection() === "rtl" ? -1 : 1)
    }
    strip.addEventListener("wheel", handleWheel, { passive: false })
    return () => strip.removeEventListener("wheel", handleWheel)
  }, [])

  // Move focus into the workspace on open; the shell restores it on close.
  useEffect(() => {
    if (settings.open) rootRef.current?.focus?.()
  }, [settings.open])

  // Keep the selected tab visible after a click, keyboard change, or resize.
  useEffect(() => {
    const tab = tabRefs.current.get(settings.section)
    if (!tab) return
    tab.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    })
  }, [settings.section])

  // A tab switch starts its section at the top instead of inheriting the
  // previous section's scroll offset.
  useEffect(() => {
    panelRef.current?.scrollTo?.({ top: 0 })
  }, [settings.section])

  function selectTab(id: SettingsSectionID) {
    settings.selectSection(id)
    tabRefs.current.get(id)?.focus?.()
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"]
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const current = SETTINGS_SECTIONS.findIndex(
      (section) => section.id === settings.section
    )
    let next: number
    if (event.key === "Home") next = 0
    else if (event.key === "End") next = SETTINGS_SECTIONS.length - 1
    else {
      const delta = event.key === "ArrowRight" ? 1 : -1
      const direction = documentDirection() === "rtl" ? -delta : delta
      next =
        (current + direction + SETTINGS_SECTIONS.length) %
        SETTINGS_SECTIONS.length
    }
    selectTab(SETTINGS_SECTIONS[next].id)
  }

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label="Settings"
      className="@container flex min-h-0 flex-1 flex-col focus:outline-none"
    >
      <div className="sticky top-0 z-10 shrink-0 bg-background/95 backdrop-blur">
        <div className="relative">
          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Settings sections"
            aria-orientation="horizontal"
            className="flex gap-2 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onKeyDown={handleTabKeyDown}
          >
            {SETTINGS_SECTIONS.map(({ id, label, Icon }) => {
              const selected = id === settings.section
              return (
                <button
                  key={id}
                  ref={(node) => {
                    tabRefs.current.set(id, node)
                  }}
                  type="button"
                  role="tab"
                  id={tabID(id)}
                  aria-selected={selected}
                  aria-controls={selected ? panelID(id) : undefined}
                  tabIndex={selected ? 0 : -1}
                  data-settings-tab={id}
                  onClick={() => selectTab(id)}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-foreground motion-reduce:transition-none",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              )
            })}
          </div>
          {edges.start ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-0 w-8 bg-linear-to-r from-background to-transparent rtl:bg-linear-to-l"
            />
          ) : null}
          {edges.end ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 end-0 w-8 bg-linear-to-l from-background to-transparent rtl:bg-linear-to-r"
            />
          ) : null}
        </div>
      </div>
      <div
        ref={panelRef}
        id={panelID(active.id)}
        role="tabpanel"
        aria-labelledby={tabID(active.id)}
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto pt-4 pb-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring/40"
      >
        {/* An explicit minmax(0,1fr) track keeps long, nowrap agent rows from
            sizing this grid (and the cards inside it) past the panel width. */}
        <div className="grid min-w-0 grid-cols-1 gap-4">
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
    </section>
  )
}
