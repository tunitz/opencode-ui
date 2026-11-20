# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

- `bun run start` as the single start command, with `--host`/`--port`/`--engine-url`/
  `--allowed-host`/`--allowed-origin`/`--artifact-root`/`--help`/`--version` and an automatic first-run
  production build when `dist-bun-build/` is missing.
- First-run UI password setup, sign-in, logout, and password changes in Settings → Access. The
  password is required on every bind, with an HTTP-only 30-day session cookie and server-side
  argon2id/hash-only state.
- With no saved engine, the home screen links to Settings → Connections. The engine password
  is required and verified before saving; service registration files are no longer used.
- Settings workspace with Appearance, Agents, Alerts, Keys, Plugins, and Access sections; Notes and
  Settings are mutually exclusive main panes with Back-to-conversation in the app header.
- Settings → Plugins management of the Notes MCP server, persisting `mcp.servers.notes` in the
  engine's global configuration through an atomic JSONC edit, including Connected / Registered /
  Not registered state and a restart hint.
- Notes HTTP API (`POST /api/ui/notes/<method>`) and `/api/ui/notes/events` change stream, served by
  the UI server.
- Notes package rewritten as a standalone TypeScript core: plaintext file store, atomic writes,
  per-record locks, revision CAS, 50 history snapshots, search, seven statuses, spaces v2, and a
  one-time read-only migration from legacy engine key-value data.
- Notes MCP stdio server with 15 tools, three prompts (`notes:capture`, `notes:daily`,
  `notes:review`), and note/space resources.
- `notes_get` tool and notes method for reading one full note.
- `includeBodies` on the notes list contract; `false` returns empty bodies for cheap browsing.

### Changed

- Notes no longer run as an OpenCode engine plugin; the engine plugin export, engine RPC contract,
  TUI command surface, `/api/rpc/opencode-notes/*`, and `NOTES_RPC_PATHS` are retired.
- Notes spaces use `projectDir` (`null` means Global); the `kind`/`project` vocabulary is removed.
- The Notes sidebar starts collapsed by default.
- Notes follow a `todo` → `in-progress` → `finished` lifecycle, with `finished` only after verified
  work; `idea`, `blocked`, `cancelled`, and `archived` complete the seven-status model.
- Appearance controls moved from the sidebar into Settings → Appearance.

### Fixed

- New-session agent picker stays usable while browsing folders; its catalog is bound to the
  resolved project.
- The context strip opens on click or tap and spans the full width on desktop.
- Settings → Agents ranks starred models first.
- Desktop dialogs are larger, with existing mobile size caps preserved.
- All copy actions use the clipboard fallback on non-secure origins.
- Removed the spurious "Switch notes project?" confirmation; drafts survive project switches through
  the per-directory adapter cache, and native `window.confirm` is no longer used.

## 0.1.0 — 2026-11-09

### Added

- Mobile-first OpenCode V2 web client built with React, TypeScript, and Bun.
- Bun CLI and server for serving the built client and proxying the engine.
- Optional Notes plugin package with project/global spaces, statuses, and RPC tools.
- Synthetic browser regression checks under `tests/browser/`.

### Changed

- Repository layout: all tests live under `tests/` and reference docs under `docs/`.
- Default allowlists are loopback-only; non-loopback hosts must be explicit.
- The direct Bun server now serves `dist-bun-build/` by default.
