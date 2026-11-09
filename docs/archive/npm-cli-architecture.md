# Production Bun CLI architecture

Status: implementation specification for `npm-cli-tasklist.md`; no UI redesign. Package-name availability and release authorization remain unresolved. This document does not authorize publishing or deployment changes.

## Package boundary

- Keep Bun-native TypeScript runtime code; no server bundling, Node fallback, Vite, engine embedding, or consumer-side compilation. Declare `bin: { "opencode-ui": "bin/opencode-ui.ts" }`; executable entry begins `#!/usr/bin/env bun`. Declare Bun support against the repository's pinned `1.4.4` baseline; do not imply broader compatibility without verification.
- Make the package publishable by removing `private: true`. Use an explicit `files` allowlist: `bin/opencode-ui.ts`, the runtime files below, and `dist-bun-build/`. Package metadata and README/license notices accompany these as applicable.
- Runtime server allowlist: `server/{bun-server,bun-config,bun-application,agent-config,artifact-delivery,notifications,pty-websocket-bridge,request-security,web-dispatch,web-gateway,web-proxy,web-security,web-static}.ts`, plus exactly `src/lib/agent-config-types.ts`: `server/agent-config.ts` imports its runtime constants and validators. `bun-config.ts` contains shared, side-effect-free CLI/server validators. Express these as explicit package file entries, not broad `server/` or `src/` inclusions. The shared module has no further imports. Retain their external runtime dependencies (`jsonc-parser`, `yaml`, `web-push`, and any other actual runtime imports) in `dependencies`; dependency pruning is not required for this change.
- Add a publisher-side `prepack` invoking `bun run build:bun` with the build target forced to production (unset or non-`dev`). The existing atomic staging build must emit the entire `dist-bun-build/`: HTML, copied public files, CSS, fonts, chunks, and PDF worker. No install/postinstall build. Do not run prepack in this architecture task.
- Exclude deployment `dist-bun/`, development/staging/backup outputs, other source/tests/tooling, `.env*`, service registrations, notification subscriptions/VAPID keys, transcripts, screenshots/artifacts, capabilities, and all private state. The exact shared runtime module above is the only `src/` exception. Do not inject environment secrets into frontend build definitions. Only intentional public assets may enter `public/`; its full contents are copied into the release.

## Entry point and compatibility seam

Extend `startBunServer` with explicit typed options for hostname, port, engine URL, service-file path, asset directory, artifact roots, and security lists. Resolve configuration before reading credentials or creating services. Importing the module must remain side-effect free; help/version must never start watchers, read credentials, or contact the engine.

Keep **no-argument direct invocation** (`bun server/bun-server.ts`) compatible: existing `OPENCODE_UI_HOST`, `OPENCODE_UI_PORT`, `OPENCODE_UI_ARTIFACT_ROOTS`, `OPENCODE_UI_BUILD_TARGET`, `OPENCODE_UI_DEV_ORIGIN`, service-file location, engine target, legacy security defaults, and notification/agent environment settings retain their behavior. Do not replace the existing machine-specific security constants globally. The public CLI passes complete, separate security lists and never inherits those constants accidentally.

Asset selection is explicit, never a working-directory search or fallback:

| Entry | Asset directory, relative to package/repository module |
| --- | --- |
| Public CLI | `dist-bun-build/` regardless of `OPENCODE_UI_BUILD_TARGET` |
| Existing direct production server | `dist-bun/` unchanged |
| Existing dev script | `dist-bun-dev/` unchanged |

Missing packaged assets fail with a sanitized reinstall/release-build diagnostic; never run a build at startup. Preserve `scripts/dev-bun.mjs` behavior (watch/rebuild, port 5175 default, exact loopback development origin). Do not rename or overwrite live `dist-bun/`.

## CLI contract

Scalar precedence: flag > applicable existing environment variable > CLI default. Repeated list flags replace, rather than merge with, the corresponding environment list. Relative user paths resolve against the caller's working directory; packaged assets never do. No credential/password/token flags.

