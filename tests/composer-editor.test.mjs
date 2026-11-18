import { expect, test } from "bun:test"
import {
  insertReferenceToken,
  insertTextAtSelection,
} from "../src/lib/composer-state"
import { fileReference, referenceRanges } from "../src/lib/file-references"

test("plain-text references preserve exact raw tokens, text and newlines", () => {
  const text = 'hello\n@"src/a\\u0020b.ts" and @"../unsafe" @"unterminated'
  const ranges = referenceRanges(text)
  expect(text.slice(ranges[0].start, ranges[0].end)).toBe('@"src/a\\u0020b.ts"')
  expect(ranges[0].path).toBe("src/a b.ts")
  expect(text).toContain("\n")
  expect(text).toContain('@"../unsafe"')
  expect(text).toContain('@"unterminated')
  expect(fileReference("src/a b.ts")).toBe('@"src/a b.ts"')
})

test("plain text insertion preserves CRLF, whitespace and reference bytes", () => {
  const pasted = '  first\r\n@"src/a\\u0020b.ts"\r\nlast  '
  const { value, caret } = insertTextAtSelection("before after", pasted, 7, 7)
  expect(value).toBe(`before ${pasted}after`)
  expect(caret).toBe(7 + pasted.length)
  expect(referenceRanges(value)).toHaveLength(1)
})

test("duplicate references stay distinct plain-text tokens", () => {
  const text = '@"src/a.ts" @"src/a.ts"'
  const ranges = referenceRanges(text)
  expect(ranges).toHaveLength(2)
  expect(ranges[0].start).not.toBe(ranges[1].start)
  expect(ranges.map((range) => range.path)).toEqual(["src/a.ts", "src/a.ts"])
})

test("editing a reference between text stays editable and new references parse", () => {
  const original = 'Read @"src/alpha.ts" please'
  const range = referenceRanges(original)[0]
  const edited =
    original.slice(0, range.start) +
    `note ${original.slice(range.start, range.end)}` +
    original.slice(range.end)
  expect(edited).toBe('Read note @"src/alpha.ts" please')
  expect(referenceRanges(edited)).toHaveLength(1)

  const withNew = insertTextAtSelection(edited, ' @"src/new.ts"', edited.length, edited.length)
  expect(withNew.value).toBe('Read note @"src/alpha.ts" please @"src/new.ts"')
  expect(referenceRanges(withNew.value).map((item) => item.path)).toEqual([
    "src/alpha.ts",
    "src/new.ts",
  ])
})

test("reference insertion adds only the needed spacing and places the caret after the token", () => {
  const { value, caret } = insertReferenceToken("Read this", "src/a.ts", 5, 5)
  expect(value).toBe(`Read ${fileReference("src/a.ts")} this`)
  expect(caret).toBe(`Read ${fileReference("src/a.ts")} `.length)
})
