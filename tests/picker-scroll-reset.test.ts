import { expect, test } from "bun:test"

import { resetPickerScroll } from "../src/components/ui/picker-select"

function scroller(scrollTop: number): HTMLElement {
  return { scrollTop } as HTMLElement
}

test("non-virtualized pickers reset the ComboboxPrimitive.List scroller", () => {
  const list = scroller(240)
  const virtual = scroller(480)

  expect(resetPickerScroll(false, list, virtual)).toBe(true)

  expect(list.scrollTop).toBe(0)
  expect(virtual.scrollTop).toBe(480)
})

test("virtualized pickers reset the nested virtual scroller, not the list", () => {
  const list = scroller(240)
  const virtual = scroller(480)

  expect(resetPickerScroll(true, list, virtual)).toBe(true)

  expect(virtual.scrollTop).toBe(0)
  expect(list.scrollTop).toBe(240)
})

test("missing scroller is reported without throwing", () => {
  expect(resetPickerScroll(false, null, null)).toBe(false)
  expect(resetPickerScroll(true, null, null)).toBe(false)
  expect(resetPickerScroll(true, scroller(120), null)).toBe(false)
})
