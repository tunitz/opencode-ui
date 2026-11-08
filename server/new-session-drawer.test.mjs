import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chromium } from "playwright-core"

test.skipIf(!existsSync(chromium.executablePath()))("outside click and tap dismiss only the nested new session drawer", async () => {
  const build = await Bun.build({ entrypoints: ["server/fixtures/new-session-drawer-fixture.tsx"], target: "browser" })
  expect(build.success).toBe(true)
  const script = await build.outputs[0].text()
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (new URL(request.url).pathname === "/fixture.js") return new Response(script, { headers: { "content-type": "text/javascript" } })
      return new Response(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
        [data-slot=sheet-overlay] { position: fixed; inset: 0; z-index: 50 }
        [data-slot=sheet-content] { position: fixed; z-index: 50; background: white }
        [data-side=right] { inset: 0 auto 0 0; width: 90% }
        [data-side=bottom] { left: 0; right: 0 }
      </style><div id="root"></div><script type="module" src="/fixture.js"></script>`, { headers: { "content-type": "text/html" } })
    },
  })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const touch of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: touch })
      page.setDefaultTimeout(4000)
      await page.goto(server.url.href)
      await page.getByRole("button", { name: "Open sessions" }).click()
      await page.getByRole("button", { name: "New session" }).click()
      const drawer = page.getByRole("dialog", { name: "New session" })
      await drawer.waitFor()
      await drawer.getByText("Browse folders").click()
      expect(await drawer.isVisible()).toBe(true)
      if (touch) await page.touchscreen.tap(20, 20)
      else await page.mouse.click(20, 20)
      await drawer.waitFor({ state: "hidden" })
      expect(await page.getByRole("dialog", { name: "Sessions" }).isVisible()).toBe(true)
      await page.getByRole("button", { name: "New session" }).click()
      await drawer.waitFor({ state: "visible" })
      await page.keyboard.press("Escape")
      await drawer.waitFor({ state: "hidden" })
      expect(await page.getByRole("dialog", { name: "Sessions" }).isVisible()).toBe(true)
      await page.close()
    }
  } finally {
    await browser.close()
    server.stop(true)
  }
}, 30000)
