/**
 * Viewport sizing for mobile Safari chrome/keyboard. The layout uses dynamic
 * viewport units with a progressive fallback; on browsers where the virtual
 * keyboard overlays the layout viewport (iOS Safari), `visualViewport.height`
 * is the visible height AND `visualViewport.offsetTop` is the visible origin
 * relative to the layout viewport. Both must be applied together, otherwise a
 * panned/offset visual viewport leaves the composer above the keyboard.
 */

export type VisualViewportMetrics = {
  height: number | null | undefined
  offsetTop?: number | null
  pageTop?: number | null
  scrollY?: number | null
  scale?: number | null
}

export type AppViewportLayout = {
  height: string
  top: string
  usesVisualViewport: boolean
}

const MAX_VISUAL_SCALE = 1.01

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

/**
 * CSS height/top for the fixed mobile app shell.
 *
 * `top` is visualViewport.offsetTop (layout-viewport coordinates for a fixed
 * element). `pageTop`/`scrollY` are accepted for diagnostics/tests but are not
 * subtracted again: a fixed shell is already positioned in the layout viewport,
 * so adding document scroll would double-compensate. Pinch zoom (scale > 1) is
 * not treated as a keyboard; the dynamic-viewport fallback is used instead.
 */
export function appViewportLayout(
  metrics: VisualViewportMetrics
): AppViewportLayout {
  const scale = metrics.scale ?? 1
  const height = metrics.height

  if (
    !finite(height) ||
    height <= 0 ||
    !finite(scale) ||
    scale > MAX_VISUAL_SCALE
  ) {
    return { height: "100dvh", top: "0px", usesVisualViewport: false }
  }

  const offsetTop = finite(metrics.offsetTop) ? metrics.offsetTop : 0

  return {
    height: `${Math.round(height)}px`,
    top: `${Math.max(0, Math.round(offsetTop))}px`,
    usesVisualViewport: true,
  }
}
