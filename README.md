# OpenCode UI

A mobile-first web client for a separately running OpenCode V2 engine. It gives the engine a
browser interface for conversations and prompts while the engine keeps ownership of sessions,
tools, providers, and history.

## Highlights

- Mobile-first conversation, prompt, and session navigation.
- Files, working-tree diffs, permissions, forms, and session settings.
- Structured tool output, artifacts, Markdown, tables, and images.
- Light, Dark, and System themes with keyboard, focus, RTL, and reduced-motion support.
- A Settings workspace for appearance, agents, alerts, keys, plugins, and access.
- Notes workspace backed by a standalone notes store, plus an optional engine MCP server.
- Optional Web Push notifications.
- UI password gate: optional on loopback, required on non-loopback; the engine credential always stays on the UI server.

## Architecture

```text
Browser  <->  OpenCode UI server  <->  OpenCode V2 engine
```

The UI server serves the built frontend, proxies HTTP and event-stream traffic, and injects the
engine credential server-side. It also serves the Notes API and manages the optional Notes MCP
server through the engine's HTTP API. The engine is a separate dependency; this project does not
install, start, or modify it.

## Prerequisites

- Install and start the **OpenCode V2 engine** separately, compatible with the pinned
  `@opencode/client` **2.1.4**. This project does not install or start the engine.
- Create the engine **service-registration JSON** at `~/.config/opencode/service.json` (or the
  path selected with `--service-file`) containing a nonempty string `password`, readable by the
  account running the UI. The server authenticates with Basic username `opencode`.
