import { FolderPlusIcon, GlobeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { projectBasename } from "@/lib/notes-types"

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

/** One canonical form per directory so suggestions never repeat. */
export function canonicalDirectory(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/")
  if (normalized.length <= 1) return normalized
  return normalized.replace(/\/+$/, "")
}

/** Unique absolute directories, preserving order and dropping empty values. */
export function uniqueDirectories(
  ...values: readonly (string | null | undefined)[]
): string[] {
  const seen = new Set<string>()
  const directories: string[] = []
  for (const value of values) {
    if (!value) continue
    const directory = canonicalDirectory(value)
    if (!directory || seen.has(directory)) continue
    seen.add(directory)
    directories.push(directory)
  }
  return directories
}

/**
 * Engine project rows (`GET /api/project`) reduced to their canonical
 * directories. Unknown shapes are ignored so a changed payload cannot break
 * the editor.
 */
export function projectDirectoriesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const directories: (string | undefined)[] = value.map((entry) => {
    if (typeof entry !== "object" || entry === null) return undefined
    const canonical = (entry as { canonical?: unknown }).canonical
    return typeof canonical === "string" ? canonical : undefined
  })
  return uniqueDirectories(...directories)
}

export type SpaceDirectoryFieldProps = {
  id: string
  /** Raw input text; an empty value is a Global space. */
  value: string
  directories: readonly string[]
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Directory input plus a filterable option list. Typing is both a search over
 * the known directories and an escape hatch for a not-yet-created path.
 */
export function SpaceDirectoryField({
  id,
  value,
  directories,
  onChange,
  disabled = false,
}: SpaceDirectoryFieldProps) {
  const trimmed = value.trim()
  const query = trimmed.toLocaleLowerCase()
  const error = spaceDirectoryError(value)
  const selected = directories.includes(trimmed)
  // An exact match is the current selection, so every alternative stays in
  // reach; any other text is a search over the known directories.
  const options =
    query && !selected
      ? directories.filter(
          (directory) =>
            directory.toLocaleLowerCase().includes(query) ||
            projectBasename(directory).toLocaleLowerCase().includes(query)
        )
      : directories
  const custom = trimmed !== "" && !selected
  const errorID = `${id}-error`

  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Project directory
      </label>
      <Input
        id={id}
        className="h-11"
        dir="ltr"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="Empty = Global (every project)"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorID : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id={errorID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="max-h-52 min-w-0 overflow-y-auto overscroll-contain rounded-lg border">
        <ul aria-label="Project directories" className="min-w-0 divide-y divide-border">
          <li>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full justify-start gap-2 rounded-none px-3 py-2 text-start font-normal whitespace-normal aria-pressed:bg-muted"
              disabled={disabled}
              aria-pressed={trimmed === ""}
              data-space-directory=""
              onClick={() => onChange("")}
            >
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
            </Button>
          </li>
          {options.map((directory) => (
            <li key={directory}>
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-start font-normal whitespace-normal aria-pressed:bg-muted"
                disabled={disabled}
                aria-pressed={trimmed === directory}
                data-space-directory={directory}
                onClick={() => onChange(directory)}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium" dir="auto">
                    {projectBasename(directory)}
                  </span>
                  <span
                    className="truncate text-xs text-muted-foreground"
                    dir="auto"
                    title={directory}
                  >
                    {directory}
                  </span>
                </span>
              </Button>
            </li>
          ))}
          {custom && (
            <li>
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-11 w-full justify-start gap-2 rounded-none px-3 py-2 text-start font-normal whitespace-normal"
                disabled={disabled}
                data-space-directory-custom={trimmed}
                onClick={() => onChange(trimmed)}
              >
                <FolderPlusIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 truncate" dir="auto">
                  Use custom path: {trimmed}
                </span>
              </Button>
            </li>
          )}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        Any absolute path works, even before the folder exists.
      </p>
    </div>
  )
}
