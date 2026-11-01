import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { DirectionProvider } from "@base-ui/react/direction-provider"

type Direction = "ltr" | "rtl"

const DirectionContext = createContext<Direction>("ltr")

function readDirection(): Direction {
  if (typeof document === "undefined") {
    return "ltr"
  }

  return document.documentElement.getAttribute("dir") === "rtl"
    ? "rtl"
    : "ltr"
}

/**
 * Keeps Base UI's anchored surfaces (menus, popovers, tooltips) aligned with
 * the document direction, which logical CSS alone cannot tell it about.
 * Observing the `dir` attribute also supports runtime direction changes.
 */
export function AppDirection({ children }: { children: ReactNode }) {
  const [direction, setDirection] = useState<Direction>(readDirection)

  useEffect(() => {
    const apply = () => setDirection(readDirection())
    apply()

    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir"],
    })

    return () => observer.disconnect()
  }, [])

  return (
    <DirectionContext.Provider value={direction}>
      <DirectionProvider direction={direction}>{children}</DirectionProvider>
    </DirectionContext.Provider>
  )
}

export function useAppDirection(): Direction {
  return useContext(DirectionContext)
}
