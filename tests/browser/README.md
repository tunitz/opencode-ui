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
production build, serves it from an ephemeral `127.0.0.1` port, answers only a
small set of synthetic same-origin read routes, and drives the installed
Playwright Chromium. Results are written to a fresh fixture directory under
`/tmp/opencode` and the path is printed by the runner; failure screenshots, when available,
go to a matching fresh directory under `/tmp/opencode/shots/`.

Not covered here: real engine/SSE traffic, model calls, PTY/terminal, OS push,
multiple browsers, RTL/localized layouts, and pixel-level visual review.
