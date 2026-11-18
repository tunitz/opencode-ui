"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, SearchIcon, StarIcon } from "lucide-react"
import {
  forwardRef,
  memo,
  useCallback,
  useDeferredValue,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"

export type PickerOption = {
  value: string
  label: string
  detail?: string
  icon?: ReactNode
  disabled?: boolean
}

type TriggerProps = Omit<
  ComponentProps<typeof ComboboxPrimitive.Trigger>,
  "children" | "className"
>

/**
 * Above this many options the popup switches to a windowed list so opening a
 * large catalog mounts a bounded number of rows. Small pickers (projects,
 * variants, short agent lists) keep the simpler keyed list below.
 */
const VIRTUALIZE_THRESHOLD = 120
/** Row estimate in px; `measureElement` corrects it from the real DOM height. */
const ROW_ESTIMATE_PX = 56

/** One lowercase haystack per option, built once per `options` change. */
export function pickerOptionSearchKey(
  option: Pick<PickerOption, "label" | "detail" | "value">
): string {
  return [option.label, option.detail, option.value]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
}

/** `query` is tokenized once by the caller; the key is already lowercase. */
export function matchesPickerSearchKey(key: string, query: string): boolean {
  const words = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return true
  return words.every((word) => key.includes(word))
}

/** Kept for callers that have not precomputed a search key. */
export function matchesPickerOption(
  option: Pick<PickerOption, "label" | "detail" | "value">,
  query: string
): boolean {
  return matchesPickerSearchKey(pickerOptionSearchKey(option), query)
}

type PickerOptionRowProps = {
  option: PickerOption
  favorite: boolean
  showFavorite: boolean
  onToggleFavorite?: (value: string) => void
  /** Supplied only by the virtualized list; keeps index/ARIA contracts exact. */
  index?: number
  setSize?: number
  start?: number
  size?: number
}

/** Memoized so highlight/search/favorite re-renders do not rebuild every row. */
const PickerOptionRow = memo(
  forwardRef<HTMLDivElement, PickerOptionRowProps>(function PickerOptionRow(
    { option, favorite, showFavorite, onToggleFavorite, index, setSize, start, size },
    ref
  ) {
    const virtualized = index !== undefined
    // Built from primitives so the memoized row keeps referential props stable
    // across a favorite toggle (only the toggled row's `favorite` changes).
    const style: CSSProperties | undefined = virtualized
      ? {
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: size ?? ROW_ESTIMATE_PX,
          transform: `translateY(${start ?? 0}px)`,
        }
      : undefined
    return (
      <ComboboxPrimitive.Item
        ref={ref}
        value={option}
        index={index}
        data-index={virtualized ? index : undefined}
        aria-setsize={virtualized ? setSize : undefined}
        aria-posinset={virtualized ? (index ?? 0) + 1 : undefined}
        style={style}
        disabled={option.disabled}
        className={cn(
          "relative flex min-h-11 w-full cursor-default items-start gap-2 rounded-md py-2 ps-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
          showFavorite ? "pe-14" : "pe-8"
        )}
      >
        {option.icon ? (
          <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
            {option.icon}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14px] leading-5 break-words">
            {option.label}
          </span>
          {option.detail ? (
            <span
              dir="ltr"
              className="font-mono text-[11px] break-all text-muted-foreground"
            >
              {option.detail}
            </span>
          ) : null}
        </span>
        {showFavorite ? (
          <button
            type="button"
            aria-label={
              favorite ? `Unfavorite ${option.label}` : `Favorite ${option.label}`
            }
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleFavorite?.(option.value)
            }}
            className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <StarIcon
              aria-hidden="true"
              className={cn(
                "size-4",
                favorite && "fill-amber-400 text-amber-400"
              )}
            />
          </button>
        ) : null}
        <ComboboxPrimitive.ItemIndicator
          render={
            <span
              className={cn(
                "pointer-events-none absolute top-1/2 flex size-4 -translate-y-1/2 items-center justify-center",
                showFavorite ? "end-10" : "end-2"
              )}
            />
          }
        >
          <CheckIcon className="size-4" />
        </ComboboxPrimitive.ItemIndicator>
      </ComboboxPrimitive.Item>
    )
  })
)

type Virtualizer = ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>

