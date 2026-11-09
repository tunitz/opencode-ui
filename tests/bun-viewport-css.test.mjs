import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

const hasBuild = existsSync("dist-bun-build")

test.skipIf(!hasBuild)("built mobile shell keeps the visual viewport height as the final height declaration", async () => {
  const files = Array.from(new Bun.Glob("dist-bun-build/assets/*.css").scanSync())
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")))
  const css = contents.find((text) => text.includes(".app-height{"))
  expect(css).toBeDefined()
  const block = css.match(/\.app-height\{([^}]*)\}/)?.[1]
  expect(block).toBeDefined()
  const heights = [...block.matchAll(/(?:^|;)height:([^;]+)/g)].map((match) => match[1])
  expect(heights.at(-1)).toBe("var(--app-viewport-height,100vh)")
})
