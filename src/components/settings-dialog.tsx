import { useEffect, useRef } from "react"

import {
  useOptionalSettingsWorkspace,
} from "@/components/settings-context"
import type { OpenCodeController } from "@/lib/use-opencode"

export {
  SettingsButton,
  SettingsTriggerButton,
} from "@/components/settings-workspace"

/**
 * Compatibility shim for the retired Settings dialog. The Command Center
 * (retained but not mounted) still passes `open`/`onOpenChange`; the app-level
 * Settings workspace owns the UI, so this only mirrors that open state.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  nav: OpenCodeController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useOptionalSettingsWorkspace()
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!settings) return
    if (open === wasOpen.current) return
    wasOpen.current = open
    if (open) settings.openSettings()
    else settings.closeSettings()
  }, [open, settings])

  useEffect(() => {
    if (!settings || settings.open || !wasOpen.current) return
    wasOpen.current = false
    onOpenChange(false)
  }, [settings, onOpenChange])

  return null
}
