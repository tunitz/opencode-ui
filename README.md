# OpenCode UI

A mobile-first web client for a separately running OpenCode V2 engine. It gives the engine a
browser interface for conversations and prompts while the engine keeps ownership of sessions,
tools, providers, and history.

## Highlights

- Mobile-first conversation, prompt, and session navigation.
- Files, working-tree diffs, permissions, forms, and session settings.
- Structured tool output, artifacts, Markdown, tables, and images.
- Light, Dark, and System themes with keyboard, focus, RTL, and reduced-motion support.
- A Settings workspace for appearance, agents, alerts, plugins, engine connections, and access.
- Notes workspace backed by a standalone notes store, plus an optional engine MCP server.
- Optional Web Push notifications.
- First-run UI password setup; any saved engine credential stays on the UI server.

## Architecture

```text
Browser  <->  OpenCode UI server  <->  OpenCode V2 engine
```

The UI server serves the built frontend, proxies HTTP and event-stream traffic, and injects the
engine credential server-side. It also serves the Notes API and manages registration of the
optional Notes MCP server in the engine's configuration. The engine is a separate dependency; this
project does not install, start, or modify it.

## Prerequisites

- Install and start the **OpenCode V2 engine** separately, compatible with the pinned
  `@opencode/client` **2.1.4**. This project does not install or start the engine.
