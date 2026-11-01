# OpenCode UI

A mobile-first web client for a separately running OpenCode V2 engine. Browse conversations,
send prompts, inspect files and terminal sessions, manage supported settings, and use optional
notifications. The engine owns sessions, tools, providers, and history.

## Requirements

- [Bun](https://bun.sh/) **1.4.4**: `package.json` declares exact `engines.bun: "1.4.4"`
  and `packageManager: "bun@1.4.4"`. Broader version compatibility is not established.
- A separately installed, running OpenCode V2 engine compatible with the pinned
  `@opencode/client` **2.1.4** and its native contracts.
- An existing engine service-registration JSON file with a nonempty string `password`, readable
  by the account running the UI. The server uses Basic username `opencode` with that password.

The UI does not install, start, or reconfigure the engine. Follow your engine's own setup
instructions first. Keep its registration private; never print or log its password, put it in
command-line flags or URLs, or commit it. The browser must never receive the engine credential.

## Intended installation after publication

**Publication and package-name availability are not verified.** Once this package is published
under the intended name, you can run:

```sh
bunx opencode-ui
```

With no environment overrides, open <http://localhost:5174> on the same machine. The CLI binds
to `127.0.0.1`, connects to `http://127.0.0.1:4096`, and reads
`$XDG_CONFIG_HOME/opencode/service.json` when `XDG_CONFIG_HOME` is nonempty, otherwise
`~/.config/opencode/service.json`.

To select an existing registration and a different local engine port:

```sh
bunx opencode-ui --host 127.0.0.1 --port 5174 \
  --engine-url http://127.0.0.1:4097 \
  --service-file "$HOME/.config/opencode/service.json"
```

The selected registration's password must authenticate to that engine. Prefer loopback engine
transport; for a remote engine, use HTTPS or a trusted secure tunnel. Unprotected remote HTTP
exposes credentials and private traffic. Restart the UI after changing its service credential.

The CLI serves production assets from the installed package's `dist-bun-build/`, independently
of your working directory. It never builds assets at startup. A missing-assets error requires a
correctly built release/reinstallation, not a consumer-side build.

## CLI reference

| Option | Default and behavior |
| --- | --- |
| `--host <host>` | `OPENCODE_UI_HOST`, otherwise `127.0.0.1`. Bind hostname/IP only. |
| `--port <port>` | `OPENCODE_UI_PORT`, otherwise `5174`. Integer from 1 through 65535. |
| `--engine-url <origin>` | `http://127.0.0.1:4096`. OpenCode service host and port as an absolute HTTP(S) origin. |
| `--service-file <path>` | `$XDG_CONFIG_HOME/opencode/service.json`, otherwise `~/.config/opencode/service.json`. Select an existing registration. |
| `--allowed-host <host>` | Repeatable additions to trusted `127.0.0.1`, `localhost`, and `[::1]`. Hostnames/IPs only: no scheme, port, path, or wildcard. |
| `--allowed-origin <origin>` | Repeatable additions to `http://127.0.0.1:<port>`, `http://localhost:<port>`, and `http://[::1]:<port>` at the resolved UI port. |
| `--artifact-root <path>` | Repeatable roots; replaces `OPENCODE_UI_ARTIFACT_ROOTS` when supplied. Otherwise uses that comma-separated environment list, or no roots. |
| `--help`, `-h` | Show usage without reading credentials or starting services. |
| `--version`, `-v` | Show the package version without starting services. |

`--host` and `--port` configure the UI listener, not the OpenCode service. Use
`--engine-url http://<engine-host>:<engine-port>` to configure the service host and port together;
there are no separate engine-host or engine-port flags. The CLI uses OpenCode's standard port
`4096`, as shown in the [OpenCode V2 client guide](https://opencode.ai/v2/docs/build/client).
If your engine listens elsewhere, supply its actual URL explicitly.

Long options accept `--name value` or `--name=value`. Flags override applicable environment
settings. Relative service-file and artifact paths resolve against your current working directory.
Use shell expansion such as `"$HOME/..."` for home-relative paths. Do not repeat scalar flags.
Unknown options, positional arguments, empty values, and malformed configuration are rejected.

Origins accept HTTP(S) only, with no credentials, non-root path, query, fragment, `null`, or
wildcard. Origin matching uses the exact normalized scheme, hostname, and port. There are no
engine-URL, service-file, or trust-allowlist environment variables for the CLI.
`OPENCODE_UI_BUILD_TARGET` and `OPENCODE_UI_DEV_ORIGIN` do not change CLI assets or trust.

## Security and remote access

**There is no browser login.** Anyone who can access the UI can exercise the permissions of its
engine credential. Before remote access, provide an authenticated access boundary and secure
transport, such as an authenticated HTTPS reverse proxy. Allowlists are not authentication or
multi-tenant isolation. Protect the engine endpoint separately.

`--host` changes binding only, never trust. Non-loopback binding requires both an explicit
non-loopback `--allowed-host` and an explicit non-loopback `--allowed-origin`. For example,
only after you provision that access boundary and HTTPS proxy for `ui.example.com`:

```sh
bunx opencode-ui --host 0.0.0.0 --port 5174 \
  --allowed-host ui.example.com \
  --allowed-origin https://ui.example.com
```

Access the protected proxy at `https://ui.example.com`, not the unprotected listener. Restrict
direct access to port 5174 to the proxy/trusted boundary. For a same-machine proxy, prefer
`--host 127.0.0.1`; you still need the explicit public host and origin flags. Your proxy must
support WebSockets and forward the configured public Host/Origin consistently.

Keep Host, Origin, WebSocket, route/method, JSON mutation, and `no-store` protections enabled.
Do not add wildcard CORS or bypass artifact provenance/file-safety checks. Keep credentials,
notification state, transcripts, and private artifacts outside version control and release assets.

## Optional files and state

Local artifact delivery is **opt-in for the CLI**. Add `--artifact-root /path/to/artifacts`
(repeatable), or set comma-separated `OPENCODE_UI_ARTIFACT_ROOTS`. An empty environment value
leaves roots empty. Roots only permit eligible files with native provenance and file-safety
checks; they do not enable general filesystem browsing.

- `OPENCODE_UI_NOTIFICATION_STATE` selects private notification state; the default is
  `~/.local/state/opencode-ui/notifications/state.json`.
- `OPENCODE_UI_VAPID_SUBJECT` selects the Web Push contact URI. Set your own appropriate
  contact when enabling notifications; the legacy default is
  `https://tun-minipc.great-vernier.ts.net`, not a universal deployment setting.
- `OPENCODE_CONFIG_DIR` selects the local agent configuration directory; otherwise it uses
  `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`. This does not select the CLI service file.

Drafts and preferences live in browser-local storage scoped to the origin. Changing the URL
creates a separate storage scope. Server-side state/configuration stays in user locations, not
the installed package; align local agent configuration with the engine you operate.

## Development from a checkout

Use Bun for dependency management and scripts. With the separate engine and registration ready:

```sh
bun install --frozen-lockfile
bun run dev
```

`bun run dev:bun` is an alias. The script builds `dist-bun-dev/`, watches `src/`, `public/`,
and `index.html` for rebuilds, and runs the server with Bun's watch mode. It defaults to port
`5175`, or `OPENCODE_UI_PORT` when set. Open <http://127.0.0.1:5175> on the same machine
with default settings. Set `OPENCODE_UI_HOST=127.0.0.1` explicitly if your environment overrides
the bind host. The script adds the exact `http://127.0.0.1:<port>` development origin; it does
not parse CLI flags passed to `bun run dev`.

To build and serve production assets through the CLI from a checkout:

```sh
bun run build:bun
bun run bin/opencode-ui.ts --host 127.0.0.1 --port 5174
```

Unset `OPENCODE_UI_BUILD_TARGET` (or use `production`) for that build. `bun run build:bun`
emits the complete `dist-bun-build/`; `bun run build` first runs `tsc -b`, then the same build.
Neither command overwrites the legacy deployment directory `dist-bun/`.

For a local checkout deployment before publication, register the checkout's executable
after building, then use `bunx` without permitting a registry fallback:

```sh
chmod +x bin/opencode-ui.ts
mkdir -p node_modules/.bin
ln -s ../../bin/opencode-ui.ts node_modules/.bin/opencode-ui
bunx --no-install opencode-ui --host 127.0.0.1 --port 5174
```

Create the symlink only if it is absent; do not replace an unrelated executable. Run from
the checkout directory (set the same working directory in a service). Dependency reinstalls
may remove the link; recreate it if needed. This uses the local checkout, not a published
registry release. A Bun-shebang executable also needs Bun on the service's `PATH`.
Use `--engine-url` explicitly when preserving an installation-specific engine port such as
`8090`; the CLI default remains `4096`.

**Direct-server compatibility:** `bun run start:bun` and `bun run preview` both invoke
`server/bun-server.ts`, not the CLI. They expect `dist-bun/` by default, so they are not previews
of a fresh `dist-bun-build/`. With `OPENCODE_UI_BUILD_TARGET=dev`, the direct server instead
uses `dist-bun-dev/`. Direct/dev entrypoints retain legacy trust defaults, the home-relative
`~/.config/opencode/service.json`, fixed engine target `http://127.0.0.1:8090`, and legacy
artifact root `/tmp/opencode/shots` when the roots environment variable is absent. An explicitly
empty `OPENCODE_UI_ARTIFACT_ROOTS` disables those roots. Use the CLI for its isolated trust
defaults and configurable engine/service-file options; do not assume these entrypoints share
the CLI's security configuration.

Edit the application in `src/`, runtime in `server/` and `bin/`, and Bun build/dev tooling in
`scripts/`. See [AGENTS.md](AGENTS.md), [COMPONENTS.md](COMPONENTS.md),
[CONTRACT.md](CONTRACT.md), and [COMMANDS.md](COMMANDS.md). Historical installation-specific
examples are not universal requirements.

## Publisher workflow

After release authorization, confirm package-name availability and configure authorized registry
credentials privately. Neither name availability nor registry credentials have been verified.
From a checkout with Bun 1.4.4 and development dependencies available:

```sh
bun install --frozen-lockfile
bun publish --access public
```

The `prepack` lifecycle automatically runs
`OPENCODE_UI_BUILD_TARGET=production bun run build:bun`. The package allowlist includes the CLI,
required runtime modules, and complete production frontend (HTML, public files, CSS, fonts,
chunks, and PDF worker). Consumers do not need a source build or an install-time build hook.
Everything in `public/` is copied into release assets: keep it free of private data and secrets.

**Status:** all three implementation tasks passed source QA, followed by a source-only integration
review. A production frontend build was subsequently completed for the local `bunx --no-install`
service deployment. Tests and registry-package build/install verification have not been run;
release readiness remains **NEEDS WORK** pending package verification, registry name/ownership
confirmation, and publication. The publish command is an intended workflow, not a claim that
this package is published or release-ready. See the earlier
[readiness review](project-docs/npm-cli-readiness.md).
