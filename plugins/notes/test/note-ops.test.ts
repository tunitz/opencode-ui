import { describe, expect, test } from "bun:test"
import {
  filterNoteTexts,
  searchNoteTexts,
  validatedBase64ByteLength,
} from "../src/note-ops.js"
import { LIMITS } from "../src/types.js"

describe("note-ops hot loops", () => {
  test("validates standard padded base64 and computes exact decoded byte lengths", () => {
    expect(validatedBase64ByteLength("")).toBe(0)
    expect(validatedBase64ByteLength("AAAA")).toBe(3)
    expect(validatedBase64ByteLength("AAA=")).toBe(2)
    expect(validatedBase64ByteLength("AA==")).toBe(1)
    expect(validatedBase64ByteLength(btoa("hello attachment"))).toBe(16)

    for (const bad of ["====", "A===", "AA=A", "abc", "aGVs bG8=", "not base64!", "café"]) {
      expect(validatedBase64ByteLength(bad)).toBe(-1)
    }

    const maxValid = Buffer.alloc(LIMITS.attachmentFileSize, 0x41).toString("base64")
    expect(validatedBase64ByteLength(maxValid)).toBe(LIMITS.attachmentFileSize)
    expect(validatedBase64ByteLength(`${maxValid.slice(0, -4)}A!==`)).toBe(-1)
  })

  test("scores notes and builds UTF-16 snippets with exact JS whitespace semantics", () => {
    const emojiPad = "😀".repeat(40)
    const titles = [
      "Deploy checklist",
      "Random",
      "Emoji boundary",
      "BOM\uFEFFSpace",
    ]
    const bodies = [
      "unrelated words",
      "The deploy is ready.\n\t  deploy   deploy deploy deploy deploy deploy",
      `${emojiPad}XNEEDLEY${emojiPad}`,
      "a\u0085b needle c\uFEFF\u3000d",
    ]

    const deployHits = searchNoteTexts(titles, bodies, "  DEPLOY  ")
    expect(deployHits).toHaveLength(2)
    expect(deployHits[0]).toEqual({ index: 0, score: 100, snippet: "" })
    expect(deployHits[1]?.index).toBe(1)
    expect(deployHits[1]?.score).toBe(50)
    expect(deployHits[1]?.snippet).toContain("The deploy is ready. deploy deploy")

    const needleHits = searchNoteTexts(titles, bodies, "needle")
    expect(needleHits.map((hit) => hit.index)).toEqual([2, 3])
    expect(needleHits[0]?.snippet.startsWith("…")).toBe(true)
    expect(needleHits[0]?.snippet.endsWith("…")).toBe(true)
    expect(needleHits[1]?.snippet).toBe("a\u0085b needle c d")

    expect(searchNoteTexts(titles, bodies, "   \t\n  ")).toEqual([])
    expect(searchNoteTexts(["A", "B"], ["only one"], "a")).toEqual([
      { index: 0, score: 100, snippet: "" },
    ])
  })

  test("filters notes across title, body, and newline boundary including parallel batches", () => {
    expect(
      filterNoteTexts(["Alpha", "Beta"], ["body one", "other"], "alpha\nbody")
    ).toEqual([0])
    expect(
      filterNoteTexts(["Alpha", "Beta"], ["\u0085body", "\uFEFFbody"], "\u0085")
    ).toEqual([0])
    expect(filterNoteTexts(["Alpha", "Beta"], ["one", "two"], "   ")).toEqual([0, 1])
    expect(filterNoteTexts(["A", "B", "C"], ["only one"], "a")).toEqual([0])

    // Large batch exercises the Rayon parallel execution threshold (>=64 notes, >=256 KiB).
    const chunk = "Architecture notes   with   whitespace\n\tand details. ".repeat(100)
    const titles = Array.from({ length: 80 }, (_, index) =>
      index % 20 === 0 ? `Target Title ${index}` : `Note ${index}`
    )
    const bodies = Array.from({ length: 80 }, (_, index) =>
      index % 10 === 0 ? `${chunk} special target needle ${chunk}` : chunk
    )

    const hits = searchNoteTexts(titles, bodies, "target needle")
    expect(hits.map((hit) => hit.index)).toEqual([0, 10, 20, 30, 40, 50, 60, 70])
    expect(hits.every((hit) => hit.score === 10)).toBe(true)

    const filtered = filterNoteTexts(titles, bodies, "target needle")
    expect(filtered).toEqual([0, 10, 20, 30, 40, 50, 60, 70])
  })
})
