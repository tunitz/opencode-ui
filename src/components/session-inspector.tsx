import { useEffect, useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  SettingsIcon,
  FolderGit2Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"

import type { InspectorPanelHandle } from "@/components/files-panel"
import {
  getInspectorTab,
  INSPECTOR_TABS,
} from "@/components/inspector/registry"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fixedMobileDrawerStyle } from "@/lib/drawer-layout"
import { contextLimitForModel, formatTokenCount } from "@/lib/context-usage"
import { INSPECTOR_TAB_LABELS, type InspectorTab } from "@/lib/inspector-tabs"
import { useIsDesktop } from "@/lib/use-is-desktop"
import type { OpenCodeController } from "@/lib/use-opencode"
import { DESKTOP_SIDEBAR_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "@/lib/sidebar-layout"
import { cn } from "@/lib/utils"
import { recordPerfRender } from "@/lib/perf-probe"

const INSPECTOR_ID = "session-inspector"

function focusInspectorTrigger() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>("[data-inspector-trigger]")?.focus()
  })
}

function liveStatus(nav: OpenCodeController): string {
  if (nav.runningSessionIDs[nav.activeSessionID ?? ""]) return "Running"
  if (nav.inbox.length > 0) return `${nav.inbox.length} queued`
  if (nav.pendingPermissions.length + nav.pendingForms.length > 0) {
    return "Needs an answer"
  }
  return "Idle"
}

function contextSummary(nav: OpenCodeController): string | null {
  const session = nav.activeSession
  if (!session) return null
  const limit = contextLimitForModel(nav.models, session.model)
  const tokens = session.tokens
  if (!tokens) return null
  const used = tokens.input + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  if (!limit) return `${formatTokenCount(used)} tokens`
  return `${Math.min(100, Math.round((used / limit) * 100))}% ctx`
}

function InspectorTrigger({
  nav,
  sheet = false,
}: {
  nav: OpenCodeController
  sheet?: boolean
}) {
  const open = nav.inspectorOpen
  const button = (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label="Session inspector"
      data-inspector-trigger=""
      aria-expanded={sheet ? undefined : open}
      aria-controls={!sheet && open ? INSPECTOR_ID : undefined}
      onClick={
        sheet
          ? undefined
          : () => {
              if (open) nav.closeInspector()
              else nav.openInspector(nav.inspectorTab)
            }
      }
      className="size-11 rounded-full text-foreground"
    />
  )

  return (
    <Tooltip>
      <TooltipTrigger render={sheet ? <SheetTrigger render={button} /> : button}>
        <ListTreeIcon aria-hidden="true" className="size-5" />
      </TooltipTrigger>
      <TooltipContent side="bottom">Session inspector</TooltipContent>
    </Tooltip>
  )
}

