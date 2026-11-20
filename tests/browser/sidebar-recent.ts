/**
 * Reusable synthetic browser checks for the sidebar Recent/Archive layout.
 *
 * Call from tests/browser/run.ts inside `run(...)` with its `check` helper:
 *   await checkSidebarRecent(page, { mobile, check })
 *
 * The caller owns the fixture, server, browser, viewport, and reduced motion.
 * No engine, provider, credential, live session, or network service is used here.
 */
import type { Page } from "playwright-core"

type Check = (step: string, condition: unknown, detail?: string) => void

type Layout = {
  navHeight: number
  navBottom: number
  recentHeight: number
  recentBottom: number
  archiveTop: number
  panelCount: number
  itemOpen: boolean
  itemFlexGrow: number
  triggerPanelOpen: boolean
  viewportOverflowY: string
  viewportClientHeight: number
  viewportScrollHeight: number
}

async function readLayout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="Sessions"]')].find(
      (element) => (element as HTMLElement).getClientRects().length > 0
    ) as HTMLElement | undefined
    if (!nav) throw new Error("No visible sessions navigation")

    const accordions = [...nav.querySelectorAll('[data-slot="accordion"]')]
    const recent = accordions.find((element) =>
      element.textContent?.includes("Recent")
    ) as HTMLElement
    const archive = accordions.find((element) =>
      element.textContent?.includes("Archive")
    ) as HTMLElement
    const item = recent.querySelector('[data-slot="accordion-item"]') as HTMLElement
    const trigger = recent.querySelector('[data-slot="accordion-trigger"]') as HTMLElement
    const recentRect = item.getBoundingClientRect()
    const archiveRect = archive
      .querySelector('[data-slot="accordion-item"]')!
      .getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    const viewport = [...nav.querySelectorAll('[role="group"]')].find(
      (element) => element.getAttribute("aria-label") === "Recent sessions"
    ) as HTMLElement | undefined
    const style = viewport ? getComputedStyle(viewport) : null

    return {
      navHeight: navRect.height,
      navBottom: navRect.bottom,
      recentHeight: recentRect.height,
      recentBottom: recentRect.bottom,
      archiveTop: archiveRect.top,
      panelCount: recent.querySelectorAll('[data-slot="accordion-panel"]').length,
      // Base UI sets data-open="" on the item and data-panel-open="" on the
      // trigger only while open. Reading the rendered state (not React state)
      // catches bundles whose flex styling diverges from the accordion state.
      itemOpen: item.hasAttribute("data-open"),
      itemFlexGrow: Number.parseFloat(getComputedStyle(item).flexGrow) || 0,
      triggerPanelOpen: trigger?.hasAttribute("data-panel-open") ?? false,
      viewportOverflowY: style?.overflowY ?? "",
      viewportClientHeight: viewport?.clientHeight ?? 0,
      viewportScrollHeight: viewport?.scrollHeight ?? 0,
    }
  })
}

async function waitForPanelCount(page: Page, count: number) {
  await page.waitForFunction(
    (expected) => {
      const nav = [...document.querySelectorAll('nav[aria-label="Sessions"]')].find(
        (element) => (element as HTMLElement).getClientRects().length > 0
      )
      if (!nav) return false
      const recent = [...nav.querySelectorAll('[data-slot="accordion"]')].find(
        (element) => element.textContent?.includes("Recent")
      )
      return (
        recent?.querySelectorAll('[data-slot="accordion-panel"]').length === expected
      )
    },
    count,
    { timeout: 5_000 }
  )
}

/** Base UI mounts a reopened panel at zero height before it measures content. */
async function waitForExpandedGeometry(page: Page, expectedHeight: number) {
  await page.waitForFunction(
    (expected) => {
      const nav = [...document.querySelectorAll('nav[aria-label="Sessions"]')].find(
        (element) => (element as HTMLElement).getClientRects().length > 0
      )
      if (!nav) return false
      const recent = [...nav.querySelectorAll('[data-slot="accordion"]')].find(
        (element) => element.textContent?.includes("Recent")
      )
      const card = recent?.querySelector('[data-slot="accordion-item"]')
      const viewport = [...nav.querySelectorAll('[role="group"]')].find(
        (element) => element.getAttribute("aria-label") === "Recent sessions"
      ) as HTMLElement | undefined
      return (
        (card?.getBoundingClientRect().height ?? 0) >= expected - 20 &&
        (viewport?.clientHeight ?? 0) > 0
      )
    },
    expectedHeight,
    { timeout: 3_000 }
  )
}

