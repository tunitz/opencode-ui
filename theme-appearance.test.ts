import { describe, expect, test } from "bun:test"
import { ACCENTS, PALETTES, readAccent, readPalette } from "./src/lib/theme-appearance"

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex
    const channels = [1, 3, 5].map((index) => {
      const value = parseInt(full.slice(index, index + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe("appearance preferences", () => {
  test("accepts curated values and falls back for missing or invalid storage", () => {
    for (const value of PALETTES) expect(readPalette(value)).toBe(value)
    for (const value of ACCENTS) expect(readAccent(value)).toBe(value)
    expect(readPalette(null)).toBe("default")
    expect(readPalette("unknown")).toBe("default")
    expect(readAccent(null)).toBe("default")
    expect(readAccent("unknown")).toBe("default")
  })

  test("each accent has readable primary text in both schemes", async () => {
    const css = await Bun.file(new URL("./src/index.css", import.meta.url)).text()
    for (const accent of ACCENTS.filter((value) => value !== "default")) {
      for (const dark of [false, true]) {
        const selector = `:root${dark ? ".dark" : ""}[data-accent="${accent}"]`
        const rule = css.slice(css.indexOf(selector) + selector.length).split("}")[0]
        expect(css.includes(selector)).toBe(true)
        const primary = rule.match(/--primary: (#[0-9a-f]+)/)?.[1]
        const foreground = rule.match(/--primary-foreground: (#[0-9a-f]+)/)?.[1]
        expect(primary).toBeDefined()
        expect(foreground).toBeDefined()
        expect(contrast(primary!, foreground!)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test("accent text stays readable on palette and selected-session surfaces", async () => {
    const css = await Bun.file(new URL("./src/index.css", import.meta.url)).text()
    const surfaces = {
      light: ["#ffffff", "#f6f9fc", "#fcfaf6", "#dce8f2", "#eae3d7"],
      dark: ["#161619", "#141d28", "#211d19", "#293b4d", "#403830", "#283c4e", "#3c332b"],
    }
    for (const accent of ACCENTS.filter((value) => value !== "default")) {
      for (const scheme of ["light", "dark"] as const) {
        const selector = `:root${scheme === "dark" ? ".dark" : ""}[data-accent="${accent}"]`
        const rule = css.slice(css.indexOf(selector) + selector.length).split("}")[0]
        const primary = rule.match(/--primary: (#[0-9a-f]+)/)?.[1]
        expect(primary).toBeDefined()
        for (const surface of surfaces[scheme]) expect(contrast(primary!, surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(css).toContain('.session-nav-item[aria-current="page"]')
  })

  test("accent headings are opt-in and scoped to conversation markdown", async () => {
    const css = await Bun.file(new URL("./src/index.css", import.meta.url)).text()
    const conversation = await Bun.file(new URL("./src/components/conversation.tsx", import.meta.url)).text()
    const markdown = await Bun.file(new URL("./src/components/markdown.tsx", import.meta.url)).text()
    const selector = ':root[data-accent]:not([data-accent="default"]) .message-markdown > .markdown-content :is(h1, h2, h3, h4, h5, h6)'
    expect(css).toContain(`${selector} { color: var(--primary); }`)
    expect(conversation.match(/className="message-markdown /g)).toHaveLength(2)
    expect(markdown).toContain('className="markdown-content ')
  })

  test("preview shows neutral and accent text on the active background", async () => {
    const source = await Bun.file(new URL("./src/components/theme-select.tsx", import.meta.url)).text()
    expect(source).toContain('bg-background p-3 font-mono text-sm leading-6 text-foreground')
    expect(source).toContain('className="font-semibold text-primary">Summary')
    expect(source).toContain('<div>Ready to build.</div>')
  })
})
