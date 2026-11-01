import { useLayoutEffect } from "react"

import { appViewportLayout } from "@/lib/viewport"

/**
 * Syncs the visible viewport height AND origin to `--app-viewport-height` /
 * `--app-viewport-top`. The fixed mobile shell follows iOS Safari's keyboard
 * resize and any visual-viewport pan together, so the composer stays at the
 * bottom of the usable viewport. Falls back to dynamic viewport units when the
 * visual viewport is unavailable or pinch-zoomed.
 */
export function useAppViewportHeight(): void {
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return
    }

    const viewport = window.visualViewport

    const apply = () => {
      const layout = appViewportLayout({
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        pageTop: viewport.pageTop,
        scrollY: window.scrollY,
        scale: viewport.scale,
      })
      document.documentElement.style.setProperty(
        "--app-viewport-height",
        layout.height
      )
      document.documentElement.style.setProperty("--app-viewport-top", layout.top)
    }

    apply()
    viewport.addEventListener("resize", apply)
    viewport.addEventListener("scroll", apply)
    window.addEventListener("orientationchange", apply)

    return () => {
      viewport.removeEventListener("resize", apply)
      viewport.removeEventListener("scroll", apply)
      window.removeEventListener("orientationchange", apply)
    }
  }, [])
}
