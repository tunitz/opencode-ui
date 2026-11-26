import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { compile } from "@tailwindcss/node"
import { cn } from "cn"
import { chromium } from "playwright-core"

test.skipIf(!existsSync(chromium.executablePath()))("command results shrink and scroll in the mobile sheet and desktop dialog", async () => {
  const command = await readFile("src/components/command-center.tsx", "utf8")
  const responsive = await readFile("src/components/ui/responsive-dialog-content.tsx", "utf8")
  const sheet = await readFile("src/components/ui/sheet.tsx", "utf8")
  const dialog = await readFile("src/components/ui/dialog.tsx", "utf8")
  const commandClasses = command.match(/className="([^"]+)"\s+initialFocus=\{inputRef\}/)?.[1]
  const resultsClasses = command.match(/data-command-results\s+className="([^"]+)"/)?.[1]
  const mobileClasses = responsive.match(/"(w-full max-w-none overflow-y-auto[^"]+)"/)?.[1]
  const sheetClasses = sheet.match(/"(fixed z-50 flex flex-col gap-4 bg-popover[^"]+)"/)?.[1]
  const dialogClasses = dialog.match(/"(fixed top-1\/2 left-1\/2 z-50 grid[^"]+)"/)?.[1]
  expect([commandClasses, resultsClasses, mobileClasses, sheetClasses, dialogClasses].every(Boolean)).toBe(true)

  // Compile the actual component classes, including the mobile wrapper's
  // direct-child rule, so this catches cascade and flex sizing regressions.
  const mobile = cn(sheetClasses, "p-4", commandClasses, mobileClasses)
  const desktop = cn(dialogClasses, commandClasses)
  const css = (await compile('@import "tailwindcss";', { base: process.cwd(), onDependency: () => {} }))
    .build([...new Set(`${mobile} ${desktop} ${resultsClasses}`.split(/\s+/))])
  const browser = await chromium.launch({ headless: true })
  try {
    for (const isMobile of [true, false]) {
      const page = await browser.newPage({
        viewport: isMobile ? { width: 390, height: 600 } : { width: 1280, height: 800 },
        isMobile,
        hasTouch: isMobile,
      })
      await page.setContent(`<style>${css}</style><div role="dialog" data-side="bottom" class="${isMobile ? mobile : desktop}" ${isMobile ? 'style="height:88vh;max-height:100vh;bottom:0"' : ""}>
        <h2>Command center</h2><p>Search loaded sessions and projects.</p><input aria-label="Search command center">
        <div data-command-results aria-label="Command results" class="${resultsClasses}">${Array.from({ length: 40 }, (_, i) => `<button style="display:block;height:44px;width:100%">Result ${i}</button>`).join("")}</div></div>`)
      const results = page.locator("[data-command-results]")
      const dimensions = await results.evaluate((element) => ({
        height: element.clientHeight,
        content: element.scrollHeight,
        shrink: getComputedStyle(element).flexShrink,
      }))
      expect(dimensions.shrink).toBe("1")
      expect(dimensions.content).toBeGreaterThan(dimensions.height)
      if (isMobile) {
        const box = await results.boundingBox()
        const cdp = await page.context().newCDPSession(page)
        const x = box.x + box.width / 2
        const y = box.y + Math.min(box.height - 10, 250)
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
        for (let offset = 20; offset <= 160; offset += 20) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - offset }] })
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
        await cdp.detach()
      } else {
        await results.hover()
        await page.mouse.wheel(0, 500)
      }
      await page.waitForFunction(() => document.querySelector("[data-command-results]").scrollTop > 0)
      await page.getByRole("button", { name: "Result 39" }).focus()
      expect(await results.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
      await page.close()
    }
  } finally {
    await browser.close()
  }
}, 30000)
