# AGENTS.md — OpenCode UI

## Project

This is a standalone React, TypeScript, Bun, and Tailwind web client for an existing OpenCode V2
engine. The engine is a separate dependency; do not edit or fork its backend as part of this
project. Use Bun for dependency management and scripts; do not use npm, npx, pnpm, or yarn.

Targets are pinned: Bun **1.4.4** and `@opencode/client` **2.1.4**. Broader compatibility is not
established. Do not upgrade either pin without checking the native contracts and tests.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | React application, components, hooks, and browser-local state. |
| `server/` | Bun server, engine proxy, request security, artifacts, notifications, and agent config. |
| `bin/` | `opencode-ui` CLI entry point and option validation. |
| `scripts/` | Bun build and development tooling. |
| `plugins/notes/` | Optional Notes plugin package with its own tests and README. |
| `tests/` | Bun unit/integration tests plus synthetic browser checks. |
| `docs/` | Architecture, native contract, and command coverage. |
| `public/` | Static release assets; keep it free of private data and secrets. |
| `dist-bun-dev/`, `dist-bun-build/` | Generated frontend output; not source. |

## Requirements

- Bun 1.4.4.
- A separately installed and running OpenCode V2 engine compatible with `@opencode/client` 2.1.4.
- An existing engine service-registration JSON with a nonempty `password`, readable by the UI
  server. The server uses Basic username `opencode`.

The UI does not install, start, or reconfigure the engine. Never expose the registration password
to the browser, logs, command-line flags, or version control.

## Local development

```sh
bun install --frozen-lockfile
bun run dev
```

`bun run dev` builds and serves `dist-bun-dev/` on `127.0.0.1:5175` by default, watches `src/`,
`public/`, and `index.html`, and runs the Bun server in watch mode. Set `OPENCODE_UI_PORT` to use a
different port.

For testing from another device, bind explicitly and add the exact reachable host and origin:

```sh
OPENCODE_UI_HOST=<bind-host> \
OPENCODE_UI_PORT=5175 \
OPENCODE_UI_ALLOWED_HOSTS=<reachable-host> \
OPENCODE_UI_ALLOWED_ORIGINS=http://<reachable-host>:5175 \
bun run dev
```

Report the reachable LAN URL, never `0.0.0.0`. Keep development output in `dist-bun-dev/`; do not
overwrite or disturb an existing production `dist-bun-build/`.

### Runtime defaults

| Mode | Entry point | Engine default | Service file | Allowlist environment | Assets |
| --- | --- | --- | --- | --- | --- |
| Dev | `bun run dev` → `server/bun-server.ts` | `http://127.0.0.1:8090` | `~/.config/opencode/service.json` | `OPENCODE_UI_ALLOWED_HOSTS`, `OPENCODE_UI_ALLOWED_ORIGINS` | `dist-bun-dev/` |
| Direct server | `bun run start:bun` / `bun run preview` | `http://127.0.0.1:8090` | `~/.config/opencode/service.json` | Same as dev | `dist-bun-build/`, or `dist-bun-dev/` with `OPENCODE_UI_BUILD_TARGET=dev` |
| CLI / package | `bin/opencode-ui.ts` | `http://127.0.0.1:4096` | `$XDG_CONFIG_HOME/opencode/service.json` or `~/.config/opencode/service.json` | Not read; use `--allowed-host` / `--allowed-origin` | `dist-bun-build/` |

The direct server also keeps the legacy artifact root `/tmp/opencode/shots` when
`OPENCODE_UI_ARTIFACT_ROOTS` is absent. The CLI starts with no artifact roots unless
`--artifact-root` or the environment list is supplied. Use the CLI for the isolated defaults and
explicit service-file and engine selection.

## Verification

Run verification appropriate to the change:

```sh
bun run typecheck
bun run lint
bun test tests --isolate
bun test plugins/notes/test
bun run test:browser   # synthetic; requires the installed Playwright Chromium
bun run build:bun
bun run verify         # typecheck + lint + tests
```

CI runs `bun install --frozen-lockfile`, typecheck, lint, `build:bun`, and the main test suite.
The Notes plugin tests are separate and are not included in `bun run verify`.

- Keep loading, empty, unavailable, and error states honest.
- Real-model tests must use verified free/zero-cost models or explicit zero-cost paths. Never
  silently fall back to paid or unknown models.
- Browser checks are synthetic; they do not prove real engine/SSE, OS push, or terminal behavior.

## Build

```sh
bun run build:bun   # production frontend into dist-bun-build/
bun run build       # tsc -b, then the same frontend build
```

`OPENCODE_UI_BUILD_TARGET=dev` writes `dist-bun-dev/`. The build stages into a temporary directory
and replaces the target atomically, restoring the previous directory if the swap fails. Generated
directories are not source and should not be edited by hand.

## Packaging

`prepack` rebuilds production assets before packing or publishing. To inspect package contents:

```sh
bun pm pack
```

The package name is `@tunitz/opencode-ui`; the unscoped `opencode-ui` package is unrelated. Confirm
package-name ownership and credentials privately, and get explicit authorization before publishing.
Do not publish from a dirty tree or include private files, credentials, or local state.

## Code and UX conventions

- Keep changes scoped and compatible with the pinned OpenCode client and native contracts. Prefer
  structured tool and file state over prose heuristics.
- Use an installed OpenUI component when it fits, then shadcn/Base UI, then custom UI. Check the
  actual component capabilities and restrictions in [docs/components.md](docs/components.md).
- Preserve mobile and desktop accessibility: Light, Dark, and System themes, 44px targets,
  keyboard and focus behavior, RTL, reduced motion, and accessible names.
- Preserve composer behavior: on touch, Enter inserts a newline and only Send submits; on a
  fine-pointer desktop, Enter sends and Shift+Enter inserts a newline. Never submit during IME
  composition. Preserve browser-local drafts and preferences.
- Do not reintroduce removed surfaces or claim unsupported native behavior. `/terminal`, for
  example, is reported as unsupported because no terminal UI is mounted.

## Security and live state

- The UI server holds an engine credential; do not expose it to the browser or logs. Keep secrets,
  subscriptions, capability IDs, transcripts, and private state out of version control.
- Preserve explicit host and Origin checks, WebSocket guards, route/method allowlists, JSON
  mutation checks, no wildcard CORS, and `no-store` API responses. Do not bypass artifact
  provenance or file safety checks. See [docs/contract.md](docs/contract.md) for relevant details.
- There is no separate browser login. Do not represent the UI as safe for public or multi-tenant
  use without an appropriate access boundary and secure transport.
- Ask before mutating live sessions, PTYs, providers, notifications, credentials, engine or agent
  configuration, permission policies, or other live state. Do not stage, commit, or push unless
  requested.

## References

[README.md](README.md) gives the project overview. [docs/components.md](docs/components.md),
[docs/contract.md](docs/contract.md), and [docs/commands.md](docs/commands.md) describe
implementation details and historical decisions; environment-specific examples are not universal
requirements.