function TabStrip({
  nav,
  mode,
}: {
  nav: OpenCodeController
  mode: "sheet" | "sidebar"
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const syncEdges = () => {
    const element = scrollRef.current
    if (!element) return
    const maximum = element.scrollWidth - element.clientWidth
    const position = Math.abs(element.scrollLeft)
    setEdges({
      start: position > 2,
      end: maximum > 2 && position < maximum - 2,
    })
  }

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    syncEdges()
    const observer = new ResizeObserver(syncEdges)
    observer.observe(element)
    element.addEventListener("scroll", syncEdges, { passive: true })
    window.addEventListener("resize", syncEdges)
    return () => {
      observer.disconnect()
      element.removeEventListener("scroll", syncEdges)
      window.removeEventListener("resize", syncEdges)
    }
  }, [])

  // Keep the selected tab visible after a click, keyboard change, or resize.
  useEffect(() => {
    const element = scrollRef.current
    const active = element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!element || !active) return
    const container = element.getBoundingClientRect()
    const tab = active.getBoundingClientRect()
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth"
    if (tab.left < container.left + 8) {
      element.scrollBy({ left: tab.left - container.left - 8, behavior })
    } else if (tab.right > container.right - 8) {
      element.scrollBy({ left: tab.right - container.right + 8, behavior })
    }
  }, [nav.inspectorTab])

  function scrollTabs(direction: -1 | 1) {
    const element = scrollRef.current
    if (!element) return
    const rtl = document.documentElement.getAttribute("dir") === "rtl"
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    element.scrollBy({
      left: direction * (rtl ? -1 : 1) * Math.max(120, element.clientWidth * 0.75),
      behavior: reduced ? "auto" : "smooth",
    })
  }

  return (
    <div className="relative shrink-0">
      <div
        ref={scrollRef}
        role="tablist"
        aria-label="Inspector sections"
        data-inspector-tablist
        className="flex overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onKeyDown={(event) => {
          const keys = ["ArrowRight", "ArrowLeft", "Home", "End"]
          if (!keys.includes(event.key)) return
          event.preventDefault()
          const rtl = document.documentElement.getAttribute("dir") === "rtl"
          const current = INSPECTOR_TABS.findIndex((tab) => tab.id === nav.inspectorTab)
          let next: number
          if (event.key === "Home") next = 0
          else if (event.key === "End") next = INSPECTOR_TABS.length - 1
          else {
            const delta = event.key === "ArrowRight" ? 1 : -1
            next = (current + (rtl ? -delta : delta) + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
          }
          const target = INSPECTOR_TABS[next]
          nav.setInspectorTab(target.id)
          document
            .getElementById(`${INSPECTOR_ID}-tab-${target.id}`)
            ?.focus()
        }}
      >
        {INSPECTOR_TABS.map((tab) => {
          const selected = nav.inspectorTab === tab.id
          const badge = tab.badge(nav)
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${INSPECTOR_ID}-panel-${tab.id}`}
              id={`${INSPECTOR_ID}-tab-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-inspector-tab={tab.id}
              onClick={() => nav.setInspectorTab(tab.id as InspectorTab)}
              className={cn(
                "relative flex min-h-11 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[12px] font-medium transition-colors motion-reduce:transition-none",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span className="whitespace-nowrap">{tab.label}</span>
              {badge > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[10px] tabular-nums text-primary-foreground">
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground"
                />
              ) : null}
            </button>
          )
        })}
      </div>

      {edges.start ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0 start-0 w-12 bg-linear-to-r to-transparent",
              mode === "sheet" ? "from-card via-card/90" : "from-sidebar via-sidebar/90"
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Previous inspector tabs"
            className="absolute inset-y-0 start-0 h-11 w-11 rounded-full text-muted-foreground"
            onClick={() => scrollTabs(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
          </Button>
        </>
      ) : null}

      {edges.end ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0 end-0 w-12 bg-linear-to-l to-transparent",
              mode === "sheet" ? "from-card via-card/90" : "from-sidebar via-sidebar/90"
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="More inspector tabs"
            aria-hidden={false}
            className="absolute inset-y-0 end-0 h-11 w-11 rounded-full text-muted-foreground"
            onClick={() => scrollTabs(1)}
          >
            <ChevronRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
          </Button>
        </>
      ) : null}
    </div>
  )
}

