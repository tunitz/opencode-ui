import { SettingsIcon } from "lucide-react"

import { useOptionalSettingsWorkspace } from "@/components/settings-context"
import { Button } from "@/components/ui/button"

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
