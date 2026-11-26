import { GlobeIcon } from "lucide-react"

import { DirectoryBrowser } from "@/components/directory-browser"

export {
  browseDirectory,
  canonicalDirectory,
  joinDirectory,
  parentDirectory,
  subdirectoryPaths,
} from "@/components/directory-browser"

/**
 * Space scoping accepts any absolute directory, including one that does not
 * exist yet. There is deliberately no existence check: a space may be prepared
 * before its project folder is created.
 */
export function spaceDirectoryError(value: string | null): string | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return null
  return trimmed.startsWith("/") ? null : "Use an absolute path starting with /"
}

/** Trimmed directory for persistence; empty input is a Global space. */
export function spaceDirectoryValue(value: string | null): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed || null
}

export type SpaceDirectoryFieldProps = {
  id: string
  /** Raw input text; an empty value is a Global space. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Space scope directory input. The shared browser supplies the drill-down; the
 * Global row and absolute-path validation stay specific to space scoping.
 */
export function SpaceDirectoryField({
  id,
  value,
  onChange,
  disabled = false,
}: SpaceDirectoryFieldProps) {
  return (
    <DirectoryBrowser
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      showGlobalRow
      label="Project directory"
      placeholder="Empty = Global (every project)"
      hint="Any absolute path works, even before the folder exists."
      error={spaceDirectoryError(value)}
      optionsLabel="Project directories"
      globalRowContent={
        <>
          <GlobeIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">Global</span>
            <span className="text-xs text-muted-foreground">
              Visible in every project
            </span>
          </span>
        </>
      }
    />
  )
}
