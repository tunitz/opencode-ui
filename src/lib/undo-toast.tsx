import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { RotateCcwIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

type UndoToast = {
  id: number
  message: string
  undo?: () => void
}

type UndoToastContextValue = {
  showUndo: (message: string, undo?: () => void) => void
}

const UndoToastContext = createContext<UndoToastContextValue>({
  showUndo: () => {},
})

export function useUndoToast(): UndoToastContextValue {
  return useContext(UndoToastContext)
}

/**
 * Honest local-action toasts. Only pass an undo callback for changes this
 * client can actually reverse; completed engine mutations must omit it.
 */
export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<UndoToast | null>(null)
  const nextID = useRef(0)
  const timer = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const showUndo = useCallback(
    (message: string, undo?: () => void) => {
      nextID.current += 1
      clearTimer()
      setToast({ id: nextID.current, message, undo })
      timer.current = window.setTimeout(() => {
        setToast(null)
        timer.current = null
      }, 7000)
    },
    [clearTimer]
  )

  useEffect(() => clearTimer, [clearTimer])

  return (
    <UndoToastContext.Provider value={{ showUndo }}>
      {children}
      {toast ? (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 motion-reduce:transition-none"
        >
          <div className="pointer-events-auto flex min-h-11 max-w-md items-center gap-2 rounded-full border border-border bg-popover px-3 py-1 text-popover-foreground shadow-lg">
            <span className="min-w-0 flex-1 truncate text-[12px]">{toast.message}</span>
            {toast.undo ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 shrink-0 gap-1 px-2 text-[12px]"
                onClick={() => {
                  toast.undo?.()
                  dismiss()
                }}
              >
                <RotateCcwIcon aria-hidden="true" className="size-3.5" />
                Undo
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss"
              className="size-11 shrink-0 rounded-full"
              onClick={dismiss}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </UndoToastContext.Provider>
  )
}