- [Bun](https://bun.sh/) **1.4.4**. `package.json` declares the exact version; broader
  compatibility is not established.

Keep the registration private. Never print or log its password, pass it on the command line, put it
in a URL, or commit it.

## Quick start from a checkout

```sh
bun install
bun run start
```

Open <http://127.0.0.1:5174> on the same machine. `bun run start` serves the production build from
`dist-bun-build/`, creating it with `scripts/build-bun.ts` on first run when it is missing. On a
loopback bind no sign-in is shown unless a password has already been set; any non-loopback bind
requires a password and shows the first-run setup screen. Set or change it later in
Settings → Access.

With no overrides, the direct server connects to `http://127.0.0.1:8090` and reads
`~/.config/opencode/service.json`. To use a different engine or bind address:

```sh
bun run start --host 0.0.0.0 --port 1234 --engine-url http://127.0.0.1:4096
```

Use `bun run start --help` for the complete flag reference.

## Published package

The scoped package is not currently published. Once `@tunitz/opencode-ui` is available:

```sh
bunx -p @tunitz/opencode-ui opencode-ui --host 127.0.0.1 --port 5174
```

Do not install the unscoped `opencode-ui` package; it belongs to an unrelated project.

## Common options

Both `bun run start` (checkout) and the packaged CLI accept these flags. `bun run start:bun` and
`bun run preview` are aliases of `bun run start`. Flags override environment settings. For example,
`bun run start --host 0.0.0.0 --port 1234` serves the checkout on another interface; add explicit
non-loopback `--allowed-host` and `--allowed-origin` values for that address (see Security boundary).

| Option | Default and behavior |
| --- | --- |
| `--host <host>` | `OPENCODE_UI_HOST`, otherwise `127.0.0.1`. Bind hostname/IP only. |
| `--port <port>` | `OPENCODE_UI_PORT`, otherwise `5174`. Integer from 1 through 65535. |
| `--engine-url <origin>` | `http://127.0.0.1:8090` for `bun run start`; `http://127.0.0.1:4096` for the packaged CLI. |
| `--service-file <path>` | `~/.config/opencode/service.json` for `bun run start`; the CLI additionally honors `$XDG_CONFIG_HOME`. |
| `--allowed-host <host>` | Repeatable additions to loopback hosts. Hostname/IP only. |
| `--allowed-origin <origin>` | Repeatable additions to loopback origins at the UI port. |
| `--artifact-root <path>` | Repeatable artifact roots; replaces `OPENCODE_UI_ARTIFACT_ROOTS` when supplied. `bun run start` otherwise allows `/tmp/opencode/shots`; the CLI allows none. |
| `--help`, `--version` | Show usage or the package version without reading credentials or starting services. |

Long options accept `--name value` or `--name=value`. Flags override applicable environment
settings. Run `bun run start --help` or `bun bin/opencode-ui.ts --help` for the complete reference.

## Configuration

[.env.example](.env.example) lists common environment variables. The main ones are:

- `OPENCODE_UI_HOST`, `OPENCODE_UI_PORT`: UI listener.
- `OPENCODE_UI_ARTIFACT_ROOTS`: comma-separated artifact roots; empty disables delivery.
- `OPENCODE_UI_AUTH_STATE`: overrides the password/session state file, which defaults to
  `~/.local/share/opencode-ui/auth/state.json`.
- `OPENCODE_UI_SESSION_COOKIE`: overrides the session cookie name (default `opencode_ui_session`).
  Set a distinct name for a second UI instance on the same host, since cookies are scoped to a host
  and ignore port numbers.
- `OPENCODE_NOTES_DATA_DIR`: overrides the Notes data directory, which defaults to
  `$XDG_DATA_HOME/opencode-notes/v1` or `~/.local/share/opencode-notes/v1`.
- `OPENCODE_UI_NOTIFICATION_STATE`: private notification state; defaults to
  `~/.local/state/opencode-ui/notifications/state.json`.
- `OPENCODE_UI_VAPID_SUBJECT`: Web Push contact URI; set an appropriate contact for your use.
- `OPENCODE_CONFIG_DIR`: local agent configuration directory. This does not select the CLI service
  file.

Drafts and preferences live in browser-local storage scoped to the origin. Changing the URL creates
a separate storage scope, and preferences are not shared across devices.

## Security boundary

The UI has a single access password. On a loopback bind it is optional; on any non-loopback bind it
is required, and the first visit prompts for setup. Sessions use an HTTP-only, SameSite=Lax cookie
valid for 30 days; the server stores an argon2id password hash and SHA-256 session-token hashes
under `~/.local/share/opencode-ui/auth/`, and no password or token is placed in `localStorage` or
`sessionStorage`. Anyone with the password can exercise the permissions of the engine credential.

`bun run start` binds to loopback by default. A non-loopback bind requires a UI password and should
add an explicit non-loopback `--allowed-host` and an explicit non-loopback `--allowed-origin`, plus
secure transport such as HTTPS. Allowlists are not authentication or multi-tenant isolation. Protect
the engine endpoint separately, and do not disable the UI's Host, Origin, WebSocket, route, method,
JSON-mutation, artifact-provenance, or `no-store` protections.

## Notes

Notes are built in and do not depend on an engine plugin. The
[notes package](plugins/notes/README.md) (`@tunitz/opencode-notes`) is a standalone TypeScript core
with a plaintext file store. The UI server imports it in-process for the notes workspace and
`/api/ui/notes/*`; agents use it through an optional MCP stdio server.

**Enable agent tools** in Settings → Plugins. That registers
`plugins/notes/src/mcp/main.ts` as a local MCP server through the engine HTTP API and removes it
again; it never writes engine configuration files. The engine may need a restart before the tools
appear, and the section reports that state. If you previously installed the notes engine plugin or
its `~/.config/opencode/plugins/...` symlink, remove it before enabling Notes here.

The MCP server exposes 15 tools (`notes_list`, `notes_get`, `notes_create`, `notes_update`,
`notes_delete`, `notes_search`, `notes_history`, `notes_restore`, `notes_spaces`,
`notes_create_space`, `notes_update_space`, `notes_delete_space`, `notes_attachment_create`,
`notes_attachment_read`, `notes_attachment_delete`), three
prompts (`notes:capture`, `notes:daily`, `notes:review`), and note/space resources. The
[notes package README](plugins/notes/README.md) lists arguments and behavior.

Data lives under `$XDG_DATA_HOME/opencode-notes/v1` (or `~/.local/share/opencode-notes/v1`),
overridden by `OPENCODE_NOTES_DATA_DIR`. On first use the service imports legacy notes from the
engine SQLite `kv` table read-only, once, without overwriting existing records;
`OPENCODE_ENGINE_DB_PATH` selects a non-default database. Writes are atomic JSON with per-record
locks, revision compare-and-set, and 50 history snapshots per note.

Notes use seven statuses grouped Backlog (`idea`, `todo`), Active (`in-progress`, `blocked`), and
Done (`finished`, `cancelled`, `archived`). New notes start as `todo`; mark `finished` only after
verification, with the evidence appended. Spaces are Global (`projectDir: null`, visible in every
project) or bound to a project directory. Attachments are limited to 4 files per note, 4 MiB per
file, and 8 MiB per note; SVG, HTML, and JavaScript types are rejected.

The workspace opens from the sidebar. Notes show a read-only Markdown preview with explicit editing;
bodies can reference project-relative files, and the composer can attach a note as Markdown with its
attachment manifest. Notes, spaces, and attachments are plaintext on disk, not encrypted and not
multi-user isolated. Do not store secrets in notes.

## Documentation

- [AGENTS.md](AGENTS.md): development setup, repository map, verification, and conventions.
- [docs/components.md](docs/components.md): component architecture and current surface coverage.
- [docs/contract.md](docs/contract.md): native OpenCode contract and app-layer security rules.
- [docs/commands.md](docs/commands.md): slash-command coverage and native command behavior.
- [tests/browser/README.md](tests/browser/README.md): synthetic browser checks.
- [CHANGELOG.md](CHANGELOG.md): notable changes.

## Status and limitations

- The project is pre-1.0; interfaces and behavior may change.
- The terminal surface is not shipped. `/terminal` is reported as unsupported rather than faked.
- Notifications are best-effort and depend on browser and OS push delivery.
- The UI password is one shared access password; it is not multi-tenant isolation.
- Package publication and registry installation are not verified.

## License

[MIT](LICENSE)