/** Official Base UI windowed-list recipe, wired to the filtered item set. */
function VirtualizedPickerList({
  open,
  virtualizerRef,
  favorites,
  showFavorite,
  onToggleFavorite,
}: {
  open: boolean
  virtualizerRef: React.RefObject<Virtualizer | null>
  favorites?: ReadonlySet<string>
  showFavorite: boolean
  onToggleFavorite?: (value: string) => void
}) {
  const filteredItems = ComboboxPrimitive.useFilteredItems<PickerOption>()
  const scrollElementRef = useRef<HTMLDivElement | null>(null)

  // The official Base UI windowed-list recipe requires TanStack Virtual. Its
  // instance is intentionally recreated on filter/scroll changes; this leaf
  // is never passed to a memoized parent, so React Compiler skipping it is safe.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    enabled: open,
    count: filteredItems.length,
    getScrollElement: () => scrollElementRef.current,
    // Stable DOM identity by option value so filtering reuses surviving rows.
    getItemKey: (index) => filteredItems[index]?.value ?? index,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 12,
    paddingStart: 4,
    paddingEnd: 4,
    scrollPaddingStart: 4,
    scrollPaddingEnd: 4,
  })

  useImperativeHandle(virtualizerRef, () => virtualizer)

  const handleScrollElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollElementRef.current = element
      if (element) virtualizer.measure()
    },
    [virtualizer]
  )

  const totalSize = virtualizer.getTotalSize()

  if (!filteredItems.length) return null

  return (
    <div
      role="presentation"
      ref={handleScrollElementRef}
      className="h-[min(20rem,var(--total-size))] max-h-[var(--available-height)] overflow-y-auto overscroll-contain px-1 scroll-py-1"
      style={{ "--total-size": `${totalSize}px` } as CSSProperties}
    >
      <div
        role="presentation"
        className="relative w-full"
        style={{ height: totalSize }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const option = filteredItems[virtualRow.index]
          if (!option) return null
          return (
            <PickerOptionRow
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              index={virtualRow.index}
              setSize={filteredItems.length}
              start={virtualRow.start}
              size={virtualRow.size}
              option={option}
              favorite={favorites?.has(option.value) ?? false}
              showFavorite={showFavorite}
              onToggleFavorite={onToggleFavorite}
            />
          )
        })}
      </div>
    </div>
  )
}