function InspectorBody({
  nav,
  mode,
  onOpenSettings,
  onOpenWorktrees,
}: {
  nav: OpenCodeController
  mode: "sheet" | "sidebar"
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}) {
  recordPerfRender("SessionInspector")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [filesPath, setFilesPath] = useState<string | undefined>(undefined)
  const filesRefreshRef = useRef<InspectorPanelHandle | null>(null)
  const changesRefreshRef = useRef<InspectorPanelHandle | null>(null)
  const tab = nav.inspectorTab
  const definition = getInspectorTab(tab)
  const Panel = definition.component
  const context = contextSummary(nav)

  useEffect(() => {
    void Promise.resolve().then(() => {
      setRefreshMessage(null)
    })
  }, [nav.activeSessionID, tab])

  useEffect(() => {
    void Promise.resolve().then(() => setFilesPath(undefined))
  }, [nav.activeSessionID])

  if (!nav.activeSession) return null

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      if (tab === "files" || tab === "changes") {
        const handle =
          tab === "files" ? filesRefreshRef.current : changesRefreshRef.current
        const failure = handle ? await handle.refresh() : "This panel is not ready yet."
        setRefreshMessage(
          failure === undefined
            ? "Refreshed."
            : failure
              ? `Refresh failed: ${failure}`
              : "Refreshed."
        )
      } else {
        nav.refreshSessions()
        await nav.loadInbox()
        if (tab === "session") await nav.loadArchivedSessions()
        setRefreshMessage("Refreshed native state.")
      }
    } catch (error) {
      setRefreshMessage(
        `Refresh failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setRefreshing(false)
    }
  }

  const refreshButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            aria-label="Refresh inspector"
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            className="size-11 rounded-full p-0"
          />
        }
      >
        {refreshing ? (
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <RefreshCwIcon aria-hidden="true" className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">Refresh</TooltipContent>
    </Tooltip>
  )

  return (
    <>
      {mode === "sheet" ? (
        <div className="shrink-0 px-4 pt-1.5">
          <div
            aria-hidden="true"
            className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-muted-foreground/30"
          />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-[15px] font-semibold tracking-tight">
                Inspector
              </SheetTitle>
              <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                <span>{liveStatus(nav)}</span>
                {context ? <span className="tabular-nums">{context}</span> : null}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {refreshButton}
              <SheetClose
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Close session inspector"
                    className="size-11 rounded-full p-0"
                  />
                }
                onClick={focusInspectorTrigger}
              >
                <XIcon aria-hidden="true" className="size-5" />
              </SheetClose>
            </div>
          </div>
        </div>
      ) : (
        <div className="shrink-0 px-4 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold tracking-tight">
                Inspector
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span>{liveStatus(nav)}</span>
                {context ? <span className="tabular-nums">{context}</span> : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {refreshButton}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Collapse session inspector"
                      className="size-11 rounded-full p-0"
                      onClick={() => {
                        nav.closeInspector()
                        requestAnimationFrame(() => {
                          document
                            .querySelector<HTMLElement>("[data-inspector-rail-trigger]")
                            ?.focus()
                        })
                      }}
                    />
                  }
                >
                  <PanelRightCloseIcon aria-hidden="true" className="size-5" />
                </TooltipTrigger>
                <TooltipContent side="left">Collapse inspector</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      )}

      {refreshMessage ? (
        <p
          role="status"
          className={cn(
            "mx-3 mt-1.5 rounded-lg px-2 py-1 text-[11px] break-words",
            refreshMessage.startsWith("Refresh failed")
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {refreshMessage}
        </p>
      ) : null}

      <div className={cn("mt-1 shrink-0", mode === "sheet" && "sticky top-0 z-10 bg-card")}>
        <TabStrip nav={nav} mode={mode} />
      </div>

      <div
        id={`${INSPECTOR_ID}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${INSPECTOR_ID}-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {tab === "command" ? (
          <Panel
            nav={nav}
            mode={mode}
            filesRefreshRef={filesRefreshRef}
            changesRefreshRef={changesRefreshRef}
            filesInitialPath={filesPath}
            onOpenFile={(path) => {
              setFilesPath(path)
              nav.setInspectorTab("files")
            }}
            onClose={() => {
              nav.closeInspector()
              if (mode === "sheet") focusInspectorTrigger()
            }}
            onOpenSettings={onOpenSettings}
            onOpenWorktrees={onOpenWorktrees}
          />
        ) : (
          <ScrollArea
            viewportClassName="h-full"
            className={cn(
              "h-full px-4",
              mode === "sheet"
                ? "pb-[max(1rem,env(safe-area-inset-bottom))]"
                : "pb-4"
            )}
          >
            <Panel
              nav={nav}
              mode={mode}
              filesRefreshRef={filesRefreshRef}
              changesRefreshRef={changesRefreshRef}
              filesInitialPath={filesPath}
              onOpenFile={(path) => {
                setFilesPath(path)
                nav.setInspectorTab("files")
              }}
              onClose={() => {
                nav.closeInspector()
                if (mode === "sheet") focusInspectorTrigger()
              }}
              onOpenSettings={onOpenSettings}
              onOpenWorktrees={onOpenWorktrees}
            />
          </ScrollArea>
        )}
      </div>
    </>
  )
}

