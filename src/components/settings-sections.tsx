import type { ComponentType } from "react"
import {
  BellIcon,
  BotIcon,
  PaletteIcon,
  PlugIcon,
  ServerIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"

import { AgentConfigSettings } from "@/components/agent-config-settings"
import { NotificationsSettings } from "@/components/notifications-settings"
import { AppearancePanel } from "@/components/theme-select"
import { SettingsAccessSection } from "@/components/settings-access-section"
import { SettingsConnectionSection } from "@/components/settings-connection-section"
import { SettingsPluginsSection } from "@/components/settings-plugins-section"
import {
  useSettingsWorkspace,
  type SettingsSectionID,
} from "@/components/settings-context"
import type { OpenCodeController } from "@/lib/use-opencode"

export type SettingsSectionProps = { nav: OpenCodeController }

export type SettingsSectionDefinition = {
  id: SettingsSectionID
  /** Label for the section list and the detail heading. */
  label: string
  description?: string
  Icon: LucideIcon
  Component: ComponentType<SettingsSectionProps>
}

function AppearanceSection() {
  return <AppearancePanel />
}

function AgentsSection({ nav }: SettingsSectionProps) {
  const { setAgentDirty } = useSettingsWorkspace()
  return (
    <AgentConfigSettings
      nav={nav}
      active
      onDirtyChange={setAgentDirty}
    />
  )
}

/**
 * Settings sections in display order. Each `Component` receives `{ nav }` and
 * renders only its content; the workspace owns the heading, scrolling and the
 * mobile section/detail switch. New sections: add an entry here plus the file.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "appearance",
    label: "Appearance",
    Icon: PaletteIcon,
    Component: AppearanceSection,
  },
  {
    id: "agents",
    label: "Agents",
    description: "Changes save automatically.",
    Icon: BotIcon,
    Component: AgentsSection,
  },
  {
    id: "alerts",
    label: "Alerts",
    Icon: BellIcon,
    Component: NotificationsSettings,
  },
  {
    id: "plugins",
    label: "Plugins",
    Icon: PlugIcon,
    Component: SettingsPluginsSection,
  },
  {
    id: "connection",
    label: "Connections",
    Icon: ServerIcon,
    Component: SettingsConnectionSection,
  },
  {
    id: "access",
    label: "Access",
    Icon: ShieldCheckIcon,
    Component: SettingsAccessSection,
  },
]

export function settingsSection(
  id: SettingsSectionID
): SettingsSectionDefinition {
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0]
}