export function PickerSelect({
  value,
  options,
  onValueChange,
  label,
  ariaLabel,
  id,
  placeholder = "Select…",
  disabled = false,
  busy = false,
  showDetail = false,
  modal = false,
  side = "bottom",
  align = "start",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  triggerClassName,
  popupClassName,
  triggerProps,
  renderValue,
  iconClassName = "size-4",
  favorites,
  onToggleFavorite,
}: {
  value: string | null
  options: readonly PickerOption[]
  onValueChange: (value: string) => void
  label: string
  ariaLabel?: string
  id?: string
  placeholder?: string
  disabled?: boolean
  busy?: boolean
  showDetail?: boolean
  modal?: boolean
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
  searchPlaceholder?: string
  emptyMessage?: string
  triggerClassName?: string
  popupClassName?: string
  triggerProps?: TriggerProps
  renderValue?: (selected: PickerOption | null) => ReactNode
  iconClassName?: string
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")
  // Filtering is the expensive part on a large catalog; keep the controlled
  // input itself on the raw value so typed text appears immediately and defer
  // only the work that derives the visible rows.
  const deferredQuery = useDeferredValue(inputValue)
  const virtualizerRef = useRef<Virtualizer | null>(null)
  const isVirtualized = options.length > VIRTUALIZE_THRESHOLD
  const listRef = useRef<HTMLDivElement | null>(null)
  const resetPendingRef = useRef(false)

  // One lowercase search string per option, rebuilt only when the catalog
  // changes. Query tokenization happens once per deferred keystroke below.
  const searchKeys = useMemo(() => {
    const keys = new Map<PickerOption, string>()
    for (const option of options) keys.set(option, pickerOptionSearchKey(option))
    return keys
  }, [options])

  const filteredOptions = useMemo(() => {
    const words = deferredQuery
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    if (words.length === 0) return options
    return options.filter((option) => {
      const key = searchKeys.get(option)
      return key !== undefined && words.every((word) => key.includes(word))
    })
  }, [options, searchKeys, deferredQuery])

  // One reset per open. Base UI scrolls its initial highlight into view
  // asynchronously, so the reset happens once in a rAF after the portalled
  // list has mounted and that scroll has been applied.
  const resetScroll = useCallback(() => {
    const list = listRef.current
    if (list) list.scrollTop = 0
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      resetPendingRef.current = false
      return
    }
    resetPendingRef.current = true
    const frame = requestAnimationFrame(() => {
      if (!resetPendingRef.current) return
      resetPendingRef.current = false
      resetScroll()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, resetScroll])

  // The ref callback only stores the node; all resets go through the effect.
  const attachList = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node
  }, [])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setInputValue("")
  }, [])

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )
  const selectedLabel = selected
    ? showDetail && selected.detail
      ? selected.detail
      : selected.label
    : placeholder

  const listChildren: ReactNode | ((option: PickerOption) => ReactNode) =
    isVirtualized ? (
      <VirtualizedPickerList
        open={open}
        virtualizerRef={virtualizerRef}
        favorites={favorites}
        showFavorite={Boolean(onToggleFavorite)}
        onToggleFavorite={onToggleFavorite}
      />
    ) : (
      (option: PickerOption) => (
        <PickerOptionRow
          key={option.value}
          option={option}
          favorite={favorites?.has(option.value) ?? false}
          showFavorite={Boolean(onToggleFavorite)}
          onToggleFavorite={onToggleFavorite}
        />
      )
    )

  return (
    <ComboboxPrimitive.Root
      items={options}
      filteredItems={filteredOptions}
      filter={null}
      value={selected}
      open={open}
      onOpenChange={handleOpenChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      autoHighlight={false}
      virtualized={isVirtualized}
      onItemHighlighted={(_item, { reason, index }) => {
        const virtualizer = virtualizerRef.current
        if (!virtualizer) return
        const isEnd = index === virtualizer.options.count - 1
        const shouldScroll =
          reason === "none" || (reason === "keyboard" && (index === 0 || isEnd))
        if (shouldScroll) {
          queueMicrotask(() => {
            virtualizer.scrollToIndex(index, {
              align: isEnd ? "start" : "end",
            })
          })
        }
      }}
      onValueChange={(next) => {
        const nextOption = Array.isArray(next) ? next[0] : next
        if (nextOption) onValueChange(nextOption.value)
      }}
      isItemEqualToValue={(left, right) => left.value === right.value}
      itemToStringLabel={(option) => option.label}
      disabled={disabled}
      modal={modal}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        type="button"
        aria-label={ariaLabel ?? label}
        className={cn(
          "flex h-11 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pe-2 ps-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          triggerClassName
        )}
        {...triggerProps}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {busy ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
          ) : selected?.icon ? (
            <span className="shrink-0 text-muted-foreground [&_svg]:size-4">
              {selected.icon}
            </span>
          ) : null}
          <span dir="auto" className="min-w-0 truncate">
            {renderValue ? renderValue(selected) : selectedLabel}
          </span>
        </span>
        <ComboboxPrimitive.Icon>
          <ChevronDownIcon
            className={cn(
              "pointer-events-none shrink-0 text-muted-foreground",
              iconClassName
            )}
          />
        </ComboboxPrimitive.Icon>
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={6}
          className="isolate z-50"
        >
          <ComboboxPrimitive.Popup
            aria-label={ariaLabel ?? label}
            className={cn(
              "flex max-h-[min(24rem,var(--available-height))] w-[min(24rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95 data-starting-style:animate-in data-starting-style:fade-in-0 data-starting-style:zoom-in-95",
              popupClassName
            )}
          >
            <div className="shrink-0 border-b border-border p-1">
              <div className="relative">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <ComboboxPrimitive.Input
                  aria-label={`Search ${label}`}
                  placeholder={searchPlaceholder}
                  className="h-11 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pe-2.5 ps-9 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80"
                />
              </div>
            </div>
            <ComboboxPrimitive.Empty>
              <div className="px-3 py-4 text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List
              ref={attachList}
              className={
                isVirtualized
                  ? "min-h-0 flex-1 p-1 outline-0"
                  : "min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 scroll-py-1 outline-0"
              }
            >
              {listChildren}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
