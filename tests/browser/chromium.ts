import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright-core"

function cachedChromiumCandidates(): string[] {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.HOME ? join(process.env.HOME, ".cache/ms-playwright") : null,
  ].filter((entry): entry is string => Boolean(entry && existsSync(entry)))

  const discovered: Array<{ rev: number; path: string }> = []
  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const match = /^chromium-(\d+)$/.exec(entry)
      if (!match) continue
      const rev = Number(match[1])
      for (const rel of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      ]) {
        const candidate = join(root, entry, rel)
        if (existsSync(candidate)) {
          discovered.push({ rev, path: candidate })
          break
        }
      }
    }
  }
  discovered.sort((a, b) => b.rev - a.rev)
  return discovered.map((item) => item.path)
}

export function findChromiumExecutable(): string | null {
  const override = process.env.OPENCODE_UI_CHROMIUM?.trim()
  if (override && existsSync(override)) return override

  try {
    const playwrightPath = chromium.executablePath()
    if (playwrightPath && existsSync(playwrightPath)) return playwrightPath
  } catch {
    // Fall through to scanning the ms-playwright cache.
  }

  return cachedChromiumCandidates()[0] ?? null
}
