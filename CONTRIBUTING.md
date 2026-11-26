# Contributing to OpenCode UI

Thank you for considering a contribution to OpenCode UI!

## Prerequisites

- [Bun](https://bun.sh/) **1.4.4** (pinned in `package.json`; use Bun rather than `npm`/`pnpm`/`yarn`).
- A running **OpenCode V2 engine** compatible with `@opencode/client` `2.1.4` for end-to-end manual testing.

## Local Setup

```sh
git clone https://github.com/tunitz/opencode-ui.git
cd opencode-ui
bun install --frozen-lockfile
bun run dev
```

## Verification Checklist

Run these checks before opening a pull request:

```sh
mkdir -p /tmp/opencode
bun run verify              # typecheck + eslint + unit/integration tests
bun test plugins/notes/test # standalone Notes core + MCP tests
bun run build:bun           # production frontend bundle
```

For browser UI verification (requires Playwright Chromium):

```sh
bun run test:browser
```

## Branching & Commit Conventions

1. Fork the repository or create a `feature/<name>` branch off `main` (never commit directly to `main`).
2. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) so Release Please can generate accurate changelogs and versions.
3. Keep PRs focused, include tests for behavior changes, and never commit `.env`, state files, screenshots outside `docs/screenshots/`, or real credentials/IPs.

Automated and AI contributors should also follow [AGENTS.md](AGENTS.md).
