// Production frontend build using Bun's native bundler.
//
// Produces the package's self-contained dist-bun-build/ site (dist-bun-dev/
// for development), including public/ and all emitted assets. The deployment
// directory dist-bun/ is deliberately left untouched.
//
// Bun 1.4 has no Tailwind CSS transform, so this script drives the Tailwind
// compiler from @tailwindcss/node (the same engine @tailwindcss/vite uses) and
// hands the generated CSS back to Bun. It also:
// - externalizes CSS url() assets (fonts) instead of inlining them in CSS,
// - resolves `?url` imports (used for the PDF worker) into copied assets,
// - merges per-chunk CSS into the entry stylesheet, because Bun does not load
//   CSS for dynamically imported chunks at runtime.

/* global Bun */

import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { compile, optimize } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"
import type { BunPlugin } from "bun"

const projectRoot = resolve(import.meta.dir, "..")
const sourceDir = join(projectRoot, "src")
const publicDir = join(projectRoot, "public")
const htmlPath = join(projectRoot, "index.html")
const entrypoint = join(sourceDir, "main.tsx")
const buildName = process.env.OPENCODE_UI_BUILD_TARGET === "dev" ? "dist-bun-dev" : "dist-bun-build"
const finalDir = join(projectRoot, buildName)
const outDir = join(projectRoot, `dist-bun-stage-${process.pid}`)
const backupDir = join(projectRoot, `dist-bun-backup-${process.pid}`)
const assetsDir = join(outDir, "assets")
const assetsUrl = "/assets/"
// Absolute URLs are left untouched by Bun's CSS bundler. Rewrite them back to
// root-relative URLs after the build so Bun does not try to resolve fonts from
// the output directory while bundling.
const assetOrigin = "https://opencode-ui-assets.invalid"

const emittedAssets = new Map<string, string>()

async function emitAsset(filePath: string): Promise<string> {
  const cached = emittedAssets.get(filePath)
  if (cached) return cached

  const data = await readFile(filePath)
  const extension = extname(filePath)
  const name = basename(filePath, extension)
  const hash = createHash("sha256").update(data).digest("base64url").slice(0, 8)
  const fileName = `${name}-${hash}${extension}`

  await mkdir(assetsDir, { recursive: true })
  await writeFile(join(assetsDir, fileName), data)

  const url = `${assetsUrl}${fileName}`
  emittedAssets.set(filePath, url)
  return url
}

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/g

// Bun inlines url() assets in CSS, including fonts. Keep them as separate
// hashed files so the page does not block on base64-encoded fonts and the
// output stays comparable to the Vite build.
async function externalizeCssUrls(
  css: string,
  cssFile: string
): Promise<string> {
  const replacements = new Map<string, string>()

  for (const match of css.matchAll(CSS_URL_RE)) {
    const raw = match[1] ?? match[2] ?? match[3]
    if (!raw) continue

    const [pathPart, ...suffixParts] = raw.split(/(?=[?#])/)
    const suffix = suffixParts.join("")
    if (!pathPart || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(pathPart))
      continue

    let url: string
    try {
      url = await emitAsset(resolve(dirname(cssFile), pathPart))
    } catch {
      // Leave unresolvable references to Bun so a genuine build error surfaces.
      continue
    }
    replacements.set(match[0], `url(${assetOrigin}${url}${suffix})`)
  }

  for (const [from, to] of replacements) {
    css = css.split(from).join(to)
  }
  return css
}

const TAILWIND_RE =
  /(?:^|[\s;])(?:@(?:tailwind|apply|theme|utility|variant|custom-variant|source|plugin|config)\b|@import\s+["']tailwindcss["'])/

function tailwindPlugin(): BunPlugin {
  return {
    name: "opencode-ui-tailwind",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const id = args.path
        const source = await readFile(id, "utf8")

        if (!TAILWIND_RE.test(source)) {
          return {
            contents: await externalizeCssUrls(source, id),
            loader: "css",
          }
        }

        const compiler = await compile(source, {
          from: id,
          base: dirname(id),
          shouldRewriteUrls: true,
          onDependency: () => {},
        })
        const sources = (
          compiler.root === "none"
            ? []
            : compiler.root === null
              ? [{ base: projectRoot, pattern: "**/*", negated: false }]
              : [{ ...compiler.root, negated: false }]
        ).concat(compiler.sources)
        const scanner = new Scanner({ sources })
        const candidates = new Set<string>()
        for (const candidate of scanner.scan()) candidates.add(candidate)

        const css = compiler.build([...candidates])
        return { contents: await externalizeCssUrls(css, id), loader: "css" }
      })
    },
  }
}

// `import("some-package/worker.mjs?url")` must resolve to a module exporting a
// URL string, with the target file emitted as an asset. Bun leaves these bare
// specifiers unresolved, so resolve and emit them here.
function urlPlugin(): BunPlugin {
  return {
    name: "opencode-ui-url-assets",
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => {
        const specifier = args.path.slice(0, -"?url".length)
        return {
          path: resolve(Bun.resolveSync(specifier, dirname(args.importer))),
          namespace: "opencode-ui-url",
        }
      })

      build.onLoad(
        { filter: /.*/, namespace: "opencode-ui-url" },
        async (args) => {
          const url = await emitAsset(args.path)
          return {
            contents: `export default ${JSON.stringify(url)}`,
            loader: "js",
          }
        }
      )
    },
  }
}

