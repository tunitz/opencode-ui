import { memo, useCallback, useDeferredValue, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowUpIcon, FolderPlusIcon, GlobeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fsListUrl, type ProjectEntry } from "@/lib/files"
import { projectBasename } from "@/lib/notes-types"

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
/** Rows rendered before the "show more" affordance; the rest stay off the DOM. */
const VISIBLE_ROW_LIMIT = 50

const optionClass =
  "h-auto min-h-11 w-full justify-start gap-2 rounded-none px-3 py-2 text-start font-normal whitespace-normal aria-pressed:bg-muted"

/** Memoized so browsing/filtering does not rebuild every unchanged row. */
const DirectoryRow = memo(function DirectoryRow({
  directory,
  selected,
  disabled,
  onSelect,
}: {
  directory: string
  selected: boolean
  disabled: boolean
  onSelect: (directory: string) => void
}) {
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        className={optionClass}
        disabled={disabled}
        aria-pressed={selected}
        data-directory={directory}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(directory)}
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
  )
})

type ListingState = "idle" | "loading" | "ready" | "error"

export type DirectoryBrowserProps = {
  id: string
  /** Raw input text. */
  value: string
  onChange: (value: string) => void
  /**
   * Level the listing starts at. Defaults to the typed path's parent so an
   * existing selection keeps its siblings visible.
   */
  initialBrowse?: string
  /** Controlled listing level; omit to let the browser navigate internally. */
  browse?: string
  onBrowseChange?: (browse: string) => void
  showGlobalRow?: boolean
  /** Body of the Global option row (icon plus labels). */
  globalRowContent?: ReactNode
  label: ReactNode
  placeholder?: string
  /** Always-visible helper under the browser. */
  hint?: ReactNode
  /** Validation message; hides the option list's hints while present. */
  error?: string | null
  disabled?: boolean
  optionsLabel?: string
}

/**
 * Directory input plus a drill-down browser. The input is both a filter for the
 * current level's subdirectories and an escape hatch for a not-yet-created
 * absolute path; the options stay hidden until the field is used so the host
 * dialog keeps its compact height.
 */