/** Mobile trigger + bottom sheet. Desktop uses the persistent right sidebar. */
export function SessionInspector({
  nav,
  onOpenSettings,
  onOpenWorktrees,
}: {
  nav: OpenCodeController
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}) {
  const isDesktop = useIsDesktop()
  const open = nav.inspectorOpen

  if (!nav.activeSession || isDesktop) return null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          nav.closeInspector()
          return
        }
        if (!nav.inspectorOpen) nav.openInspector(nav.inspectorTab)
      }}
    >
      <InspectorTrigger nav={nav} sheet />
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-fixed-drawer="inspector"
        className="gap-0 overflow-hidden rounded-t-xl bg-card p-0"
        style={fixedMobileDrawerStyle()}
      >
        <InspectorBody
          nav={nav}
          mode="sheet"
          onOpenSettings={onOpenSettings}
          onOpenWorktrees={onOpenWorktrees}
        />
      </SheetContent>
    </Sheet>
  )
}

function InspectorRail({
  nav,
  onOpenSettings,
  onOpenWorktrees,
}: {
  nav: OpenCodeController
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}) {
  return (
    <aside
      data-desktop-sidebar="inspector"
      data-inspector-mode="rail"
      data-side="right"
      aria-label="Session inspector collapsed"
      style={{ backgroundColor: "var(--sidebar)" }}
      className={cn(
        "flex h-svh shrink-0 flex-col items-center border-s border-sidebar-border bg-sidebar",
        DESKTOP_SIDEBAR_RAIL_WIDTH
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Expand session inspector"
                aria-expanded={false}
                data-inspector-rail-trigger=""
                onClick={() => nav.openInspector(nav.inspectorTab)}
                className="size-11 rounded-lg text-foreground"
              />
            }
          >
            <PanelRightOpenIcon aria-hidden="true" className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="left">Expand session inspector</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1 p-2">
        {INSPECTOR_TABS.map((tab) => {
          const Icon = tab.icon
          const badge = tab.badge(nav)
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    aria-label={`Show inspector ${INSPECTOR_TAB_LABELS[tab.id]}`}
                    onClick={() => nav.openInspector(tab.id)}
                    className="relative size-11 rounded-lg text-muted-foreground"
                  />
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {badge > 0 ? (
                  <span className="absolute end-1 top-1 size-1.5 rounded-full bg-primary" />
                ) : null}
              </TooltipTrigger>
              <TooltipContent side="left">{tab.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <div className="mt-auto flex flex-col gap-1 p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Inspector settings"
          className="size-11 rounded-lg text-muted-foreground"
          onClick={onOpenSettings}
        >
          <SettingsIcon aria-hidden="true" className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Project worktrees"
          className="size-11 rounded-lg text-muted-foreground"
          onClick={onOpenWorktrees}
        >
          <FolderGit2Icon aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </aside>
  )
}

/**
 * Persistent, non-modal desktop inspector. It pushes the conversation instead
 * of overlaying it and stays open until collapsed; clicking outside never
 * dismisses it. The collapsed rail mirrors every inspector tab.
 */
export function SessionInspectorPanel({
  nav,
  onOpenSettings,
  onOpenWorktrees,
}: {
  nav: OpenCodeController
  onOpenSettings: () => void
  onOpenWorktrees: () => void
}) {
  const isDesktop = useIsDesktop()

  if (!isDesktop || !nav.activeSession) return null

  if (!nav.inspectorOpen) {
    return (
      <InspectorRail
        nav={nav}
        onOpenSettings={onOpenSettings}
        onOpenWorktrees={onOpenWorktrees}
      />
    )
  }

  return (
    <aside
      id={INSPECTOR_ID}
      data-desktop-sidebar="inspector"
      data-inspector-mode="full"
      data-side="right"
      aria-label="Session inspector"
      style={{ backgroundColor: "var(--sidebar)" }}
      className={cn(
        "flex h-svh shrink-0 flex-col overflow-hidden border-s border-sidebar-border bg-sidebar",
        DESKTOP_SIDEBAR_WIDTH
      )}
    >
      <InspectorBody
        nav={nav}
        mode="sidebar"
        onOpenSettings={onOpenSettings}
        onOpenWorktrees={onOpenWorktrees}
      />
    </aside>
  )
}
