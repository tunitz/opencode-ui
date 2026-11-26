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
- Agent, model, and variant choices for New Session and the composer now come from the engine API
  at the destination/session location; there is no local agent catalog.

### Removed

- Settings → Agents and the `/api/ui/agents` / `/api/ui/agents/default` file-editor endpoints. The
  `/agents` slash command still opens the current-session agent picker. `OPENCODE_CONFIG_DIR`
  remains in use for the Notes MCP registration.

### Fixed

- New-session agent picker stays usable while browsing folders; its catalog is bound to the
  resolved project.
- The context strip opens on click or tap and spans the full width on desktop.
- Settings → Agents ranks starred models first.
- Desktop dialogs are larger, with existing mobile size caps preserved.
- All copy actions use the clipboard fallback on non-secure origins.
- Removed the spurious "Switch notes project?" confirmation; drafts survive project switches through
  the per-directory adapter cache, and native `window.confirm` is no longer used.

## [0.1.1](https://github.com/tunitz/opencode-ui/compare/v0.1.0...v0.1.1) (2026-11-26)


### Features

* complete browser slash command parity ([a177b10](https://github.com/tunitz/opencode-ui/commit/a177b109fba5aa16988849b53a83e43ce11664ec))
* **docker:** add Alpine Docker deployment, GHCR CI, and Release Please ([16625f2](https://github.com/tunitz/opencode-ui/commit/16625f2dfc27090dd5ccd7c24fd2dad4d7a9ecd3))
* **docker:** add Alpine Docker deployment, GHCR CI, and Release Please ([e5fee20](https://github.com/tunitz/opencode-ui/commit/e5fee2058d5bd60c67795bb1104ed1748ba44054))
* full UI/UX and security audit fixes plus configurable engine connections ([cf4d4b4](https://github.com/tunitz/opencode-ui/commit/cf4d4b49fee58f998e2176b0b354812f6303aa94))
* render HealthVault tool results as cards and tables ([f056ccb](https://github.com/tunitz/opencode-ui/commit/f056ccbcd81a658feb2be175393b9c52b18aab0d))


### Bug Fixes

* add clipboard fallback for code block copy button ([4549857](https://github.com/tunitz/opencode-ui/commit/4549857d36f7147699defde797ec5432100daa4a))
* **ci:** create /tmp/opencode before running tests ([f1c0696](https://github.com/tunitz/opencode-ui/commit/f1c0696d7d12924a1329a9e1ccfe222dcaf6c564))
* enlarge desktop dialogs and repair copy actions ([4039f6f](https://github.com/tunitz/opencode-ui/commit/4039f6f624b3d95d0709edeb835835005586646f))
* keep long question text inside the pending requests dialog ([b57f1a2](https://github.com/tunitz/opencode-ui/commit/b57f1a2c72c94323c4a577d30fcb9f02bd414a29))
* open pickers at top and align agents model picker ([7d1af35](https://github.com/tunitz/opencode-ui/commit/7d1af35ed183f5c500c249bf438bd33069c1489e))
* repair new-session picker, context strip, and model favorites ([92997bc](https://github.com/tunitz/opencode-ui/commit/92997bc715656975192786b37643a07f0299f0c7))


### Performance Improvements

* full low-end-device performance pass ([7ea9c5a](https://github.com/tunitz/opencode-ui/commit/7ea9c5aac2fd326457a9c055d66240b4e691760f))

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
