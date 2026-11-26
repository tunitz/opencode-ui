import { expect, test } from "bun:test"

// composer.tsx imports the OpenCode client, which reads window.location.origin
// at module load. Provide an origin for the import, then restore the global.
const previousWindow = globalThis.window
globalThis.window = {
  ...(previousWindow ?? {}),
  location: { origin: "http://example.test" },
}
const { canReferenceNotes } = await import("../src/components/composer")
if (previousWindow === undefined) delete globalThis.window
else globalThis.window = previousWindow

test("Reference note is offered while Notes is enabled", () => {
  // The provider passes true for an unknown registry, so the entry stays
  // optimistic and disappears only on a definitive disable.
  expect(canReferenceNotes({ available: true }, true)).toBe(true)
})

test("Reference note is hidden while the Notes plugin is disabled", () => {
  expect(canReferenceNotes({ available: true }, false)).toBe(false)
})

test("Reference note needs a project directory", () => {
  expect(canReferenceNotes({ available: false }, true)).toBe(false)
  expect(canReferenceNotes(null, true)).toBe(false)
  expect(canReferenceNotes(undefined, true)).toBe(false)
})
