import { FolderIcon, LayersIcon, LoaderCircleIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  const selected = projects.find((project) => project.id === value)
  const showAllProjects = includeAllProjects && value === ALL_PROJECTS
  const name = showAllProjects
    ? "All projects"
    : selected
      ? projectName(selected)
      : fallbackLabel

  return (
    <Select
      value={value}
      onValueChange={(projectID) => {
        if (projectID) {
          onValueChange(projectID)
        }
      }}
      disabled={disabled}
      modal={false}
    >
      <SelectTrigger
        aria-label={
          showAllProjects
            ? "Project scope: All projects"
            : name
              ? `Project: ${name}`
              : "Project"
        }
        className="h-11! w-full min-w-0 justify-between rounded-lg px-2.5 text-[13px] font-medium"
      >
        <SelectValue className="min-w-0">
          {(selectedID: string | null) => {
            if (selectedID === ALL_PROJECTS && includeAllProjects) {
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <LayersIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 truncate">All projects</span>
                </span>
              )
            }

            const current = projects.find(
              (project) => project.id === selectedID
            )
            const label = current
              ? projectName(current)
              : selectedID === value
                ? fallbackLabel
                : null

            return (
              <span className="flex min-w-0 items-center gap-2">
                {busy ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                  />
                ) : (
                  <FolderIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <span dir="auto" className="min-w-0 truncate">{label ?? "No project"}</span>
              </span>
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="start"
        alignItemWithTrigger={false}
        sideOffset={8}
        className="p-1"
        style={{ width: "min(20rem, calc(100vw - 2rem))" }}
      >
        {includeAllProjects ? (
          <SelectItem
            value={ALL_PROJECTS}
            className="min-h-11 py-2 ps-2"
          >
            <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
              <LayersIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              All projects
            </span>
          </SelectItem>
        ) : null}
        {projects.map((project) => (
          <SelectItem
            key={project.id}
            value={project.id}
            className="min-h-11 py-2 ps-2 [&>span]:items-start [&>span]:whitespace-normal"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-medium">
                {projectName(project)}
              </span>
              <span dir="ltr" className="font-mono text-[11px] break-all text-muted-foreground">
                {project.canonical}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
