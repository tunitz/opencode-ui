export const PALETTES = ["default", "slate", "sand", "forest", "plum", "ocean"] as const
export const ACCENTS = ["default", "blue", "violet", "green", "teal", "rose", "amber"] as const
export type Palette = (typeof PALETTES)[number]
export type Accent = (typeof ACCENTS)[number]

export const PALETTE_KEY = "opencode-ui:palette"
export const ACCENT_KEY = "opencode-ui:accent"

export function readPalette(value: string | null): Palette {
  return PALETTES.includes(value as Palette) ? (value as Palette) : "default"
}

export function readAccent(value: string | null): Accent {
  return ACCENTS.includes(value as Accent) ? (value as Accent) : "default"
}
