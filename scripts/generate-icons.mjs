#!/usr/bin/env bun
/**
 * Regenerate the browser / iOS Home Screen icon set from the existing
 * public/favicon.svg mark. No external artwork or brand assets are used.
 *
 * Playwright (already a test-only dependency) rasterizes the SVG; this script
 * never runs in the app bundle. The ICO is assembled from PNG frames here so no
 * extra image dependency is required.
 */
import { readdirSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"

const root = new URL("..", import.meta.url).pathname
const publicDir = join(root, "public")
const iconsDir = join(publicDir, "icons")
const background = "#1b1b1f"

function findChromium() {
  const cache = join(homedir(), ".cache", "ms-playwright")
  const candidates = []
  try {
    const entries = readdirSync(cache)
    for (const entry of entries) {
      if (entry.startsWith("chromium-")) {
        candidates.push(join(cache, entry, "chrome-linux64", "chrome"))
      }
    }
  } catch {
    // The caller receives the explicit error below.
  }
  candidates.sort()
  return process.env.CHROMIUM_EXECUTABLE ?? candidates.at(-1) ?? null
}

function svgDocument(size, { opaque = false, safeScale = 1 } = {}) {
  const inset = (size * (1 - safeScale)) / 2
  const scale = (size * safeScale) / 32
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${size}px;height:${size}px;background:${opaque ? background : "transparent"};}
#icon{width:${size}px;height:${size}px;overflow:hidden;}
svg{display:block;width:${size}px;height:${size}px;}
</style></head><body><div id="icon">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${opaque ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
<g transform="translate(${inset} ${inset}) scale(${scale})">
  <rect width="32" height="32" rx="8" fill="${background}" />
  <path d="M12 10l6 6-6 6" fill="none" stroke="#f4f4f5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
</g>
</svg></div></body></html>`
}

async function rasterize(page, size, filename, options = {}) {
  await page.setViewportSize({ width: Math.max(size, 100), height: Math.max(size, 100) })
  await page.setContent(svgDocument(size, options), { waitUntil: "load" })
  const icon = page.locator("#icon")
  await icon.screenshot({
    path: join(publicDir, filename),
    omitBackground: !options.opaque,
  })
}

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = 6 + entries.length
  images.forEach(({ size, bytes }, index) => {
    const at = index * 16
    entries.writeUInt8(size >= 256 ? 0 : size, at)
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1)
    entries.writeUInt8(0, at + 2)
    entries.writeUInt8(0, at + 3)
    entries.writeUInt16LE(1, at + 4)
    entries.writeUInt16LE(32, at + 6)
    entries.writeUInt32LE(bytes.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += bytes.length
  })
  return Buffer.concat([header, entries, ...images.map((image) => image.bytes)])
}

const executablePath = findChromium()
if (!executablePath) {
  throw new Error(
    "Chromium is required to regenerate icons. Install the existing Playwright browser or set CHROMIUM_EXECUTABLE."
  )
}

await mkdir(iconsDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })

try {
  await rasterize(page, 16, "favicon-16x16.png")
  await rasterize(page, 32, "favicon-32x32.png")
  await rasterize(page, 192, "icons/icon-192.png")
  await rasterize(page, 512, "icons/icon-512.png")
  await rasterize(page, 180, "apple-touch-icon.png", { opaque: true, safeScale: 0.76 })
  await rasterize(page, 512, "icons/icon-maskable-512.png", { opaque: true, safeScale: 0.76 })

  for (const [size, name] of [
    [16, "favicon-16x16.png"],
    [32, "favicon-32x32.png"],
  ]) {
    await rasterize(page, size, join("icons", `.tmp-${name}`))
  }
  await rasterize(page, 48, join("icons", ".tmp-favicon-48x48.png"))

  const frames = []
  for (const size of [16, 32, 48]) {
    const file = size === 48 ? ".tmp-favicon-48x48.png" : `.tmp-favicon-${size}x${size}.png`
    frames.push({
      size,
      bytes: await readFile(join(publicDir, "icons", file)),
    })
  }
  await writeFile(join(publicDir, "favicon.ico"), ico(frames))

  await writeFile(
    join(publicDir, "safari-pinned-tab.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="opencode-ui">
  <path d="M12 10l6 6-6 6" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`
  )
} finally {
  await browser.close()
  for (const size of [16, 32, 48]) {
    const file = size === 48 ? ".tmp-favicon-48x48.png" : `.tmp-favicon-${size}x${size}.png`
    await rm(join(publicDir, "icons", file), { force: true })
  }
}