| Flag | CLI default / behavior |
| --- | --- |
| `--host <host>` | `OPENCODE_UI_HOST`, else `127.0.0.1`; bind hostname/IP only, not a URL |
| `--port <port>` | `OPENCODE_UI_PORT`, else `5174`; integer 1–65535 |
| `--engine-url <url>` | `http://127.0.0.1:4096`; OpenCode service host and port as an absolute HTTP(S) origin, no userinfo, path other than `/`, query, or fragment. The direct legacy server retains its installation-specific `8090` target. |
| `--service-file <path>` | `$XDG_CONFIG_HOME/opencode/service.json` when set, otherwise `~/.config/opencode/service.json`; read existing nonempty `password` field for server-only Basic auth. The legacy direct entry retains its existing home-relative path. |
| `--allowed-host <hostname>` | Repeatable additions to CLI loopback hosts (`127.0.0.1`, `localhost`, `[::1]`); hostnames/IPs only, no scheme, port, path, or wildcard |
| `--allowed-origin <origin>` | Repeatable additions to exact HTTP loopback origins at the resolved UI port; validate HTTP(S) origins without credentials, non-root paths, query, fragment, `null`, or wildcard |
| `--artifact-root <path>` | Repeatable; otherwise existing comma-separated `OPENCODE_UI_ARTIFACT_ROOTS`, otherwise **empty roots** (local file delivery disabled; no `/tmp/opencode/shots` assumption) |
| `--help`, `-h` | Usage, defaults, engine prerequisite, security warning; exit 0 without startup |
| `--version`, `-v` | Version from package metadata; exit 0 without startup |

Use full long-option names; support `--name value` and `--name=value`. Reject unknown options, positionals, missing/empty values, duplicate scalars, malformed ports/URLs/hosts before startup with exit 1 and a short actionable error. Diagnostics must not echo secret-bearing URLs or service-file contents. No new environment names are necessary for engine URL, service file, or allowlists. Other service-specific environment settings remain usable.

## Trust and engine boundary

- Public CLI defaults to local access, explicitly overriding the host-wide bind convention for this credential-bearing gateway. Its exact default origins are `http://127.0.0.1:<port>`, `http://localhost:<port>`, and `http://[::1]:<port>`. `--host` changes binding only: never synthesize remote trust, wildcard CORS, or an origin from a request Host header. `OPENCODE_UI_DEV_ORIGIN` does not widen CLI trust.
- Non-loopback binding requires at least one explicit non-loopback allowed host **and** allowed origin; otherwise fail with guidance. Behind a proxy, even a loopback-bound server needs explicit public host/origin additions. Match origins exactly (normalized scheme/host/port), not suffixes. Preserve shared Host/Origin HTTP and WebSocket guards, API route/method allowlists, JSON mutation checks, stripped upstream CORS, `no-store`, artifact provenance/root containment, and server-only authorization.
- OpenCode V2 is a **separately installed and running prerequisite**, compatible with the pinned `@opencode/client` 2.1.4/native contracts. The CLI never installs, starts, reconfigures, or embeds the engine. An alternate engine must accept the existing `opencode` Basic-auth credential scheme supplied by the selected service registration. Do not forward that credential to redirects or expose it to browser responses/logs. Warn against unprotected remote HTTP engine transport.
- No browser login exists. Remote UI use requires an operator-provided authenticated access boundary and secure transport; allowlists are not authentication or multi-tenant isolation. Keep notification/agent state in their existing user-state/config locations, not the installed package. Explicit artifact roots do not bypass provenance checks or grant general filesystem browsing.

## Handoff and verification status

Implement package/CLI and the server options seam first, then update README with installation, separate-engine credentials, flags, local/explicit-remote examples, existing Bun development commands, and security guidance. Preserve UI/themes/composer behavior unchanged.

Source reviewed: task list, `package.json`, `scripts/build-bun.ts`, `server/bun-server.ts`, `server/request-security.ts`, and `scripts/dev-bun.mjs`. No tests, checks, builds, service startup, publication, commits, or live-state mutations were performed. Future authorized verification must inspect release contents for private state, execute help/version without credentials, exercise installed assets from an unrelated working directory, and cover local/remote policy plus direct/dev compatibility; these are acceptance targets, not verified claims.
