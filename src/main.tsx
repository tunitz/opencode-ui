import { Component, StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

// xterm CSS is merged into the entry stylesheet by the build. Importing it
// eagerly avoids a dynamic CSS chunk whose runtime reference is deleted by
// the CSS merge (see scripts/build-bun.ts).
import "@xterm/xterm/css/xterm.css"
import "./index.css"
import App from "./App.tsx"
import { AppDirection } from "@/components/app-direction.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch() {
    // Keep error details in local UI without leaking sensitive state.
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            OpenCode UI encountered an unexpected rendering error. Reload the page to recover.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Reload page
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppDirection>
      <ThemeProvider>
        <RootErrorBoundary>
          <TooltipProvider delay={300}>
            <App />
          </TooltipProvider>
        </RootErrorBoundary>
      </ThemeProvider>
    </AppDirection>
  </StrictMode>
)
