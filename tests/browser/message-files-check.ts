/**
 * Side-effect-free assertions for sent-message attachment strips.
 *
 * Import `checkMessageFilesStrip` into any browser runner that has mounted
 * `MessageFilesFixture` on a page. No build, server, or browser setup here.
 */
import type { Page } from "playwright-core"

import { filesForCase, type MessageFilesCase } from "./message-files-fixture"

export type StripDir = "ltr" | "rtl"
type Check = (step: string, ok: unknown, detail?: string) => void

type ChipMetric = {
  x: number
  width: number
  height: number
  name: string
  visible: boolean
}
export type StripMetrics = {
  pageOverflow: number
  scrollLeft: number
  scroller: {
    x: number
    right: number
    scrollWidth: number
    clientWidth: number
    overflowX: string
    overscrollBehaviorX: string
    scrollbarWidth: string
    tabIndex: number
    role: string | null
  } | null
  chips: ChipMetric[]
  groupLabel: string | null
}

export async function stripMetrics(page: Page): Promise<StripMetrics> {
  return page.evaluate(() => {
    const group = document.querySelector('[role="group"]') as HTMLElement | null
    const chips = Array.from(
      document.querySelectorAll('[data-slot="attachment"]')
    ) as HTMLElement[]
    const style = group ? getComputedStyle(group) : null
    const box = group?.getBoundingClientRect()
    const left = box?.left ?? 0
    const right = box?.right ?? 0
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollLeft: group?.scrollLeft ?? 0,
      scroller: group && style ? {
        x: left,
        right,
        scrollWidth: group.scrollWidth,
        clientWidth: group.clientWidth,
        overflowX: style.overflowX,
        overscrollBehaviorX: style.overscrollBehaviorX,
        scrollbarWidth: style.scrollbarWidth,
        tabIndex: group.tabIndex,
        role: group.getAttribute("role"),
      } : null,
      chips: chips.map((chip) => {
        const rect = chip.getBoundingClientRect()
        return {
          x: rect.x,
          width: rect.width,
          height: rect.height,
          name: (chip.querySelector('[data-slot="attachment-title"]')?.textContent ?? "").slice(0, 60),
          visible: rect.left >= left - 1 && rect.right <= right + 1,
        }
      }),
      groupLabel: group?.getAttribute("aria-label") ?? null,
    }
  })
}

async function swipeToEnd(page: Page, dir: StripDir) {
  const group = page.locator('[role="group"]')
  const box = await group.boundingBox()
  if (!box) throw new Error("Attachment strip has no bounding box")
  const cdp = await page.context().newCDPSession(page)
  const y = box.y + box.height / 2
  const startX = dir === "ltr" ? box.x + box.width * 0.85 : box.x + box.width * 0.15
  const endX = dir === "ltr" ? box.x + box.width * 0.15 : box.x + box.width * 0.85
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y }],
    })
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX + ((endX - startX) * step) / 8, y }],
      })
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

