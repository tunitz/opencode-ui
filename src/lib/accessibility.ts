/**
 * Pure accessibility helpers for the conversation and reduced-motion behavior.
 */

/** True when the user has requested reduced motion. */
export function prefersReducedMotion(
  media: { matches: boolean } | null | undefined
): boolean {
  return Boolean(media?.matches)
}

/** Scroll behavior for programmatic scrolling: instant under reduced motion. */
export function scrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth"
}

export type ScrollMetrics = {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

/**
 * Whether there is meaningful content below the viewport. A range of <= 1 CSS
 * px is treated as no scrollable range (sub-pixel rounding), and the distance
 * must exceed `threshold` so a nearly-at-bottom reader does not get a noisy
 * jump affordance. Short conversations and unmeasured empty content are false.
 */
export function hasOffscreenBelow(
  metrics: ScrollMetrics,
  threshold = 48
): boolean {
  const range = metrics.scrollHeight - metrics.clientHeight
  const distanceBelow =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight

  return range > 1 && distanceBelow > threshold
}
