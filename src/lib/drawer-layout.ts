import type { CSSProperties } from "react"

/**
 * Scoped geometry for the Settings/Preferences drawer and Session inspector.
 * Both mobile surfaces share this exact height so changing tabs cannot resize
 * the sheet. The visual-viewport variables are maintained by
 * `useAppViewportHeight`; on browsers without them the dynamic-unit fallback
 * still gives the same stable formula.
 */
export const FIXED_MOBILE_DRAWER_HEIGHT =
  "min(calc(var(--app-viewport-height, 100dvh) * 0.88), 46rem)"

/**
 * A moderate desktop Settings height: bounded by the actual viewport, but not
 * stretched into a full-screen dialog on tall displays.
 */
export const FIXED_DESKTOP_SETTINGS_HEIGHT =
  "min(40rem, calc(100dvh - 4rem))"

export function fixedMobileDrawerStyle(): CSSProperties {
  return {
    height: FIXED_MOBILE_DRAWER_HEIGHT,
    maxHeight: "var(--app-viewport-height, 100dvh)",
    bottom:
      "calc(100dvh - var(--app-viewport-top, 0px) - var(--app-viewport-height, 100dvh))",
  }
}

export function fixedDesktopSettingsStyle(): CSSProperties {
  return { height: FIXED_DESKTOP_SETTINGS_HEIGHT }
}
