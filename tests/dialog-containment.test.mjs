import { expect, test } from "bun:test"

const read = (path) => Bun.file(new URL(path, import.meta.url)).text()

test("base dialog and alert popups stay inside the viewport and scroll", async () => {
  const dialog = await read("../src/components/ui/dialog.tsx")
  const alert = await read("../src/components/ui/alert-dialog.tsx")
  for (const source of [dialog, alert]) {
    expect(source).toContain("max-h-[calc(100dvh-2rem)]")
    expect(source).toContain("overflow-y-auto")
  }
})

test("mobile responsive dialogs let their content shrink and scroll", async () => {
  const source = await read("../src/components/ui/responsive-dialog-content.tsx")
  expect(source).not.toContain("[&>*]:shrink-0")
  expect(source).toContain("overflow-y-auto")
})

test("quoted user text in conversation dialogs wraps", async () => {
  const source = await read("../src/components/conversation.tsx")
  expect(source).toContain("[overflow-wrap:anywhere]")
})
