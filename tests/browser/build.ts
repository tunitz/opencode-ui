/**
 * Builds the isolated browser fixture with Bun and the same Tailwind compiler
 * that scripts/build-bun.ts uses. Output goes outside the repository under
 * /tmp/opencode so the test run leaves no build artifacts in the work tree.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { compile, optimize } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"
import { readFile } from "node:fs/promises"

const repoRoot = resolve(import.meta.dir, "../..")

export async function buildFixture(
  outDir: string,
  entrypoint: string = join(repoRoot, "tests/browser/fixture.tsx")
): Promise<{ url: string }> {
  await mkdir(join(outDir, "assets"), { recursive: true })

  const cssEntry = join(repoRoot, "src/index.css")
  const compiler = await compile(await readFile(cssEntry, "utf8"), {
    from: cssEntry,
    base: dirname(cssEntry),
    shouldRewriteUrls: true,
    onDependency: () => {},
  })
  const sources =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: repoRoot, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }]
  const scanner = new Scanner({ sources: sources.concat(compiler.sources) })
  const candidates = new Set<string>()
  for (const candidate of scanner.scan()) candidates.add(candidate)
  const tailwindCss = compiler.build([...candidates])

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: outDir,
    target: "browser",
    splitting: true,
    minify: true,
    sourcemap: "inline",
    publicPath: "/",
    naming: {
      entry: "assets/fixture.[ext]",
      chunk: "assets/chunk-[hash].[ext]",
      asset: "assets/asset-[hash].[ext]",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(`[fixture build] ${log.level}: ${log.message}`)
    }
    throw new Error("Fixture build failed")
  }

  const emittedCss = await Promise.all(
    result.outputs
      .filter((output) => output.path.endsWith(".css"))
      .map((output) => readFile(output.path, "utf8"))
  )
  const css = optimize([tailwindCss, ...emittedCss].join("\n"), {
    minify: true,
  }).code
  await writeFile(join(outDir, "assets/fixture.css"), css)

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>OpenCode UI synthetic fixture</title>
    <link rel="stylesheet" href="/assets/fixture.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/fixture.js"></script>
  </body>
</html>
`
  await writeFile(join(outDir, "index.html"), html)
  return { url: "/" }
}
