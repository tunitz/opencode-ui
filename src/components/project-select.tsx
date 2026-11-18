import { useMemo } from "react"
import { FolderIcon, LayersIcon } from "lucide-react"

import { PickerSelect, type PickerOption } from "@/components/ui/picker-select"
import type { Project } from "@/lib/opencode"

// Stable element instances: recreating them per render gave every row new
// option objects and defeated the picker's memoized rows.
const ALL_PROJECTS_ICON = <LayersIcon aria-hidden="true" />
const PROJECT_ICON = <FolderIcon aria-hidden="true" />

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
  const options = useMemo<PickerOption[]>(
    () => [
      ...(includeAllProjects
        ? [
            {
              value: ALL_PROJECTS,
              label: "All projects",
              icon: ALL_PROJECTS_ICON,
            },
          ]
        : []),
      ...projects.map((project) => ({
        value: project.id,
        label: projectName(project),
        detail: project.canonical,
        icon: PROJECT_ICON,
      })),
    ],
    [projects, includeAllProjects]
  )

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
