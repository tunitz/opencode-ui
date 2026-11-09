import { useEffect, useRef, useState } from "react"
import {
  FileTextIcon,
  GitCompareArrowsIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"

import {
  ChangesPanel,
  FilesPanel,
  type InspectorPanelHandle,
} from "@/components/files-panel"
import { WorkingTreeShortcut } from "@/components/working-tree-shortcut"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fixedMobileDrawerStyle } from "@/lib/drawer-layout"
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
      aria-label="Session inspector: files and working tree"
      data-inspector-trigger=""
      aria-expanded={sheet ? undefined : open}
      aria-controls={!sheet && open ? INSPECTOR_ID : undefined}
      onClick={
        sheet
          ? undefined
          : () => {
              if (open) {
                nav.closeInspector()
              } else {
                nav.openInspector(nav.inspectorTab)
              }
            }
      }
      className="size-11 rounded-full text-foreground"
    />
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={sheet ? <SheetTrigger render={button} /> : button}
      >
        <ListTreeIcon aria-hidden="true" className="size-5" />
      </TooltipTrigger>
      <TooltipContent side="bottom">Session inspector</TooltipContent>
    </Tooltip>
  )
}

function InspectorBody({
  nav,
  mode,
}: {
  nav: OpenCodeController
  mode: "sheet" | "sidebar"
}) {
  recordPerfRender("SessionInspector")
  const tab = nav.inspectorTab
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [preview, setPreview] = useState<{ context: string; path: string; sequence: number } | null>(null)
  const refreshRun = useRef(0)
  const tabRef = useRef(tab)
  const sessionRef = useRef(nav.activeSessionID)
  const filesRefreshRef = useRef<InspectorPanelHandle | null>(null)
  const changesRefreshRef = useRef<InspectorPanelHandle | null>(null)
  const previewContext = JSON.stringify([nav.activeSessionID, nav.activeSession?.location?.directory])

  useEffect(() => {
    tabRef.current = tab
    sessionRef.current = nav.activeSessionID
    refreshRun.current += 1
    void Promise.resolve().then(() => {
      setRefreshing(false)
      setRefreshError(null)
      setLastUpdated(null)
    })
  }, [nav.activeSessionID, nav.inspectorTab, tab])

  if (!nav.activeSession) {
    return null
  }

  const sessionTitle =
    nav.activeSession.title?.trim() || "Untitled session"

  async function handleRefresh() {
    if (refreshing) return
    const run = ++refreshRun.current
    const startedTab = tabRef.current
    const startedSession = sessionRef.current
    setRefreshing(true)
    setRefreshError(null)

    let failure: string | null | undefined
    try {
      failure =
        startedTab === "files"
          ? filesRefreshRef.current
            ? await filesRefreshRef.current.refresh()
            : "Files are not ready to refresh yet."
          : changesRefreshRef.current
            ? await changesRefreshRef.current.refresh()
            : "Working tree is not ready to refresh yet."
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }

    if (
      run !== refreshRun.current ||
      tabRef.current !== startedTab ||
      sessionRef.current !== startedSession
    ) {
      return
    }
    setRefreshing(false)
    if (failure === undefined) {
      setLastUpdated(null)
      return
    }
    if (failure) {
      setRefreshError(failure)
      setLastUpdated(null)
    } else {
      setLastUpdated(new Date())
    }
  }

  function handleCollapse() {
    nav.closeInspector()
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-inspector-rail-trigger]")?.focus()
    })
  }

  const refreshButton = (
    <Button
      type="button"
      variant="outline"
      aria-label={
        refreshing
          ? "Refreshing session inspector"
          : "Refresh session inspector"
      }
      aria-busy={refreshing}
      disabled={refreshing}
      className="h-11 w-11 rounded-full p-0"
      onClick={() => void handleRefresh()}
    >
      {refreshing ? (
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-4 animate-spin"
        />
      ) : (
        <RefreshCwIcon aria-hidden="true" className="size-4" />
      )}
    </Button>
  )

  const refreshStatus = refreshing ? (
    <span role="status" className="text-[11px] text-muted-foreground">
      Refreshing…
    </span>
  ) : lastUpdated ? (
    <span role="status" className="text-[11px] text-muted-foreground">
      {tab === "files" ? "Files" : "Working tree"} refreshed ·{" "}
      {lastUpdated.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  ) : null

  return (
    <>
      {mode === "sheet" ? (
        <div className="flex shrink-0 flex-row items-start justify-between px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle
              id={`${INSPECTOR_ID}-title`}
              className="text-[17px] font-semibold tracking-tight"
            >
              Session inspector
            </SheetTitle>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <SheetDescription
                id={`${INSPECTOR_ID}-description`}
                className="min-w-0 max-w-full truncate text-[12px]"
                dir="auto"
                title={sessionTitle}
              >
                {sessionTitle}
              </SheetDescription>
              {refreshStatus}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {refreshButton}
            <SheetClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Close session inspector"
                  className="h-11 w-11 rounded-full p-0"
                />
              }
              onClick={focusInspectorTrigger}
            >
              <XIcon aria-hidden="true" className="size-5" />
            </SheetClose>
          </div>
        </div>
      ) : (
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1 space-y-1">
              <h2
                id={`${INSPECTOR_ID}-title`}
                className="text-[17px] font-semibold tracking-tight"
              >
                Session inspector
              </h2>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <p
                  id={`${INSPECTOR_ID}-description`}
                  className="min-w-0 max-w-full truncate text-[12px] text-muted-foreground"
                  dir="auto"
                  title={sessionTitle}
                >
                  {sessionTitle}
                </p>
                {refreshStatus}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {refreshButton}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Collapse session inspector"
                      className="h-11 w-11 rounded-full p-0"
                      onClick={handleCollapse}
                    />
                  }
                >
                  <PanelRightCloseIcon aria-hidden="true" className="size-5" />
                </TooltipTrigger>
                <TooltipContent side="left">
                  Collapse session inspector
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="mt-3 flex min-w-0">
            <WorkingTreeShortcut
              sessionID={nav.activeSession.id}
              directory={nav.activeSession.location?.directory ?? null}
              onOpen={() => nav.openInspector("changes")}
            />
          </div>
        </div>
      )}

      {refreshError ? (
        <div
          role="alert"
          className="mx-4 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive"
        >
          <span className="min-w-0 break-words">
            Refresh failed: {refreshError}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 px-3 text-xs"
            onClick={() => void handleRefresh()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "files" || value === "changes") {
            nav.setInspectorTab(value)
          }
        }}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <TabsList className={mode === "sidebar" ? "mx-3 mb-1 w-[calc(100%-1.5rem)] shrink-0" : "mx-4 mb-1 w-[calc(100%-2rem)] shrink-0"}>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="changes">Working tree</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea viewportClassName="h-full" className={mode === "sidebar" ? "h-full px-3 pb-4" : "h-full px-4 pb-4"}>
            <FilesPanel
              key={`${nav.activeSession.id}:${nav.activeSession.location?.directory ?? ""}:${preview?.context === previewContext ? preview.sequence : 0}`}
              nav={nav}
              session={nav.activeSession}
              refreshRef={filesRefreshRef}
              initialPath={preview?.context === previewContext ? preview.path : undefined}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="changes" className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea viewportClassName="h-full" className={mode === "sidebar" ? "h-full px-3 pb-4" : "h-full px-4 pb-4"}>
            <ChangesPanel
              key={`${nav.activeSession.id}:${nav.activeSession.location?.directory ?? ""}`}
              session={nav.activeSession}
              refreshRef={changesRefreshRef}
              onOpenFile={(path) => {
                setPreview((previous) => ({ context: previewContext, path, sequence: (previous?.sequence ?? 0) + 1 }))
                nav.setInspectorTab("files")
              }}
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </>
  )
}