function toUrl(filePath: string): string {
  return `/${relative(outDir, filePath).split(/[\\/]/).join("/")}`
}

// Bun emits one CSS asset per JS chunk but does not load CSS for dynamic
// imports at runtime. Merge all CSS into the entry stylesheet (which is loaded
// on first paint) so lazy components still get their styles.
type BuildOutput = { kind: string; path: string; size: number }

async function mergeCss(outputs: BuildOutput[]): Promise<BuildOutput> {
  const cssFiles = outputs.filter((output) => output.path.endsWith(".css"))
  if (cssFiles.length === 0) {
    throw new Error("Bun build produced no CSS assets")
  }

  const entry = outputs.find((output) => output.kind === "entry-point")
  if (!entry) {
    throw new Error("Bun build produced no entry-point JavaScript")
  }

  const entryStem = basename(entry.path).replace(/\.[^.]+$/, "")
  const entryName = entryStem.slice(0, entryStem.lastIndexOf("-") + 1)
  const entryCss =
    cssFiles.find((output) => basename(output.path).startsWith(entryName)) ??
    cssFiles.reduce((largest, output) =>
      output.size > largest.size ? output : largest
    )

  const ordered = [
    entryCss,
    ...cssFiles
      .filter((output) => output.path !== entryCss.path)
      .sort((a, b) => a.path.localeCompare(b.path)),
  ]

  const merged = (
    await Promise.all(ordered.map((output) => readFile(output.path, "utf8")))
  )
    .join("\n")
    .replaceAll(assetOrigin, "")
  await writeFile(entryCss.path, optimize(merged, { minify: true }).code)

  for (const output of ordered) {
    if (output.path !== entryCss.path) await rm(output.path, { force: true })
  }
  return entryCss
}

async function writeHtml(
  entry: BuildOutput,
  cssFile: BuildOutput
): Promise<void> {
  const html = await readFile(htmlPath, "utf8")
  const scriptPattern =
    /\s*<script type="module" src="\/src\/main\.tsx"><\/script>/
  if (!scriptPattern.test(html)) {
    throw new Error("index.html is missing the /src/main.tsx module script")
  }

  const script = `<script type="module" crossorigin src="${toUrl(entry.path)}"></script>`
  const stylesheet = `<link rel="stylesheet" crossorigin href="${toUrl(cssFile.path)}">`

  const output = html
    .replace(scriptPattern, "")
    .replace(/\n {2}<\/head>/, `\n    ${stylesheet}\n    ${script}\n  </head>`)

  await writeFile(join(outDir, "index.html"), output)
}

try {
const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir: outDir,
  target: "browser",
  splitting: true,
  minify: true,
  sourcemap: "none",
  publicPath: "/",
  naming: {
    entry: "assets/[name]-[hash].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [tailwindPlugin(), urlPlugin()],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(`[bun build] ${log.level}: ${log.message}`)
  }
  throw new Error("Bun build failed")
}

for (const log of result.logs) {
  console.warn(`[bun build] ${log.level}: ${log.message}`)
}

const entryCss = await mergeCss(result.outputs)
await cp(publicDir, outDir, { recursive: true })

const entry = result.outputs.find((output) => output.kind === "entry-point")
if (!entry) throw new Error("Bun build produced no entry-point JavaScript")
await writeHtml(entry, entryCss)

let hadPrevious = false
try {
  await rename(finalDir, backupDir)
  hadPrevious = true
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
}
try {
  await rename(outDir, finalDir)
} catch (error) {
  if (hadPrevious) await rename(backupDir, finalDir)
  throw error
}
if (hadPrevious) await rm(backupDir, { recursive: true, force: true })

console.log(
  `Bun build wrote ${relative(projectRoot, finalDir)}/ (${result.outputs.length} emitted modules/assets)`
)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
