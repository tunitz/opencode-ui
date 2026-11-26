import { expect, test } from "bun:test"
import { fileQueryRange, fileReference, referenceRanges, referencedPaths } from "../src/lib/file-references"

test("file references round-trip spaces and quotes as prompt text", () => {
  const paths = ["folder/a file.ts", 'folder/a "quoted" file.ts']
  const text = paths.map(fileReference).join(" and ")
  expect(referencedPaths(text)).toEqual(paths)
  expect(referencedPaths(`${text} ${fileReference(paths[0])} @\"unfinished`)).toEqual(paths)
})

test("completion replaces the entire token and any selected suffix", () => {
  const text = "Use @alpha.ts next"
  for (const [start, end] of [[7, 7], [7, 10], [7, 13]]) {
    const range = fileQueryRange(text, start, end)
    expect(range).not.toBeNull()
    expect(text.slice(0, range.start) + fileReference("src/alpha.ts") + text.slice(range.end)).toBe('Use @"src/alpha.ts" next')
  }
})

test("unsafe or normalization-changing paths are not previewable", () => {
  const paths = ["../secret.txt", "src/../secret.txt", "/secret.txt", "./file.txt", "src//file.txt", "src\\file.txt", "C:\\secret.txt", "file\0.txt"]
  expect(referencedPaths(paths.map(fileReference).join(" "))).toEqual([])
  expect(referencedPaths(fileReference("src/a file.txt"))).toEqual(["src/a file.txt"])
})

test("incomplete or malformed references are not previewable", () => {
  expect(referencedPaths('@"unfinished')).toEqual([])
  expect(referencedPaths('@"bad\\q" @""')).toEqual([])
})

test("reference ranges preserve duplicate positions and escaped paths", () => {
  const token = fileReference('src/a "file".ts')
  const text = `before ${token}\n${token} after @"unfinished`
  expect(referenceRanges(text)).toEqual([
    { path: 'src/a "file".ts', start: 7, end: 7 + token.length },
    { path: 'src/a "file".ts', start: 8 + token.length, end: 8 + 2 * token.length },
  ])
})