/**
 * Verify that expanded Recent fills the available sidebar while staying a
 * bounded scroller with Archive visible, and that collapsing it sizes the card
 * to its trigger and lets Archive reflow upward with normal layout flow.
 */
export async function checkSidebarRecent(
  page: Page,
  { mobile, check }: { mobile: boolean; check: Check }
): Promise<void> {
  if (mobile) {
    const sheet = page.locator('[data-slot="sheet-content"]')
    if (!(await sheet.isVisible())) {
      await page.getByRole("button", { name: "Open sessions" }).click()
      await sheet.waitFor({ state: "visible" })
    }
  }

  const nav = page.getByRole("navigation", { name: "Sessions" })
  await nav.waitFor({ state: "visible" })
  const trigger = nav.getByRole("button", { name: "Recent", exact: true })
  await trigger.waitFor({ state: "visible" })

  const expanded = await readLayout(page)
  check(
    "expanded Recent fills the available sidebar height",
    expanded.recentHeight >= expanded.navHeight / 2 &&
      expanded.recentBottom <= expanded.navBottom + 1,
    JSON.stringify(expanded)
  )
  check(
    "Archive stays visible below the expanded Recent card",
    expanded.archiveTop >= expanded.recentBottom &&
      expanded.archiveTop < expanded.navBottom,
    JSON.stringify(expanded)
  )
  check(
    "expanded Recent is an independent bounded scroller",
    expanded.panelCount === 1 &&
      expanded.viewportOverflowY === "auto" &&
      expanded.viewportClientHeight > 0 &&
      expanded.viewportScrollHeight >= expanded.viewportClientHeight,
    JSON.stringify(expanded)
  )
  check(
    "expanded Recent item exposes Base UI open state and grows",
    expanded.itemOpen && expanded.triggerPanelOpen && expanded.itemFlexGrow >= 1,
    JSON.stringify(expanded)
  )

  await trigger.click()
  await waitForPanelCount(page, 0)
  const collapsed = await readLayout(page)
  check("collapsing Recent removes its panel", collapsed.panelCount === 0, JSON.stringify(collapsed))
  check(
    "collapsed Recent reserves no expanded height",
    collapsed.recentHeight <= 60,
    `height=${collapsed.recentHeight}`
  )
  // The production screenshot reproduced an unconditional flex-1: the header
  // was closed (right chevron) but the card still grew to fill the sidebar.
  // Assert the rendered accordion state and computed flex growth together so
  // this class of divergence fails even if the panel count looks correct.
  check(
    "collapsed Recent item is closed and no longer grows",
    !collapsed.itemOpen &&
      !collapsed.triggerPanelOpen &&
      collapsed.itemFlexGrow === 0,
    JSON.stringify(collapsed)
  )
  check(
    "Archive reflows upward with normal layout flow",
    collapsed.archiveTop < expanded.archiveTop - 20 &&
      collapsed.archiveTop - collapsed.recentBottom <= 24,
    JSON.stringify({ expanded, collapsed })
  )

  // Live selection/activity frames can retrigger the accordion rapidly. A
  // closed header must stay physically small after an open/close burst.
  await trigger.click()
  await waitForPanelCount(page, 1)
  await trigger.click()
  await waitForPanelCount(page, 0)
  const burstCollapsed = await readLayout(page)
  check(
    "rapid open/close leaves Recent closed and small",
    burstCollapsed.recentHeight <= 60 &&
      !burstCollapsed.itemOpen &&
      burstCollapsed.itemFlexGrow === 0,
    JSON.stringify(burstCollapsed)
  )

  await trigger.click()
  await waitForPanelCount(page, 1)
  await waitForExpandedGeometry(page, expanded.recentHeight)
  const reopened = await readLayout(page)
  check(
    "re-expanding Recent restores the filled bounded scroller",
    Math.abs(reopened.recentHeight - expanded.recentHeight) <= 20 &&
      reopened.panelCount === 1 &&
      reopened.viewportOverflowY === "auto" &&
      reopened.viewportClientHeight > 0 &&
      reopened.itemOpen &&
      reopened.triggerPanelOpen &&
      reopened.itemFlexGrow >= 1,
    JSON.stringify({ expanded, reopened })
  )
}
