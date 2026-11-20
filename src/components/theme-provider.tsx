import * as React from "react"
import { ACCENT_KEY, PALETTE_KEY, readAccent, readPalette, type Accent, type Palette } from "@/lib/theme-appearance"

type Theme = "dark" | "light" | "system"
type ResolvedTheme = "dark" | "light"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  palette: Palette
  setPalette: (palette: Palette) => void
  accent: Accent
  setAccent: (accent: Accent) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = ["dark", "light", "system"]

const ThemeProviderContext = React.createContext<
  ThemeProviderState | undefined
>(undefined)

function isTheme(value: string | null): value is Theme {
  if (value === null) {
    return false
  }

  return THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return "dark"
  }

  return "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Blocked or full storage must not crash the app.
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const storedTheme = safeStorageGet(storageKey)
    if (isTheme(storedTheme)) {
      return storedTheme
    }

    return defaultTheme
  })

  const [palette, setPaletteState] = React.useState(() => readPalette(safeStorageGet(PALETTE_KEY)))
  const [accent, setAccentState] = React.useState(() => readAccent(safeStorageGet(ACCENT_KEY)))
  const setPalette = React.useCallback((value: Palette) => {
    safeStorageSet(PALETTE_KEY, value)
    setPaletteState(value)
  }, [])
  const setAccent = React.useCallback((value: Accent) => {
    safeStorageSet(ACCENT_KEY, value)
    setAccentState(value)
  }, [])

  React.useEffect(() => {
    document.documentElement.dataset.palette = palette
    document.documentElement.dataset.accent = accent
  }, [palette, accent])

  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea !== localStorage) return
      } catch {
        return
      }
      if (event.key === PALETTE_KEY || event.key === null) setPaletteState(readPalette(event.newValue))
      if (event.key === ACCENT_KEY || event.key === null) setAccentState(readAccent(event.newValue))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      safeStorageSet(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey]
  )

  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement
      const resolvedTheme =
        nextTheme === "system" ? getSystemTheme() : nextTheme
      const restoreTransitions = disableTransitionOnChange
        ? disableTransitionsTemporarily()
        : null

      root.classList.remove("light", "dark")
      root.classList.add(resolvedTheme)

      const themeColorMeta = document.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"]'
      )
      const color = resolvedTheme === "dark" ? "#1b1b1f" : "#ffffff"
      for (const meta of themeColorMeta) {
        if (!meta.media || nextTheme !== "system") {
          meta.content = color
        }
      }

      if (restoreTransitions) {
        restoreTransitions()
      }
    },
    [disableTransitionOnChange]
  )

  React.useEffect(() => {
    applyTheme(theme)

    if (theme !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme("system")
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme, applyTheme])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      try {
        if (event.storageArea !== localStorage) {
          return
        }
      } catch {
        return
      }

      if (event.key !== storageKey) {
        return
      }

      if (isTheme(event.newValue)) {
        setThemeState(event.newValue)
        return
      }

      setThemeState(defaultTheme)
    }

    window.addEventListener("storage", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const value = React.useMemo(
    () => ({
      theme,
      setTheme,
      palette,
      setPalette,
      accent,
      setAccent,
    }),
    [theme, setTheme, palette, setPalette, accent, setAccent]
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
