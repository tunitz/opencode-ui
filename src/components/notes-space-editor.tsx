import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, FolderPlusIcon, GlobeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fsListUrl, type ProjectEntry } from "@/lib/files"
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

/** One canonical form per directory so paths never repeat or trail a slash. */
export function canonicalDirectory(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/")
  if (normalized.length <= 1) return normalized
  return normalized.replace(/\/+$/, "")
}

/** Parent of a canonical absolute directory; null at the filesystem root. */
export function parentDirectory(path: string): string | null {
  const normalized = canonicalDirectory(path)
  if (!normalized || normalized === "/" || !normalized.startsWith("/")) return null
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}

/**
 * Directory whose subdirectories the browser lists for an input value: the
 * typed path's parent, or the filesystem root for an empty (Global) value.
 */
export function browseDirectory(value: string): string {
  const trimmed = canonicalDirectory(value)
  if (!trimmed.startsWith("/")) return "/"
  return parentDirectory(trimmed) ?? "/"
}

/** Absolute child path for a path returned relative to `parent`. */
export function joinDirectory(parent: string, child: string): string {
  if (child.startsWith("/")) return canonicalDirectory(child)
  const relative = child.replace(/^\/+/, "")
  if (!relative) return canonicalDirectory(parent)
  const base = canonicalDirectory(parent)
  return canonicalDirectory(base === "/" ? `/${relative}` : `${base}/${relative}`)
}

/**
 * Child directories from a `GET /api/fs/list` payload. Returned paths stay
 * relative to the requested location, so they are resolved against `browse`;
 * files and hidden dot-directories are dropped.
 */
export function subdirectoryPaths(browse: string, payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null | undefined)?.data
  if (!Array.isArray(data)) return []
  const seen = new Set<string>()
  const paths: string[] = []
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue
    const { path, type } = entry as Partial<ProjectEntry>
    if (type !== "directory" || typeof path !== "string" || !path.trim()) continue
    if (projectBasename(path).startsWith(".")) continue
    const absolute = joinDirectory(browse, path.trim())
    if (seen.has(absolute)) continue
    seen.add(absolute)
    paths.push(absolute)
  }
  return paths
}

const LIST_DEBOUNCE_MS = 120

type ListingState = "idle" | "loading" | "ready" | "error"

export type SpaceDirectoryFieldProps = {
  id: string
  /** Raw input text; an empty value is a Global space. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Directory input plus a drill-down browser. The input is both a filter for the
 * current level's subdirectories and an escape hatch for a not-yet-created
 * absolute path; the options stay hidden until the field is used so the dialog
 * keeps its compact height.
 */
export function SpaceDirectoryField({
  id,
  value,
  onChange,
  disabled = false,
}: SpaceDirectoryFieldProps) {
  const trimmed = value.trim()
  const query = trimmed.toLocaleLowerCase()
  const error = spaceDirectoryError(value)
  const errorID = `${id}-error`
  const fieldRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [browse, setBrowse] = useState(() => browseDirectory(value))
  const [listing, setListing] = useState<ListingState>("idle")
  const [subdirectories, setSubdirectories] = useState<string[]>([])

  // One level at a time, so typing never fans out into more requests.
  useEffect(() => {
    if (!open) return
    let active = true
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!active) return
      setListing("loading")
      setSubdirectories([])
    })
    const timer = setTimeout(() => {
      fetch(fsListUrl(browse), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Directory list failed.")
          return (await response.json()) as { data?: ProjectEntry[] }
        })
        .then((body) => {
          if (!active) return
          setSubdirectories(subdirectoryPaths(browse, body))
          setListing("ready")
        })
        .catch(() => {
          if (!active || controller.signal.aborted) return
          setSubdirectories([])
          setListing("error")
        })
    }, LIST_DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [browse, open])

  const parent = parentDirectory(browse)
  const exact =
    subdirectories.includes(trimmed) || (parent !== null && parent === trimmed)
  const siblings =
    query && !exact
      ? subdirectories.filter(
          (directory) =>
            directory.toLocaleLowerCase().includes(query) ||
            projectBasename(directory).toLocaleLowerCase().includes(query)
        )
      : subdirectories
  const custom = trimmed !== "" && !exact
  const optionsID = `${id}-options`

  const optionClass =
    "h-auto min-h-11 w-full justify-start gap-2 rounded-none px-3 py-2 text-start font-normal whitespace-normal aria-pressed:bg-muted"

  return (
    <div
      ref={fieldRef}
      className="grid min-w-0 gap-1.5"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next && fieldRef.current?.contains(next)) return
        setOpen(false)
      }}
    >
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
        aria-controls={open ? optionsID : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
      />
      {error && (
        <p id={errorID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {open && (
        <div
          id={optionsID}
          data-space-directory-options
          className="max-h-52 min-w-0 overflow-y-auto overscroll-contain rounded-lg border"
        >
          <ul aria-label="Project directories" className="min-w-0 divide-y divide-border">
            <li>
              <Button
                type="button"
                variant="ghost"
                className={optionClass}
                disabled={disabled}
                aria-pressed={trimmed === ""}
                data-space-directory=""
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange("")
                  setBrowse("/")
                }}
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
            {parent !== null && (
              <li>
                <Button
                  type="button"
                  variant="ghost"
                  className={optionClass}
                  disabled={disabled}
                  aria-pressed={trimmed === parent}
                  data-space-directory-parent={parent}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(parent)
                    setBrowse(parent)
                  }}
                >
                  <ArrowUpIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium" dir="auto">
                      {projectBasename(parent) || "Up one level"}
                    </span>
                    <span
                      className="truncate text-xs text-muted-foreground"
                      dir="auto"
                      title={parent}
                    >
                      {parent}
                    </span>
                  </span>
                </Button>
              </li>
            )}
            {listing === "loading" && (
              <li
                aria-busy="true"
                data-space-directory-loading
                className="px-3 py-2 text-sm text-muted-foreground"
              >
                Loading directories…
              </li>
            )}
            {listing === "error" && (
              <li
                data-space-directory-error
                className="px-3 py-2 text-sm text-muted-foreground"
              >
                Could not list this directory.
              </li>
            )}
            {siblings.map((directory) => (
              <li key={directory}>
                <Button
                  type="button"
                  variant="ghost"
                  className={optionClass}
                  disabled={disabled}
                  aria-pressed={trimmed === directory}
                  data-space-directory={directory}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(directory)
                    setBrowse(directory)
                  }}
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
                  className={optionClass}
                  disabled={disabled}
                  data-space-directory-custom={trimmed}
                  onMouseDown={(event) => event.preventDefault()}
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
      )}
      <p className="text-xs text-muted-foreground">
        Any absolute path works, even before the folder exists.
      </p>
    </div>
  )
}
