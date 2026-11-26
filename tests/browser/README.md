# Synthetic browser interaction checks

Durable regression checks for responsive navigation, command center, changes,
and conversation disclosure behavior. They are intentionally synthetic: no
engine, provider, credentials, live session, external network, or repository
state is used.

Conversation checks inject text into the in-memory live-run store, prepend a
synthetic older-history page through the actual load control, and resize a
touch viewport to approximate keyboard-induced height changes. They verify
disclosure state, scroll position, and cancellation by reader wheel input.
Long tool-error coverage checks the mobile sheet, keyboard focus, literal-text
rendering, live updates and row virtualization, rotation, and the unchanged
desktop inline presentation.
These checks do not simulate a real SSE connection or a physical keyboard.

Run:

```bash
bun tests/browser/run.ts
```

The runner bundles the fixture with Bun and the same Tailwind compiler as the
production build, serves it from an ephemeral `127.0.0.1` port, answers a small
set of synthetic same-origin reads and writes (including POST routes for
`/api/ui/notes/*` and `/api/ui/session-shortcuts` alongside GET routes), and drives
the installed Playwright Chromium. Fixture results are written to a fresh directory
under `/tmp/opencode` and the path is printed by the runner; failure screenshots,
when available, go to a matching fresh directory under `/tmp/opencode/shots/`.

## Performance baseline harness

A **separate standalone runner**, `tests/browser/perf.ts` (script
`bun run test:browser:perf`), measures interaction latency under CPU throttling. It reuses this
directory's `buildFixture()` and the same ephemeral
`127.0.0.1` Playwright Chromium machinery, but applies CDP
`Emulation.setCPUThrottlingRate({ rate: 6 })`, collects `longtask` entries via
`PerformanceObserver`, times interactions with `performance.mark/measure` and
an in-page input-to-frame INP proxy, and reads `window.__opencodePerf` counters
plus rendered `data-perf-row` elements.

The large in-memory fixtures are selected by URL query: `perf-models` (2000
models), `perf-agents` (200 agents), `perf-notes` (1000 notes), `perf-worktrees`
(1500 directories), and `perf-messages` (1000 messages through the real
`Conversation`). Picker, NewSession-style row, and Notes row render sites are
instrumented with test-only wrappers in `fixture.tsx`; production components
are not modified. No engine, provider, filesystem, or network is contacted.

Each run writes its measurements to `tests/browser/perf-results.json`, which is
Git-ignored. If a `tests/browser/perf-baseline.json` snapshot is present, the
runner prints a comparison; it never overwrites that file. Each metric carries
its recorded gate and pass flag; gates are informational rather than a pass/fail
criterion for this harness.

RTL is partly covered: some cases set `document.documentElement.dir = "rtl"` and
assert the computed direction plus reversal of UI elements (the inspector drawer
and perf rows). Localized copy and other non-LTR locales are not covered.

Not covered here: real engine/SSE traffic, model calls, PTY/terminal, OS push,
multiple browsers, localized/non-LTR layouts beyond those RTL direction checks,
and pixel-level visual review.