- [Bun](https://bun.sh/) **1.4.4**. `package.json` declares the exact version; broader
  compatibility is not established.

If the engine requires a password, enter it privately during connection setup. Never pass it on the
command line, put it in a URL, or commit it.

## Quick start from a checkout

```sh
bun install
bun run start
```

Open <http://127.0.0.1:5174> on the same machine. `bun run start` serves the production build,
creating it on first run when it is missing. On first visit, set an OpenCode UI password. You can
change it later in Settings → Access.

After setup, the home screen shows **No available connections** until you add one. Select **Open
Connection Settings**, then **Add connection**. Enter a name and the HTTP(S) address shown by
`opencode service status`.

OpenCode V2's background service can generate its own password even if you never set one. If the
connection test says a password is required, run `opencode service get password` privately on the
engine machine and enter the result as the required **Engine password**. Use **Test connection** to
verify, then **Save and connect**. A failed check does not save or activate a connection.

The engine password is separate from the UI access password. The UI no longer reads engine
registration files. If an existing connection was using a registration file, edit it and enter
the engine password.

### Remote access

To expose the UI on another interface, configure the access password first and pass explicit
allowed host and origin values:

```sh
bun run start --host 0.0.0.0 --allowed-host ui.example.test --allowed-origin https://ui.example.test
```

Replace `ui.example.test` with your real reachable hostname and use secure transport (HTTPS behind
a trusted reverse proxy or tunnel). Set the UI password privately before exposing the service; a
non-loopback bind requires one. The first visit opens the setup screen when no password is set, or
the sign-in screen when one is already configured. The setup endpoint works without a session.
The direct server derives its built-in loopback allowed origins from the resolved `--port`, so
changing `--port` on loopback works automatically; pass an explicit `--allowed-origin` for any
non-loopback origin. Use `bun run start --help` for the complete flag reference.

## Published package

`@tunitz/opencode-ui` is not currently published on a package registry, and registry installation
is unverified. Packaging and registry verification are pending. For now, install and run from a
checkout as shown above. The unscoped `opencode-ui` package is unrelated; do not install it.

## Common options

The start command accepts these flags (`bun run start:bun` and `bun run preview` are aliases).
Flags override environment settings. For a non-loopback bind, always pass explicit non-loopback
`--allowed-host` and `--allowed-origin` values — see [Remote access](#remote-access) and the
security boundary below.

| Option | Default and behavior |
| --- | --- |
| `--host <host>` | `OPENCODE_UI_HOST`, otherwise `127.0.0.1`. Bind hostname/IP only. |
| `--port <port>` | `OPENCODE_UI_PORT`, otherwise `5174`. Integer from 1 through 65535. |
| `--engine-url <origin>` | Optional prefill for first-run setup. Does not create a connection. |
| `--allowed-host <host>` | Repeatable additions to loopback hosts. Hostname/IP only. |
| `--allowed-origin <origin>` | Repeatable additions to loopback origins at the UI port. |
| `--artifact-root <path>` | Repeatable artifact roots; replaces `OPENCODE_UI_ARTIFACT_ROOTS` when supplied. `bun run start` otherwise allows `/tmp/opencode/shots`; the CLI allows none. |
| `--help`, `--version` | Show usage or the package version without reading credentials or starting services. |

Long options accept `--name value` or `--name=value`. Flags override applicable environment
settings. Run `bun run start --help` for the complete reference.

## Configuration

Common environment variables include:

- `OPENCODE_UI_HOST`, `OPENCODE_UI_PORT`: UI listener.
- `OPENCODE_UI_ARTIFACT_ROOTS`: comma-separated artifact roots; empty disables delivery.
- `OPENCODE_UI_AUTH_STATE`: overrides the password/session state file, which defaults to
  `~/.local/share/opencode-ui/auth/state.json`.
- `OPENCODE_UI_CONNECTIONS_STATE`: overrides saved local/remote OpenCode engine profiles, which
  default to `~/.local/share/opencode-ui/connections.json` (mode `0600`).
- `OPENCODE_UI_SESSION_SHORTCUTS_STATE`: overrides the shared session pins/labels file, which
  defaults to `~/.local/share/opencode-ui/session-shortcuts.json`. Pins and labels are server-wide
  rather than browser-local.
- `OPENCODE_UI_SESSION_HOME`: overrides the home directory prefilled by New Session; otherwise the
  UI host's home directory is used. Remote engines currently keep their own engine-side location default.
- `OPENCODE_UI_SESSION_COOKIE`: overrides the session cookie name (default `opencode_ui_session`).
  Set a distinct name for a second UI instance on the same host, since cookies are scoped to a host
  and ignore port numbers.
- `OPENCODE_NOTES_DATA_DIR`: overrides the Notes data directory, which defaults to
  `$XDG_DATA_HOME/opencode-notes/v1` or `~/.local/share/opencode-notes/v1`.
- `OPENCODE_UI_NOTIFICATION_STATE`: private notification state; defaults to
  `~/.local/state/opencode-ui/notifications/state.json`.
- `OPENCODE_UI_VAPID_SUBJECT`: Web Push contact URI; set an appropriate contact for your use.
- `OPENCODE_CONFIG_DIR`: local agent configuration directory.

Drafts and preferences live in browser-local storage scoped to the origin. Changing the URL creates
a separate storage scope, and preferences are not shared across devices.

## Security boundary

The UI has a single required access password, set on first visit. Sessions use an HTTP-only,
SameSite=Lax cookie
valid for 30 days; the server stores an argon2id password hash and SHA-256 session-token hashes
under `~/.local/share/opencode-ui/auth/`, and no password or token is placed in `localStorage` or
`sessionStorage`. Anyone with the password can exercise the permissions of the engine credential.

`bun run start` binds to loopback by default. A non-loopback bind requires a UI password and should
add an explicit non-loopback `--allowed-host` and an explicit non-loopback `--allowed-origin`, plus
secure transport such as HTTPS. Allowlists are not authentication or multi-tenant isolation. Protect
the engine endpoint separately, and do not disable the UI's Host, Origin, WebSocket, route, method,
JSON-mutation, artifact-provenance, or `no-store` protections.

## Notes

Notes are built in and do not depend on an engine plugin. The internal
[notes module](plugins/notes/README.md) (`plugins/notes/`) is a standalone TypeScript core
with a plaintext file store shipped inside this repository. The UI server imports it in-process for
the notes workspace and `/api/ui/notes/*`; agents use it through an optional MCP stdio server.

The browser Notes workspace and the note reference picker are hidden when the plugin registry
definitively reports the Notes MCP entry as disabled. A transient or unknown registry state leaves
them visible rather than hiding them on a failed read.

**Enable agent tools** in Settings → Plugins. Enabling writes an `mcp.servers.notes` entry into the
engine's global configuration (`opencode.jsonc` or `opencode.json`) through an atomic JSONC edit,
and disabling removes it; this is not merely an HTTP-only action. The engine must be able to execute
the registered Bun entry, and it may need a restart before the tools appear; the section reports
that state. The UI server and the MCP server must resolve the same `OPENCODE_NOTES_DATA_DIR` (or its
default) to see the same notes. If you previously installed the old notes engine plugin or its
`~/.config/opencode/plugins/...` symlink, remove it before enabling Notes here.

The MCP server exposes 15 tools (`notes_list`, `notes_get`, `notes_create`, `notes_update`,
`notes_delete`, `notes_search`, `notes_history`, `notes_restore`, `notes_spaces`,
`notes_create_space`, `notes_update_space`, `notes_delete_space`, `notes_attachment_create`,
`notes_attachment_read`, `notes_attachment_delete`), three
prompts (`notes:capture`, `notes:daily`, `notes:review`), and note/space resources. The
[notes package README](plugins/notes/README.md) lists arguments and behavior. Browser listings are
all-project/global; MCP tools are directory-scoped by default (the MCP process's working directory,
overridable per call with a `directory` argument).

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

- [docs/components.md](docs/components.md): component architecture and current surface coverage.
- [docs/contract.md](docs/contract.md): native OpenCode contract and app-layer security rules.
- [docs/commands.md](docs/commands.md): slash-command coverage and native command behavior.
- [plugins/notes/README.md](plugins/notes/README.md): Notes package and MCP tool reference.
- [CHANGELOG.md](CHANGELOG.md): notable changes.

## Status and limitations

- The project is pre-1.0; interfaces and behavior may change.
- `/terminal` opens a lazy xterm browser terminal backed by native PTY APIs and the same-origin WebSocket bridge; reconnects require explicit Reattach.
- Notifications are best-effort and depend on browser and OS push delivery.
- The UI password is one shared access password; it is not multi-tenant isolation.
- Package publication and registry installation are not verified; packaging checks are pending.

## License

[MIT](LICENSE)
