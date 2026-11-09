import { FolderIcon, LayersIcon } from "lucide-react"

import { PickerSelect, type PickerOption } from "@/components/ui/picker-select"
import type { Project } from "@/lib/opencode"

function directoryName(directory: string | undefined): string | null {
  const segment = directory?.split("/").filter(Boolean).at(-1)
  return segment ?? null
}

export function projectName(
  project: Pick<Project, "canonical" | "id" | "name">
): string {
  const named = project.name?.trim()
  return named || directoryName(project.canonical) || project.id
}

// Sentinel value for the cross-project scope; never a real project id.
export const ALL_PROJECTS = "all-projects"

export type ProjectSelectProps = {
  projects: Project[]
  value: string | null
  onValueChange: (projectID: string) => void
  disabled?: boolean
  busy?: boolean
  fallbackLabel?: string | null
  includeAllProjects?: boolean
}

export function ProjectSelect({
  projects,
  value,
  onValueChange,
  disabled = false,
  busy = false,
  fallbackLabel = null,
  includeAllProjects = false,
}: ProjectSelectProps) {
  const showAllProjects = includeAllProjects && value === ALL_PROJECTS
  const selected = projects.find((project) => project.id === value)
  const name = showAllProjects
    ? "All projects"
    : selected
      ? projectName(selected)
      : fallbackLabel
  const options: PickerOption[] = [
    ...(includeAllProjects
      ? [
          {
            value: ALL_PROJECTS,
            label: "All projects",
            icon: <LayersIcon aria-hidden="true" />,
          },
        ]
      : []),
    ...projects.map((project) => ({
      value: project.id,
      label: projectName(project),
      detail: project.canonical,
      icon: <FolderIcon aria-hidden="true" />,
    })),
  ]

  return (
    <PickerSelect
      label="Project"
      ariaLabel={
        showAllProjects
          ? "Project scope: All projects"
          : name
            ? `Project: ${name}`
            : "Project"
      }
      value={value}
      options={options}
      onValueChange={onValueChange}
      disabled={disabled}
      busy={busy}
      placeholder={fallbackLabel ?? "No project"}
      triggerClassName="justify-between rounded-lg px-2.5 text-[13px] font-medium"
    />
  )
}
