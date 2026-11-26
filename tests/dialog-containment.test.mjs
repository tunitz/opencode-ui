import { expect, test } from "bun:test"
import { cn } from "cn"

const read = (path) => Bun.file(new URL(path, import.meta.url)).text()
// Pull the actual base class string out of the component so these assertions
// track the real styling contract instead of a copy of it.
const baseClass = (source, slot) =>
  source.match(new RegExp(`data-slot="${slot}"[\\s\\S]*?cn\\(\\s*"([^"]+)"`))?.[1] ?? ""

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

test("base dialog is roomy on desktop but capped on small viewports", async () => {
  const source = await read("../src/components/ui/dialog.tsx")
  expect(source).toContain("sm:max-w-3xl")
  expect(source).not.toContain("sm:max-w-sm")
  expect(source).toContain("max-w-[calc(100%-2rem)]")
  expect(source).toContain("w-full")

  const base = baseClass(source, "dialog-content")
  // With no per-dialog override, the desktop default is roomy and the mobile
  // gutter is preserved.
  expect(cn(base)).toContain("sm:max-w-3xl")
  expect(cn(base)).toContain("max-w-[calc(100%-2rem)]")

  // An unprefixed override (e.g. "Edit from here" / citation max-w-lg) must not
  // shrink the dialog on desktop: the sm: variant still wins at >=640px.
  const unprefixed = cn(base, "max-w-lg")
  expect(unprefixed).toContain("sm:max-w-3xl")
  expect(unprefixed).not.toContain("sm:max-w-sm")

  // Responsive per-dialog overrides still win through cn merge.
  const responsive = cn(base, "sm:max-w-lg md:max-w-2xl")
  expect(responsive).toContain("sm:max-w-lg")
  expect(responsive).not.toContain("sm:max-w-3xl")

  // The explicit max-w-none opt-out (command/connect/btw dialogs) is untouched.
  expect(cn(base, "w-[min(44rem,92vw)] sm:max-w-none")).toContain("sm:max-w-none")
})

test("alert dialog default grows modestly while small confirmations stay small", async () => {
  const source = await read("../src/components/ui/alert-dialog.tsx")
  expect(source).toContain("data-[size=default]:sm:max-w-md")
  expect(source).not.toContain("data-[size=default]:sm:max-w-sm")
  expect(source).toContain("data-[size=sm]:max-w-xs")
  expect(source).toContain("max-h-[calc(100dvh-2rem)]")
  expect(source).toContain("overflow-y-auto")

  const base = baseClass(source, "alert-dialog-content")
  expect(cn(base)).toContain("data-[size=default]:sm:max-w-md")
  expect(cn(base)).toContain("data-[size=sm]:max-w-xs")
})
