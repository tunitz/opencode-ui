# OpenCode UI

A mobile-first web client for an existing OpenCode V2 engine. Browse conversations, send prompts,
inspect files and terminal sessions, manage supported settings, and use optional notifications.
The engine runs separately and owns sessions, tools, providers, and history.

## Requirements

- [Bun](https://bun.sh/) (the project specifies its version in `package.json`).
- An OpenCode V2 engine compatible with the pinned `@opencode/client` version (currently 2.1.4).
- The engine's local service registration and Basic password, readable by the user running the UI.

## Configure and run

The current server configuration contains installation-specific defaults. Before running a clone,
review and update them for your environment:

1. In `vite.config.ts`, set the OpenCode target URL and the Vite `server` and `preview` host and
   allowed-host settings. For local use, bind Vite to `127.0.0.1`. The default UI port is `5174`.
2. In `server/request-security.ts`, set the allowed hosts and exact allowed origins to match the
   address and port used to access the UI. For example, local access at
   `http://127.0.0.1:5174` needs that exact origin in `DEFAULT_ALLOWED_ORIGINS`. Keep the
   host, origin, WebSocket, route and content-type guards enabled.
3. The proxy reads the engine password from `~/.config/opencode/service.json` under the `password`
   key and uses the Basic username `opencode`. Start the engine using its own setup instructions
   and ensure that registration file is available to the UI process. If your installation uses a
   different registration location, adapt `readOpenCodeAuthorization` in `vite.config.ts`.
4. Install dependencies and start the UI:

   ```sh
   bun install
   bun run dev -- --host 127.0.0.1
   ```

Open `http://127.0.0.1:5174` after configuring its origin as above. If the credential is unavailable,
API requests return 401. Restart the UI after changing its server configuration or credential.

For a built preview, use `bun run build` followed by `bun run preview -- --host 127.0.0.1`.
This project uses Bun; npm, npx, pnpm, and yarn are not supported.

### Optional settings

- `OPENCODE_UI_ARTIFACT_ROOTS`: comma-separated exact directories from which verified assistant/tool
  artifacts may be served. The default is `/tmp/opencode/shots`. Artifacts also require native
  provenance and the server's file safety checks.
- `OPENCODE_UI_NOTIFICATION_STATE`: location of private notification state.
- `OPENCODE_UI_VAPID_SUBJECT`: Web Push VAPID contact subject. Set this to an appropriate contact
  URI for your installation when enabling notifications.

Settings and drafts are stored in the browser and scoped to its origin. Changing the URL creates a
separate browser storage scope.

## Security and deployment

The UI server holds an engine credential and uses it for upstream requests. **There is no separate
browser login:** anyone able to access the UI can exercise the permissions available to that
credential. Do not expose it to an untrusted network without an appropriate access boundary and
secure transport. A reverse proxy or network boundary is the deployer's responsibility; the Vite
server alone is not a multi-tenant authentication system. Protect the engine endpoint separately.

Keep credentials and notification state private and outside version control. Do not disable the
existing host, Origin, WebSocket, route, JSON, and response-cache protections to make a deployment
work. Configure explicit trusted hosts and origins instead.

## Development

Edit the React/TypeScript application in `src/`, the server middleware in `server/`, and the Vite
configuration in `vite.config.ts`. Useful commands:

```sh
bun run typecheck
bun run lint
bun run build
```

See [AGENTS.md](AGENTS.md) for contributor guidance. [COMPONENTS.md](COMPONENTS.md),
[CONTRACT.md](CONTRACT.md) and [COMMANDS.md](COMMANDS.md) provide
additional architecture and behavior details; some include historical installation-specific
examples, which should not be treated as deployment requirements.
