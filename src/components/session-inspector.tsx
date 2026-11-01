import { useEffect, useRef, useState } from "react"
import {
  ListTreeIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"

import {
  ChangesPanel,
  FilesPanel,
  type InspectorPanelHandle,
} from "@/components/files-panel"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
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
import { cn } from "@/lib/utils"
import { recordPerfRender } from "@/lib/perf-probe"

export function SessionInspector({ nav }: { nav: OpenCodeController }) {
  recordPerfRender("SessionInspector")
  const isDesktop = useIsDesktop()
  const open = nav.inspectorOpen
  const tab = nav.inspectorTab
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const refreshRun = useRef(0)
  const tabRef = useRef(tab)
  const sessionRef = useRef(nav.activeSessionID)
  const filesRefreshRef = useRef<InspectorPanelHandle | null>(null)
  const changesRefreshRef = useRef<InspectorPanelHandle | null>(null)

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

  function handleOpenChange(next: boolean) {
    if (!next) {
      nav.closeInspector()
      return
    }
    if (!nav.inspectorOpen) {
      nav.openInspector(tab)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Session inspector: files and working tree"
                  className="size-11 rounded-full text-foreground"
                />
              }
            />
          }
        >
          <ListTreeIcon aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Session inspector</TooltipContent>
      </Tooltip>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        showCloseButton={false}
        data-fixed-drawer="inspector"
        className={cn(
          "gap-0 overflow-hidden bg-card p-0",
          isDesktop ? "w-[min(26rem,92vw)]" : "rounded-t-xl"
        )}
        style={!isDesktop ? fixedMobileDrawerStyle() : undefined}
      >
        <SheetHeader className="flex shrink-0 flex-row items-start justify-between px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="text-[17px] font-semibold tracking-tight">
              Session inspector
            </SheetTitle>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <SheetDescription
                className="min-w-0 max-w-full truncate text-[12px]"
                dir="auto"
                title={sessionTitle}
              >
                {sessionTitle}
              </SheetDescription>
              {refreshing ? (
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
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
            <SheetClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Close session inspector"
                  className="h-11 w-11 rounded-full p-0"
                />
              }
            >
              <XIcon aria-hidden="true" className="size-5" />
            </SheetClose>
          </div>
        </SheetHeader>

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
          <TabsList className="mx-4 mb-1 w-[calc(100%-2rem)] shrink-0">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="changes">Working tree</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea viewportClassName="h-full" className="h-full px-4 pb-4">
              <FilesPanel
                key={`${nav.activeSession.id}:${nav.activeSession.location?.directory ?? ""}`}
                nav={nav}
                session={nav.activeSession}
                refreshRef={filesRefreshRef}
              />
            </ScrollArea>
          </TabsContent>
          <TabsContent value="changes" className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea viewportClassName="h-full" className="h-full px-4 pb-4">
              <ChangesPanel
                key={`${nav.activeSession.id}:${nav.activeSession.location?.directory ?? ""}`}
                session={nav.activeSession}
                refreshRef={changesRefreshRef}
              />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