/** Mobile trigger + bottom sheet. Desktop uses the persistent right sidebar. */
export function SessionInspector({ nav }: { nav: OpenCodeController }) {
  const isDesktop = useIsDesktop()
  const open = nav.inspectorOpen

  if (!nav.activeSession) {
    return null
  }

  if (isDesktop) {
    return null
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      nav.closeInspector()
      return
    }
    if (!nav.inspectorOpen) {
      nav.openInspector(nav.inspectorTab)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <InspectorTrigger nav={nav} sheet />
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-fixed-drawer="inspector"
        className="gap-0 overflow-hidden rounded-t-xl bg-card p-0"
        style={fixedMobileDrawerStyle()}
      >
        <InspectorBody nav={nav} mode="sheet" />
      </SheetContent>
    </Sheet>
  )
}

function InspectorRail({ nav }: { nav: OpenCodeController }) {
  const expand = () => nav.openInspector(nav.inspectorTab)

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
                onClick={expand}
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Show inspector files"
                onClick={() => nav.openInspector("files")}
                className="size-11 rounded-lg text-muted-foreground"
              />
            }
          >
            <FileTextIcon aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="left">Files</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Show working tree"
                onClick={() => nav.openInspector("changes")}
                className="size-11 rounded-lg text-muted-foreground"
              />
            }
          >
            <GitCompareArrowsIcon aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="left">Working tree</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}

/**
 * Persistent, non-modal desktop inspector. It pushes the conversation instead
 * of overlaying it and stays open until collapsed; clicking outside never
 * dismisses it. The collapsed rail mirrors the session navigation rail.
 */
export function SessionInspectorPanel({ nav }: { nav: OpenCodeController }) {
  const isDesktop = useIsDesktop()

  if (!isDesktop || !nav.activeSession) {
    return null
  }

  if (!nav.inspectorOpen) {
    return <InspectorRail nav={nav} />
  }

  return (
    <aside
      id={INSPECTOR_ID}
      data-desktop-sidebar="inspector"
      data-inspector-mode="full"
      data-side="right"
      aria-labelledby={`${INSPECTOR_ID}-title`}
      aria-describedby={`${INSPECTOR_ID}-description`}
      style={{ backgroundColor: "var(--sidebar)" }}
      className={cn(
        "flex h-svh shrink-0 flex-col overflow-hidden border-s border-sidebar-border bg-sidebar",
        DESKTOP_SIDEBAR_WIDTH
      )}
    >
      <InspectorBody nav={nav} mode="sidebar" />
    </aside>
  )
}
