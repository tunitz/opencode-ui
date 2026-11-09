"use client"

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, SearchIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

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

export function matchesPickerOption(
  option: Pick<PickerOption, "label" | "detail" | "value">,
  query: string
): boolean {
  const words = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return true

  const text = [option.label, option.detail, option.value]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()

  return words.every((word) => text.includes(word))
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
}) {
  const selected = options.find((option) => option.value === value) ?? null
  const selectedLabel = selected
    ? showDetail && selected.detail
      ? selected.detail
      : selected.label
    : placeholder

  return (
    <ComboboxPrimitive.Root
      items={options}
      value={selected}
      onValueChange={(next) => {
        const nextOption = Array.isArray(next) ? next[0] : next
        if (nextOption) onValueChange(nextOption.value)
      }}
      isItemEqualToValue={(left, right) => left.value === right.value}
      itemToStringLabel={(option) => option.label}
      filter={(option, query) => matchesPickerOption(option, query)}
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
            <ComboboxPrimitive.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 scroll-py-1 outline-0">
              {(option: PickerOption) => (
                <ComboboxPrimitive.Item
                  key={option.value}
                  value={option}
                  disabled={option.disabled}
                  className="relative flex min-h-11 w-full cursor-default items-start gap-2 rounded-md py-2 pe-8 ps-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
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
                  <ComboboxPrimitive.ItemIndicator
                    render={
                      <span className="pointer-events-none absolute end-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center" />
                    }
                  >
                    <CheckIcon className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
