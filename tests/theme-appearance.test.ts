import { describe, expect, test } from "bun:test"
import { ACCENTS, PALETTES, readAccent, readPalette } from "../src/lib/theme-appearance"

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
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text()
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
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text()
    const surfaces = { light: ["#ffffff", "#f5f5f6"], dark: ["#161619", "#333338"] }
    for (const palette of PALETTES.filter((value) => value !== "default")) {
      for (const scheme of ["light", "dark"] as const) {
        const selector = `:root${scheme === "dark" ? ".dark" : ""}[data-palette="${palette}"]`
        expect(css).toContain(selector)
        const rule = css.slice(css.indexOf(selector) + selector.length).split("}")[0]
        for (const token of ["background", "card", "popover", "sidebar", "sidebar-accent"]) {
          const color = rule.match(new RegExp(`--${token}: (#[0-9a-f]+)`))?.[1]
          expect(color).toBeDefined()
          surfaces[scheme].push(color!)
        }
        const preview = `${scheme === "dark" ? ".dark " : ""}.appearance-preview[data-preview-palette="${palette}"]`
        expect(css).toContain(preview)
      }
    }
    for (const accent of ACCENTS.filter((value) => value !== "default")) {
      for (const scheme of ["light", "dark"] as const) {
        const selector = `:root${scheme === "dark" ? ".dark" : ""}[data-accent="${accent}"]`
        const rule = css.slice(css.indexOf(selector) + selector.length).split("}")[0]
        const primary = rule.match(/--primary: (#[0-9a-f]+)/)?.[1]
        expect(primary).toBeDefined()
        expect(rule).toContain(`--sidebar-primary: ${primary}`)
        expect(rule).toContain(`--ring: ${primary}`)
        expect(css).toContain(`${scheme === "dark" ? ".dark " : ""}.appearance-accent-swatch[data-preview-accent="${accent}"]`)
        for (const surface of surfaces[scheme]) expect(contrast(primary!, surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(css).toContain('.session-nav-item[aria-current="page"]')
  })

  test("accent headings are opt-in and scoped to conversation markdown", async () => {
    const css = await Bun.file(new URL("../src/index.css", import.meta.url)).text()
    const conversation = await Bun.file(new URL("../src/components/conversation.tsx", import.meta.url)).text()
    const markdown = await Bun.file(new URL("../src/components/markdown.tsx", import.meta.url)).text()
    const selector = ':root[data-accent]:not([data-accent="default"]) .message-markdown > .markdown-content :is(h1, h2, h3, h4, h5, h6)'
    expect(css).toContain(`${selector} { color: var(--primary); }`)
    expect(conversation.match(/className="message-markdown /g)).toHaveLength(2)
    expect(markdown).toContain('className="markdown-content ')
  })

  test("preview shows neutral and accent text on the active background", async () => {
    const source = await Bun.file(new URL("../src/components/theme-select.tsx", import.meta.url)).text()
    expect(source).toContain('bg-background p-3 font-mono text-sm leading-6 text-foreground')
    expect(source).toContain('className="font-semibold text-primary">Summary')
    expect(source).toContain('<div>Ready to build.</div>')
  })

  test("desktop and mobile navigation and settings use theme surfaces", async () => {
    const navigation = await Bun.file(new URL("../src/components/session-nav.tsx", import.meta.url)).text()
    const dialog = await Bun.file(new URL("../src/components/ui/dialog.tsx", import.meta.url)).text()
    const sheet = await Bun.file(new URL("../src/components/ui/sheet.tsx", import.meta.url)).text()
    expect(navigation.match(/bg-sidebar(?:\s|")/g)?.length).toBeGreaterThanOrEqual(2)
    expect(dialog).toContain("bg-popover")
    expect(sheet).toContain("bg-popover")
  })
})
