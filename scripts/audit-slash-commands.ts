/**
 * Compare the browser's built-in slash registry with upstream OpenCode TUI
 * command registrations for selected V2 releases.
 *
 * This is a release-gate helper, not runtime code. It intentionally inspects
 * source definitions because OpenCode V2 does not expose built-in TUI actions
 * through GET /api/command. Server-registered commands are discovered live and
 * need no source change.
 */

const DEFAULT_REFS = ["v2.1.4", "v2.3.2"] as const

/** Browser-impossible or user-excluded commands. */
const SKIP_NAMES = new Set(["editor", "update", "restart", "exit"])
const SKIP_ALIASES = new Set(["quit", "q"])

export type LocalRegistry = {
  names: Set<string>
  aliases: Set<string>
}

export type UpstreamRegistry = {
  names: Set<string>
  aliases: Set<string>
}

export type AuditResult = {
  ref: string
  upstreamNames: string[]
  upstreamAliases: string[]
  missingNames: string[]
  missingAliases: string[]
  extraNames: string[]
  extraAliases: string[]
  ok: boolean
}

const ALIAS_BLOCK = /\baliases\s*:\s*\[([\s\S]*?)\]/g
const ALIAS_BLOCK_ONCE = /\baliases\s*:\s*\[([\s\S]*?)\]/

function quotedValues(text: string): string[] {
  return [...text.matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
}

export function parseLocalRegistry(source: string): LocalRegistry {
  const start = source.indexOf("export const NATIVE_SLASH_COMMANDS")
  if (start < 0) throw new Error("NATIVE_SLASH_COMMANDS not found")
  const end = source.indexOf("\n]", start)
  if (end < 0) throw new Error("NATIVE_SLASH_COMMANDS terminator not found")
  const block = source.slice(start, end)
  const names = new Set<string>()
  const aliases = new Set<string>()

  for (const match of block.matchAll(/\bname\s*:\s*["']([^"']+)["']/g)) {
    names.add(match[1])
  }
  for (const match of block.matchAll(ALIAS_BLOCK)) {
    for (const alias of quotedValues(match[1])) aliases.add(alias)
  }

  return { names, aliases }
}

export function parseSlashDefinitions(source: string): UpstreamRegistry {
  const names = new Set<string>()
  const aliases = new Set<string>()
  const slashBlock = /\bslash\s*:\s*\{([\s\S]*?)\}/g

  for (const match of source.matchAll(slashBlock)) {
    const body = match[1]
    const name = /\bname\s*:\s*["']([^"']+)["']/.exec(body)?.[1]
    if (!name) continue
    names.add(name)
    const aliasBlock = ALIAS_BLOCK_ONCE.exec(body)?.[1]
    if (aliasBlock) {
      for (const alias of quotedValues(aliasBlock)) aliases.add(alias)
    }
  }

  return { names, aliases }
}

export function compareRegistries(
  local: LocalRegistry,
  upstream: UpstreamRegistry,
  ref: string
): AuditResult {
  const upstreamNames = [...upstream.names].filter((name) => !SKIP_NAMES.has(name)).sort()
  const upstreamAliases = [...upstream.aliases].filter((alias) => !SKIP_ALIASES.has(alias)).sort()
  const localNames = [...local.names].filter((name) => !SKIP_NAMES.has(name))
  const localAliases = [...local.aliases].filter((alias) => !SKIP_ALIASES.has(alias))

  const missingNames = upstreamNames.filter((name) => !local.names.has(name))
  const missingAliases = upstreamAliases.filter((alias) => !local.aliases.has(alias))
  const extraNames = localNames.filter((name) => !upstream.names.has(name))
  const extraAliases = localAliases.filter((alias) => !upstream.aliases.has(alias))

  // Forward-compatible registry entries (for example /usage on a 2.1.4
  // engine) are reported but do not fail the gate. The gate fails only when an
  // upstream command or alias is missing from the browser registry.
  return {
    ref,
    upstreamNames,
    upstreamAliases,
    missingNames,
    missingAliases,
    extraNames,
    extraAliases,
    ok: missingNames.length === 0 && missingAliases.length === 0,
  }
}

function shouldInspect(path: string): boolean {
  return (
    path.startsWith("packages/tui/src/") &&
    /\.[cm]?[tj]sx?$/.test(path) &&
    !/(^|\/)(test|tests|__tests__|node_modules)(\/|$)/.test(path)
  )
}

async function fetchUpstream(ref: string): Promise<UpstreamRegistry> {
  const treeResponse = await fetch(
    `https://api.github.com/repos/anomalyco/opencode/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: { accept: "application/vnd.github+json" } }
  )
  if (!treeResponse.ok) {
    throw new Error(`failed to list ${ref}: HTTP ${treeResponse.status}`)
  }
  const tree = (await treeResponse.json()) as {
    tree?: Array<{ path?: string; type?: string }>
  }
  const files = (tree.tree ?? [])
    .map((entry) => entry.path ?? "")
    .filter(shouldInspect)

  const registries = await Promise.all(
    files.map(async (path) => {
      const response = await fetch(
        `https://raw.githubusercontent.com/anomalyco/opencode/${encodeURIComponent(ref)}/${path}`
      )
      if (!response.ok) return null
      return parseSlashDefinitions(await response.text())
    })
  )

  const merged: UpstreamRegistry = { names: new Set(), aliases: new Set() }
  for (const registry of registries) {
    if (!registry) continue
    for (const name of registry.names) merged.names.add(name)
    for (const alias of registry.aliases) merged.aliases.add(alias)
  }
  return merged
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const refsArg = args.find((arg) => arg.startsWith("--refs="))?.slice(7)
  const refs = refsArg ? refsArg.split(",").filter(Boolean) : [...DEFAULT_REFS]
  const json = args.includes("--json")
  const localSource = await Bun.file(new URL("../src/lib/commands.ts", import.meta.url)).text()
  const local = parseLocalRegistry(localSource)

  const results: AuditResult[] = []
  for (const ref of refs) {
    results.push(compareRegistries(local, await fetchUpstream(ref), ref))
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const result of results) {
      console.log(
        `${result.ref}: ${result.upstreamNames.length} names, ${result.upstreamAliases.length} aliases, ${result.ok ? "OK" : "MISMATCH"}`
      )
      if (!result.ok) {
        for (const name of result.missingNames) console.log(`  missing name: /${name}`)
        for (const alias of result.missingAliases) console.log(`  missing alias: /${alias}`)
        for (const name of result.extraNames) console.log(`  forward-compatible name: /${name}`)
        for (const alias of result.extraAliases) console.log(`  forward-compatible alias: /${alias}`)
      }
    }
  }

  if (results.some((result) => !result.ok)) process.exitCode = 1
}

if (import.meta.main) {
  await main()
}
