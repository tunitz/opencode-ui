import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { AppDirection } from "@/components/app-direction.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppDirection>
      <ThemeProvider>
        <TooltipProvider delay={300}>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </AppDirection>
  </StrictMode>
)
