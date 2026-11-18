import { expect, test } from "bun:test"

const read = (path) => Bun.file(new URL(path, import.meta.url)).text()

test("context strip opens on tap/click through a Base UI popover, not a hover card", async () => {
  const source = await read("../src/components/context-strip.tsx")
  expect(source).toContain('from "@/components/ui/popover"')
  expect(source).toContain("PopoverTrigger")
  expect(source).toContain("PopoverContent")
  expect(source).toContain("<Popover>")
  expect(source).toContain("<PopoverTrigger")
  expect(source).toContain("<PopoverContent")
  // Hover cards cannot be opened by touch; they must not remain in the strip.
  expect(source).not.toContain("@/components/ui/hover-card")
  expect(source).not.toContain("HoverCard")
})

test("context strip trigger stays a real, tappable, named button", async () => {
  const source = await read("../src/components/context-strip.tsx")
  expect(source).toContain('<PopoverTrigger\n          render={\n            <Button')
  expect(source).toContain('type="button"')
  // 44px minimum target and an sr-only accessible name survive the swap.
  expect(source).toContain("min-h-11")
  expect(source).toContain("Show response usage and context details")
  // The popup dialog also gets an accessible name when focus enters it.
  expect(source).toContain('aria-label="Context usage details"')
})

test("expanded panel spans the strip width but fits the viewport", async () => {
  const source = await read("../src/components/context-strip.tsx")
  // Match the anchor (full strip) width instead of the old narrow 28rem card.
  expect(source).toContain("w-[var(--anchor-width,min(92vw,28rem))]")
  // Bound horizontally on 320-390px screens and vertically on short viewports.
  expect(source).toContain("max-w-[calc(100vw-1rem)]")
  expect(source).toContain("max-h-[70svh]")
  expect(source).toContain("overflow-y-auto")
  expect(source).not.toContain("w-[min(92vw,28rem)]")
})

test("context strip keeps honest data semantics and every detail section", async () => {
  const source = await read("../src/components/context-strip.tsx")
  for (const label of [
    "Context used",
    "Last response",
    "Session total",
    "Model",
    "Current run",
    "Context limit",
    "MISSING_VALUE",
    "Context usage is unavailable for this model.",
  ]) {
    expect(source).toContain(label)
  }
})

test("context strip keeps its once-per-second live timing subscription", async () => {
  const source = await read("../src/components/context-strip.tsx")
  expect(source).toContain("useSyncExternalStore")
  expect(source).toContain("window.setInterval(update, 1000)")
  expect(source).toContain("window.requestAnimationFrame(update)")
})
