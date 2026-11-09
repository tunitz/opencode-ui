import { useState } from "react"
import { SettingsIcon, XIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { AgentConfigSettings } from "@/components/agent-config-settings"
import { NotificationsSettings } from "@/components/notifications-settings"
import {
  fixedDesktopSettingsStyle,
  fixedMobileDrawerStyle,
} from "@/lib/drawer-layout"
import { recordPerfRender } from "@/lib/perf-probe"
import { useIsDesktop } from "@/lib/use-is-desktop"
import type { OpenCodeController } from "@/lib/use-opencode"

function PreferencesPanel({
  nav,
  close,
  onAgentDirtyChange,
}: {
  nav: OpenCodeController
  close: () => void
  onAgentDirtyChange: (dirty: boolean) => void
}) {
  const [tab, setTab] = useState("agents")

  const isAgentsTab = tab === "agents"
  const isNotificationsTab = tab === "notifications"

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-2">
        <div className="min-w-0 space-y-1">
          <h2
            id="preferences-title"
            className="text-[17px] leading-6 font-semibold tracking-tight"
          >
            {isAgentsTab ? "Agent definitions" : "Preferences"}
          </h2>
          <p className="text-[12px] leading-5 text-muted-foreground">
            {isAgentsTab
              ? "Changes save automatically."
              : isNotificationsTab
                ? "Once enabled, alerts are saved by this backend for this browser's notification device."
                : null}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close settings"
          className="size-11 shrink-0 rounded-full p-0 text-muted-foreground"
          onClick={close}
        >
          <XIcon aria-hidden="true" className="size-5" />
        </Button>
      </div>

      {isNotificationsTab ? (
        <div className="px-4 pb-1">
          <p className="text-xs text-muted-foreground">
            Once enabled, alert preferences, watched sessions, and the push
            subscription are saved by this backend for this browser&apos;s
            notification device. This app keeps only the device ID in this
            browser.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Permission is controlled by your browser and OS. Changes save
            automatically.
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList className="mx-4 mb-1 w-[calc(100%-2rem)]">
          <TabsTrigger
            value="agents"
            aria-label="Engine agent definitions"
            className="px-1 text-[12px]"
          >
            Agents
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            aria-label="Notifications"
            className="px-1 text-[12px]"
          >
            Alerts
          </TabsTrigger>
        </TabsList>
        <ScrollArea
          viewportClassName="h-full"
          className="min-h-0 flex-1 px-4 pb-5"
        >
          <TabsContent value="notifications">
            <NotificationsSettings />
          </TabsContent>
          <TabsContent value="agents" keepMounted>
            <AgentConfigSettings
              nav={nav}
              active={tab === "agents"}
              onDirtyChange={onAgentDirtyChange}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

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

export function SettingsDialog({
  nav,
  open,
  onOpenChange,
}: {
  nav: OpenCodeController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  recordPerfRender("SettingsDialog")
  const isDesktop = useIsDesktop()
  const [agentDirty, setAgentDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const requestOpenChange = (next: boolean) => {
    if (!next && agentDirty) {
      setConfirmClose(true)
      return
    }
    if (!next) setAgentDirty(false)
    onOpenChange(next)
  }

  const panel = (
    <PreferencesPanel
      nav={nav}
      close={() => requestOpenChange(false)}
      onAgentDirtyChange={setAgentDirty}
    />
  )

  const dialog = isDesktop ? (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby="preferences-title"
        data-fixed-drawer="settings"
        className="flex w-[min(32rem,92vw)] flex-col gap-0 overflow-hidden p-0"
        style={fixedDesktopSettingsStyle()}
      >
        {panel}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-labelledby="preferences-title"
        data-fixed-drawer="settings"
        className="gap-0 overflow-hidden rounded-t-xl p-0"
        style={fixedMobileDrawerStyle()}
      >
        {panel}
      </SheetContent>
    </Sheet>
  )

  return (
    <>
      {dialog}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changes are still saving</AlertDialogTitle>
            <AlertDialogDescription>
              Close Settings anyway? The latest edit may not be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmClose(false)
                setAgentDirty(false)
                onOpenChange(false)
              }}
            >
              Close anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function SettingsButton({ nav }: { nav: OpenCodeController }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <SettingsTriggerButton onClick={() => setOpen(true)} />
      <SettingsDialog nav={nav} open={open} onOpenChange={setOpen} />
    </>
  )
}