/** Assert layout, local scrolling, reachability and previews on a mounted fixture page. */
export async function checkMessageFilesStrip(
  page: Page,
  options: {
    testCase: MessageFilesCase
    dir: StripDir
    hasTouch?: boolean
    check: Check
  }
): Promise<void> {
  const { testCase, dir, hasTouch, check } = options
  const files = filesForCase(testCase)
  const group = page.locator('[role="group"]')
  const initial = await stripMetrics(page)

  check("fixture mounted", (await page.locator(`[data-case="${testCase}"]`).count()) === 1)
  check(
    "group exposes an accessible, named count",
    initial.groupLabel === `${files.length} attached file${files.length === 1 ? "" : "s"}`,
    initial.groupLabel ?? "no label"
  )
  check("no horizontal page overflow", initial.pageOverflow <= 0, `overflow=${initial.pageOverflow}`)
  check(
    "strip scrolls locally with the native scrollbar kept",
    initial.scroller?.overflowX === "auto" &&
      initial.scroller.scrollbarWidth !== "none" &&
      initial.scroller.overscrollBehaviorX === "contain",
    JSON.stringify(initial.scroller)
  )
  check("every file is rendered as a chip", initial.chips.length === files.length,
    `chips=${initial.chips.length} files=${files.length}`)

  const imageIndexes = files.flatMap((file, index) =>
    file.mime.startsWith("image/") ? [index] : []
  )
  const sized = initial.chips.every((chip, index) =>
    imageIndexes.includes(index)
      ? Math.abs(chip.width - 44) <= 1 && Math.abs(chip.height - 44) <= 1
      : chip.width <= 140
  )
  check(
    "thumbnails are 44px and file chips stay width-bounded",
    sized,
    JSON.stringify(initial.chips.map((chip) => `${chip.width}x${chip.height}`))
  )
  check(
    "all chip targets are at least 44px",
    initial.chips.every((chip) => chip.width >= 44 && chip.height >= 44),
    JSON.stringify(initial.chips.map((chip) => `${chip.width}x${chip.height}`))
  )

  const scrollable = Boolean(
    initial.scroller && initial.scroller.scrollWidth > initial.scroller.clientWidth + 1
  )
  if (testCase === "many" || testCase === "binary") {
    check("long attachment row creates local overflow", scrollable,
      JSON.stringify(initial.scroller))
  }
  if (scrollable) {
    check(
      "logical start is visible at rest (no clipped first chip)",
      initial.chips[0]?.visible === true,
      JSON.stringify(initial.chips[0])
    )
  }

  // Keyboard reachability. The strip itself is a named tab stop so a row of
  // non-previewable files (no focusable chip buttons) can still be scrolled.
  check(
    "strip is a named, keyboard-focusable scroll region",
    initial.scroller?.role === "group" && initial.scroller.tabIndex === 0,
    JSON.stringify(initial.scroller)
  )
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  let reachedByTab = false
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab")
    reachedByTab = await page.evaluate(
      () => document.activeElement?.getAttribute("role") === "group" &&
        (document.activeElement?.getAttribute("aria-label") ?? "").includes("attached file")
    )
    if (reachedByTab) break
  }
  check("Tab reaches the named scroll container", reachedByTab)
  const focusRing = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element) return ""
    const style = getComputedStyle(element)
    return `${style.boxShadow}|${style.outlineStyle}`
  })
  check("focused strip has a visible inset ring", focusRing.includes("inset"), focusRing)
  // Chromium does not keyboard-scroll nested overflow containers with arrow
  // keys, so reachability is provided by the focusable chips themselves:
  // focusing each chip makes the browser scroll it into view inside the strip.
  // The named container above stays a tab stop for discoverability, focus
  // return, and screen-reader announcement.
  await group.focus()
  for (let index = 0; index < files.length; index += 1) {
    await page.keyboard.press("Tab")
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())))
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      const rect = element?.getBoundingClientRect()
      const groupRect = document.querySelector('[role="group"]')?.getBoundingClientRect()
      return {
        inChip: Boolean(element?.closest('[data-slot="attachment"]')),
        label: element?.getAttribute("aria-label"),
        rect: rect ? `${Math.round(rect.left)}..${Math.round(rect.right)}` : null,
        group: groupRect ? `${Math.round(groupRect.left)}..${Math.round(groupRect.right)}` : null,
        visible: Boolean(
          rect && groupRect &&
            rect.left >= groupRect.left - 1 && rect.right <= groupRect.right + 1
        ),
      }
    })
    check(
      `Tab ${index + 1} focuses a visible attachment`,
      focused.inChip && focused.visible,
      JSON.stringify(focused)
    )
  }

  // Pointer reachability: scrollIntoViewIfNeeded uses the nearest scroll
  // container, so a chip trapped in a clipped, non-scrollable row fails here.
  const firstChip = group.locator('[data-slot="attachment"]').first()
  const lastChip = group.locator('[data-slot="attachment"]').last()
  await firstChip.scrollIntoViewIfNeeded()
  check("first attachment can be scrolled into view", (await stripMetrics(page)).chips[0]?.visible === true)
  await lastChip.scrollIntoViewIfNeeded()
  const atEnd = await stripMetrics(page)
  check("last attachment can be scrolled into view", atEnd.chips.at(-1)?.visible === true,
    JSON.stringify(atEnd.chips.at(-1)))

  if (hasTouch && testCase === "many") {
    await group.evaluate((element) => { (element as HTMLElement).scrollLeft = 0 })
    const before = await stripMetrics(page)
    await swipeToEnd(page, dir)
    const after = await stripMetrics(page)
    check(
      "touch swipe scrolls the strip, not the page",
      Math.abs(after.scrollLeft) > Math.abs(before.scrollLeft) + 20 &&
        after.pageOverflow <= 0,
      `before=${before.scrollLeft} after=${after.scrollLeft}`
    )
  }

  const triggerCount = await group.locator('[data-slot="attachment-trigger"]').count()
  if (testCase === "binary") {
    check("non-previewable files expose no misleading preview buttons", triggerCount === 0,
      `triggers=${triggerCount}`)
  } else {
    check("every previewable chip has a trigger", triggerCount === files.length,
      `triggers=${triggerCount} files=${files.length}`)
    for (const index of [0, files.length - 1]) {
      const trigger = group.locator('[data-slot="attachment-trigger"]').nth(index)
      await trigger.click()
      // ResponsiveDialogContent renders a Dialog on desktop and a bottom Sheet
      // on touch/mobile widths.
      const surface = page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]')
      await surface.waitFor({ state: "visible" })
      const title =
        (await surface.locator('[data-slot="dialog-title"], [data-slot="sheet-title"]').textContent()) ?? ""
      check(
        `attachment ${index} opens its preview`,
        title.includes(files[index].name ?? ""),
        title
      )
      await page.keyboard.press("Escape")
      await surface.waitFor({ state: "hidden" })
    }
  }
}
