# OpenCode UI

A mobile-first web client for a separately running OpenCode V2 engine. It gives the engine a
browser interface for conversations and prompts while the engine keeps ownership of sessions,
tools, providers, and history.

## Highlights

- Mobile-first conversation, prompt, and session navigation.
- Files, working-tree diffs, permissions, forms, and session settings.
- Structured tool output, artifacts, Markdown, tables, and images.
- Light, Dark, and System themes with keyboard, focus, RTL, and reduced-motion support.
- Optional Notes plugin with notes and planning spaces.
- Optional Web Push notifications.
- The engine credential stays on the UI server; the browser never receives it.

## Architecture

```text
Browser  <->  OpenCode UI server  <->  OpenCode V2 engine
```

The UI server serves the built frontend, proxies HTTP and event-stream traffic, and injects the
engine credential server-side. The engine is a separate dependency; this project does not install,
start, or modify it.

## Requirements

- [Bun](https://bun.sh/) **1.4.4**. `package.json` declares the exact version; broader
  compatibility is not established.
- A separately installed and running OpenCode V2 engine compatible with the pinned
  `@opencode/client` **2.1.4**.
- An existing engine service-registration JSON file with a nonempty string `password`, readable by
  the account running the UI. The server authenticates with Basic username `opencode`.

Keep the registration private. Never print or log its password, pass it on the command line, put it
in a URL, or commit it.

## Quick start from a checkout

```sh
bun install --frozen-lockfile
bun run build:bun
bun bin/opencode-ui.ts --host 127.0.0.1 --port 5174
```

Open <http://127.0.0.1:5174> on the same machine. With no overrides, the CLI connects to
`http://127.0.0.1:4096` and reads `$XDG_CONFIG_HOME/opencode/service.json` when
`XDG_CONFIG_HOME` is nonempty, otherwise `~/.config/opencode/service.json`.

The CLI serves production assets from `dist-bun-build/`; it never builds assets at startup. If the
engine listens elsewhere, pass `--engine-url` explicitly.

## Published package

The scoped package is not currently published. Once `@tunitz/opencode-ui` is available:

```sh
bunx -p @tunitz/opencode-ui opencode-ui --host 127.0.0.1 --port 5174
```

Do not install the unscoped `opencode-ui` package; it belongs to an unrelated project.

## Common options

| Option | Default and behavior |
| --- | --- |
| `--host <host>` | `OPENCODE_UI_HOST`, otherwise `127.0.0.1`. Bind hostname/IP only. |
| `--port <port>` | `OPENCODE_UI_PORT`, otherwise `5174`. Integer from 1 through 65535. |
| `--engine-url <origin>` | `http://127.0.0.1:4096`. OpenCode engine HTTP(S) origin. |
| `--service-file <path>` | `$XDG_CONFIG_HOME/opencode/service.json`, otherwise `~/.config/opencode/service.json`. |
| `--allowed-host <host>` | Repeatable additions to loopback hosts. Hostname/IP only. |
| `--allowed-origin <origin>` | Repeatable additions to loopback origins at the UI port. |
| `--artifact-root <path>` | Repeatable artifact roots; replaces `OPENCODE_UI_ARTIFACT_ROOTS` when supplied. |
| `--help`, `--version` | Show usage or the package version without reading credentials or starting services. |

Long options accept `--name value` or `--name=value`. Flags override applicable environment
settings. Run `bun bin/opencode-ui.ts --help` for the complete reference.

## Configuration

[.env.example](.env.example) lists the supported environment variables. The main ones are:

- `OPENCODE_UI_HOST`, `OPENCODE_UI_PORT`: UI listener.
- `OPENCODE_UI_ARTIFACT_ROOTS`: comma-separated artifact roots; empty disables delivery.
- `OPENCODE_UI_NOTIFICATION_STATE`: private notification state; defaults to
  `~/.local/state/opencode-ui/notifications/state.json`.
- `OPENCODE_UI_VAPID_SUBJECT`: Web Push contact URI; set an appropriate contact for your use.
- `OPENCODE_CONFIG_DIR`: local agent configuration directory. This does not select the CLI service
  file.

Drafts and preferences live in browser-local storage scoped to the origin. Changing the URL creates
a separate storage scope, and preferences are not shared across devices.

## Security boundary

There is no browser login. Anyone who can reach the UI can exercise the permissions of its engine
credential.

The CLI binds to loopback by default. Non-loopback binding requires both an explicit non-loopback
`--allowed-host` and an explicit non-loopback `--allowed-origin`, plus an authenticated access
boundary and secure transport such as HTTPS. Allowlists are not authentication or multi-tenant
isolation. Protect the engine endpoint separately, and do not disable the UI's Host, Origin,
WebSocket, route, method, JSON-mutation, artifact-provenance, or `no-store` protections.

## Optional Notes plugin

The separately packaged [Notes plugin](plugins/notes/README.md) adds notes, planning spaces, agent
tools, and a TUI interface. When its server part is active for the selected location, the sidebar
offers notes and planning spaces; without it the UI works as before.

Notes open in a read-only Markdown preview; editing is explicit. A note body can reference
project-relative files (safe raster images render, other files link through the same-origin file
route), and notes can store uploaded attachments in plugin storage. Attachments are limited to 4
files per note, 4 MiB per file, and 8 MiB per note; SVG, HTML, and JavaScript types are rejected.
The composer can attach a note as a Markdown file, including its attachment manifest.

Notes, spaces, and attachments are plaintext in OpenCode plugin storage, not browser-local drafts.
They are not encrypted and do not provide multi-user isolation. Do not store secrets in notes.

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
- There is no browser login, cookie session, or built-in multi-tenant isolation.
- Package publication and registry installation are not verified.

## License

[MIT](LICENSE)
