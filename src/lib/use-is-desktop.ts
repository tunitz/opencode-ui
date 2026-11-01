import { useEffect, useState } from "react"

/** Shared 768px desktop breakpoint observer for modal/inspector placement. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(min-width: 768px)").matches
  )

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)")
    const onChange = () => setDesktop(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return desktop
}
