# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Changed

- The Notes & plans sidebar starts collapsed by default.
- Documentation refreshed for the Bun server, current installation options, and the unsupported
  terminal surface. Environment-specific instructions were removed.

## 0.1.0 — 2026-11-09

### Added

- Mobile-first OpenCode V2 web client built with React, TypeScript, and Bun.
- Bun CLI and server for serving the built client and proxying the engine.
- Optional Notes plugin package with project/global spaces, statuses, and RPC tools.
- Synthetic browser regression checks under `tests/browser/`.

### Changed

- Repository layout: all tests live under `tests/`, deep reference docs under `docs/`,
  and historical planning records under `docs/archive/`.
- Default allowlists are loopback-only; non-loopback hosts must be explicit.
- The direct Bun server now serves `dist-bun-build/` by default.