export function DirectoryBrowser({
  id,
  value,
  onChange,
  initialBrowse,
  browse: controlledBrowse,
  onBrowseChange,
  showGlobalRow = false,
  globalRowContent,
  label,
  placeholder,
  hint,
  error = null,
  disabled = false,
  optionsLabel = "Directories",
}: DirectoryBrowserProps) {
  const trimmed = value.trim()
  const query = trimmed.toLocaleLowerCase()
  const deferredQuery = useDeferredValue(query)
  const canonicalValue = canonicalDirectory(trimmed)
  const errorID = `${id}-error`
  const hintID = `${id}-hint`
  const fieldRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [optionsMaxHeight, setOptionsMaxHeight] = useState<number | null>(null)

  // Keep the options list between the input and an on-screen keyboard: cap its
  // height to the visible viewport below the input and keep the input in view.
  useEffect(() => {
    if (!open) return
    if (typeof window === "undefined") return
    const update = () => {
      const input = inputRef.current
      if (!input || typeof input.getBoundingClientRect !== "function") return
      const viewport = window.visualViewport
      const visibleBottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight
      const available = visibleBottom - input.getBoundingClientRect().bottom - 12
      setOptionsMaxHeight(Math.max(96, Math.min(208, Math.floor(available))))
      if (typeof input.scrollIntoView === "function") input.scrollIntoView({ block: "nearest" })
    }
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(update) : 0
    const viewport = window.visualViewport
    const canListen = typeof window.addEventListener === "function"
    if (canListen) {
      viewport?.addEventListener("resize", update)
      viewport?.addEventListener("scroll", update)
      window.addEventListener("resize", update)
    }
    return () => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame)
      if (!canListen) return
      viewport?.removeEventListener("resize", update)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [open])
  const [internalBrowse, setInternalBrowse] = useState(() =>
    canonicalDirectory(initialBrowse ?? browseDirectory(value)) || "/"
  )
  const browse =
    canonicalDirectory(controlledBrowse ?? internalBrowse) || "/"
  const [listing, setListing] = useState<ListingState>("idle")
  const [subdirectories, setSubdirectories] = useState<string[]>([])
  // "Show more" is tied to the current level/query, so it auto-collapses when
  // either changes without a setState-in-effect cascade.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  function changeBrowse(next: string) {
    const normalized = canonicalDirectory(next) || "/"
    if (onBrowseChange) onBrowseChange(normalized)
    else setInternalBrowse(normalized)
  }

  // Stable row callback keeps the memoized rows from re-rendering on filter.
  const handleSelectDirectory = useCallback(
    (next: string) => {
      onChange(next)
      const normalized = canonicalDirectory(next) || "/"
      if (onBrowseChange) onBrowseChange(normalized)
      else setInternalBrowse(normalized)
    },
    [onChange, onBrowseChange]
  )

  // One level at a time, so typing never fans out into more requests. Stale
  // entries stay visible while a new level is fetched instead of flashing an
  // empty list.
  useEffect(() => {
    if (!open) return
    let active = true
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!active) return
      setListing("loading")
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
  // An exact selection (the browsed level itself, a listed child, or the
  // parent) keeps every sibling visible; anything else filters the level.
  const exact =
    (trimmed !== "" && canonicalValue === browse) ||
    subdirectories.includes(trimmed) ||
    (parent !== null && parent === trimmed)
  const siblings =
    deferredQuery && !exact
      ? subdirectories.filter(
          (directory) =>
            directory.toLocaleLowerCase().includes(deferredQuery) ||
            projectBasename(directory).toLocaleLowerCase().includes(deferredQuery)
        )
      : subdirectories
  const resetKey = `${browse}\u0000${deferredQuery}`
  const showAll = expandedKey === resetKey
  const visibleSiblings = showAll
    ? siblings
    : siblings.slice(0, VISIBLE_ROW_LIMIT)
  const hiddenCount = siblings.length - visibleSiblings.length
  const custom = trimmed !== "" && !exact
  const optionsID = `${id}-options`
  const describedBy =
    [error ? errorID : null, hint ? hintID : null].filter(Boolean).join(" ") ||
    undefined

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
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          className="h-11"
          dir="ltr"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-controls={open ? optionsID : undefined}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }
          }}
        />
        {open && (
          <div
            id={optionsID}
            data-directory-options
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-52 min-w-0 overflow-y-auto overscroll-contain rounded-lg border bg-popover text-popover-foreground shadow-lg"
            style={optionsMaxHeight ? { maxHeight: optionsMaxHeight } : undefined}
          >
            <ul aria-label={optionsLabel} className="min-w-0 divide-y divide-border">
              {showGlobalRow && (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    className={optionClass}
                    disabled={disabled}
                    aria-pressed={trimmed === ""}
                    data-directory=""
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange("")
                      changeBrowse("/")
                    }}
                  >
                    {globalRowContent ?? (
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
                    )}
                  </Button>
                </li>
              )}
              {parent !== null && (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    className={optionClass}
                    disabled={disabled}
                    aria-pressed={trimmed === parent}
                    data-directory-parent={parent}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange(parent)
                      changeBrowse(parent)
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
                  data-directory-loading
                  className="px-3 py-2 text-sm text-muted-foreground"
                >
                  Loading directories…
                </li>
              )}
              {listing === "error" && (
                <li
                  data-directory-error
                  className="px-3 py-2 text-sm text-muted-foreground"
                >
                  Could not list this directory.
                </li>
              )}
              {visibleSiblings.map((directory) => (
                <DirectoryRow
                  key={directory}
                  directory={directory}
                  selected={trimmed === directory}
                  disabled={disabled}
                  onSelect={handleSelectDirectory}
                />
              ))}
              {hiddenCount > 0 ? (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    className={optionClass}
                    disabled={disabled}
                    data-directory-show-more
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setExpandedKey(resetKey)}
                  >
                    Show {hiddenCount} more
                  </Button>
                </li>
              ) : null}
              {custom && (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    className={optionClass}
                    disabled={disabled}
                    data-directory-custom={trimmed}
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
      </div>
      {error && (
        <p id={errorID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint ? (
        <p id={hintID} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
