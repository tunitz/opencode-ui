import { createRoot } from "react-dom/client"
import { NewSessionButton } from "../../src/components/new-session-dialog"
import { WebUiPreferencesProvider } from "../../src/components/web-ui-preferences-provider"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../../src/components/ui/sheet"
import type { OpenCodeController } from "../../src/lib/use-opencode"

createRoot(document.getElementById("root")!).render(
  <WebUiPreferencesProvider serverVersion={null}>
    <Sheet>
      <SheetTrigger>Open sessions</SheetTrigger>
      <SheetContent showCloseButton={false}>
        <SheetTitle>Sessions</SheetTitle>
        <NewSessionButton nav={{ connection: "connected" } as OpenCodeController} />
      </SheetContent>
    </Sheet>
  </WebUiPreferencesProvider>
)
