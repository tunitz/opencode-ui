# Native commands and web parity

Current web command coverage is **30 supported / 2 partial / 5 explicitly deferred** native
commands. This is not 37-command parity: unsupported/PIP-only behavior stays visible instead of
being faked in the browser.

**Target:** OpenCode **2.1.4**. The inventory below is based on the installed native command
catalog and the archived TUI/source contract, not newer public docs.

## Sources used

- Native slash inventory: TUI source registrations in
  `packages/tui/src/app.tsx`, `component/prompt/index.tsx`,
  `component/session-frame.tsx`, `routes/session/index.tsx`,
  `feature-plugins/prompt/btw.tsx`, `feature-plugins/system/{diff-viewer,plugins,stats}.tsx`.
- Native server command catalog: `GET /api/command` returns only `{name, description}[]` for
  the target location. It includes core commands (`init`, `review`), custom config/project
  commands, and MCP prompt commands; these are merged dynamically and are not hardcoded.
- Native execution contract: `POST /api/session/{sessionID}/command` with
  `{name, text, files?, agents?, skills?, delivery?}`. `text` is not shell-evaluated. The web
  client sends `name`, the exact argument text, validated composer attachments as `files`, and
  `delivery:"steer"` only when the session is actively running; idle commands omit delivery.
- CLI docs (`https://opencode.ai/v2/docs/cli/commands`) are separate operational/CLI commands,
  not TUI slash commands. Native docs may describe a newer version; do not assume latest =
  2.1.4.

## Web adapter rules

- `/` in the composer opens a nonmodal anchored Popover + filtered command list. Typing filters;
  ↑/↓ moves; desktop Enter/Tab activates the highlighted item; Escape closes. Touch Enter keeps
  the composer's newline rule; a touch user must activate an item or Send.
- API/project commands are inserted as `/name ` for argument entry, never executed merely by
  highlight. Send executes only after explicit activation.
- Unknown slash text is not submitted as a prompt. The picker offers an explicit **Send as a
  literal message** action.
- Unsupported entries remain visible with a reason and never POST/trigger a model.
- Project command catalog is scoped to the selected session directory, reloads on
  `command.updated` / `config.updated`, and is cleared on project change. A stale directory
  catalog blocks execution.
- `/terminal` opens the existing Session inspector at its Terminal tab; it never runs a shell
  command, creates a PTY, attaches a socket, or sends input merely from command/tab activation.
  See the terminal contract below.
- No arbitrary JS/plugin/OS command is evaluated in the browser.

## Native TUI slash inventory (37 canonical names + aliases)

| Native name / aliases | Category | Web behavior | Arguments | Status |
|---|---|---|---|---|
| `/help` | System | Explains picker; keeps it available | none | supported |
| `/sessions`, `/resume`, `/continue` | Session | Opens existing session navigator | none | supported |
| `/new` | Session | Opens existing New session dialog | none | supported |
| `/clear` | Session | Returns to the empty client view without deleting or stopping the session | none | supported |
| `/open`, `/projects`, `/project` | Session | Opens session/project navigator | none | supported |
| `/models` | Agent | Opens current-session model settings | none | supported |
| `/agents` | Agent | Opens current-session Agent setting | none | supported |
| `/variants`, `/thinking`, `/effort` | Agent | Opens current-session Thinking Level setting | none | supported |
| `/mcps` | Integration | Native MCP status/resources; read-only | none | supported |
| `/connect` | Integration | Provider/integration list; native API-key and OAuth connect; external/command methods blocked | none | partial |
| `/settings` | System | Opens browser Preferences | none | supported |
| `/status` | System | Reports real connection/project/session/model state | none | supported |
| `/themes` | System | Opens Light/Dark/System picker | none | supported |
| `/diff` | Session | Opens the working-tree inspector | none | supported |
| `/copy` | Session | Copies latest assistant text via browser clipboard when available | none | supported |
| `/rename` | Session | Opens a prefilled rename dialog with no arguments; arguments use the existing native update | optional title | supported |
| `/timeline` | Session | Native durable user-message timeline with bounded cursor paging, preview, and focused jump | none | supported |
| `/fork` | Session | Native boundary picker; creates a child only on explicit confirmation | none | supported |
| `/compact` | Session | Explicit model-consequence confirmation, then native compaction request | none | supported; model-triggering |
| `/undo` | Session | Native revert preview with file effects, then staged revert | none | supported; destructive |
| `/redo` | Session | Clear the staged native revert and restore messages/files | none | supported; destructive |
| `/export` | Session | Native JSON transfer download (no fake Markdown claim) | none | supported |
| `/btw` | Session | One-shot side answer from session context; no durable message or main-run steering | optional question | supported; model-triggering |
| `/cd` | Session | Absolute existing target validation and confirmed native session move | absolute directory | supported |
| `/editor` | Prompt | Opens a larger web draft editor, not a local OS editor | none | supported |
| `/skills` | Prompt | Native directory-scoped skill catalog; selected skills are sent only on explicit Send | none | supported |
| `/worktrees` | Project | Project-scoped native worktree list/create/refresh/remove | none | supported |
| `/terminal` | Terminal | Opens the existing Session inspector at its Terminal tab for the selected directory; explicit Create/Open only | none | supported |
| `/plugins` | System | Native installed plugin metadata; read-only | none | supported |
| `/stats` | System | Native experimental usage/session/tool/model statistics | none | supported |
| `/highlights` | System | Runtime content is embedded only in the TUI release, not exposed by HTTP | none | unsupported |
| `/update` | System | Web client cannot update server install | none | unsupported |
| `/pair`, `/web` | System | Pairing/auth is gateway/server concern | none | unsupported |
| `/restart` | System | Web client does not own service lifecycle | none | unsupported; destructive |
| `/reload` | System | Native `POST /api/location/reload` with confirmation and catalog refresh | none | supported |
| `/debug` | System | Sanitized client diagnostics; no server heap/config/env parity | none | partial |
| `/exit`, `/quit`, `/q` | System | Page cannot reliably close its tab | none | unsupported |

**Coverage:** **30 supported, 2 partial, 5 explicitly deferred** native names. This unit
intentionally returns gaps instead of faking TUI-only or operational behavior. Deferred by user
decision are `highlights`, `update`, `pair`/`web`, `restart`, and `exit`/aliases. `connect` and
`debug` remain partial on purpose: `/connect` supports native key/OAuth flows but external/command
methods are blocked and provider-specific loopback callbacks are not guaranteed; `debug` is client
diagnostics rather than full server-debug parity. No CLI-only command is claimed as a slash
command, and this is not 37-command parity.

## Verified session/prompt command adapters

Source: installed `@opencode/client` 2.1.4, live OpenAPI/schema, and archived native TUI command
handlers. These are exact native routes, not browser-local simulations:

| Native command | Native contract | Web behavior |
|---|---|---|
| `/rename` | `PATCH /api/session/{sid}` via client `session.update({title})` | Empty argument opens a modal prefilled rename dialog; arguments update directly. Cancel/blank sends no PATCH. |
| `/timeline` | `GET /api/session/{sid}/message?type=user&order=desc&cursor=…` | Loads a bounded newest page, searches loaded messages, loads older with the native cursor, previews the selected durable ID, then jumps/focuses that message. |
| `/export` | `GET /api/experimental/session/{sid}/export?sanitize=` | Fetches the native transfer, shows message count/byte size/privacy, and downloads a user-triggered `application/json` blob named from the session ID. It is **native JSON only**, not a reconstructed Markdown claim. |
| `/fork` | `POST /api/session/{sid}/fork` with optional `{before: messageID}` | Full-session or user-message boundary picker. Creates nothing until confirmation; selects the child only on success and keeps the origin session/draft. |
| `/compact` | `POST /api/session/{sid}/compact` | Confirms that a compaction request may run a model request; queues one native request only after confirmation. No test/live model call is made. |
| `/undo` | `POST /api/session/{sid}/revert/stage` `{messageID, files?}` | Previews the latest user boundary and the files recorded by later assistant snapshots, then stages one revert. Busy 409 stays in the dialog. |
| `/redo` | `DELETE /api/session/{sid}/revert` | Confirms restoring the staged native revert and file effects; no staged revert is a no-op/disabled state. |
| `/cd` | `GET /api/location?location[directory]=…`, then `POST /api/session/{sid}/move` | Requires an absolute, resolvable directory; Check resolves it first, then a separate confirmation moves the session. Browser defaults and the session draft are preserved; the selected project becomes the target project. |
| `/clear` | Native TUI home/workspace transition only | Client view reset: clears selected session/history from view, closes client overlays, but does not DELETE, Stop, or interrupt the underlying session/background work; session drafts remain keyed to the ID. |
| `/editor` | TUI local external editor integration | Opens a clearly labelled **Web draft editor** dialog with the pre-command draft, multiline editing, explicit Apply to current draft, and Cancel restore. It never launches an OS program or sends a prompt. |
| `/skills` | `GET /api/skill?location[directory]=…`, then prompt `skills` attachments | Loads the session-directory catalog, lets the user select/remove skills with visible composer chips, and sends `skills: [{id}]` only with an intentional Send. It does not start an agent/model call on selection. |
| `/btw` | `POST /api/session/{sid}/generate` with `{prompt}` | Opens a mobile Sheet/desktop Dialog; argumentless or with raw question. Explicit Ask only; uses the selected session model/agent/variant and the archived TUI instruction envelope. One-shot `generate` returns text without durable messages, tools, steering, queueing, or main-run interrupt. Answer is safely Markdown-rendered, copy is explicit, and closing pending aborts only the browser request with an unknown-server-completion label. |
| `/mcps` | `GET /api/mcp`, `GET /api/mcp/resource` | Read-only statuses, auth-needed/failed errors with native text hidden, and resources/templates. No add, remove, connect, or disconnect actions. Tools are not enumerated by this 2.1.4 status API; the UI says so. |
| `/connect` | `GET /api/integration`, `POST /api/integration/{id}/connect/key`, `POST /api/integration/{id}/connect/oauth`, OAuth status/complete/cancel | Native provider/integration selection and method selection on canonical HTTPS. API-key and OAuth flows are wired; status is confirmed by native response/poll, catalogs refresh, current session model is untouched. Keys live only in React state, are sent once, and are never in URLs/storage/logs. External and command methods are explicitly disabled with reasons. Marked **partial**, not universal provider-login coverage. |
| `/worktrees` | `GET/POST/DELETE /api/worktree`, `POST /api/worktree/refresh` | Project-scoped native inventory/create/refresh/remove. Create/remove are confirmed; remove has an explicit force option. The backend performs git/worktree operations; the browser never runs shell/git. |
| `/plugins` | `GET /api/plugin` | Read-only installed plugin metadata and state. No update check, install, update, or remove actions. |
| `/stats` | `GET /api/experimental/session/stats` | Native sessions/subagents/prompts/steps/tokens/tools/models/cost. Zero reported cost is labeled as possibly unknown, not free; no fabricated progress or estimates. |
| `/reload` | `POST /api/location/reload` | Confirmed global location rebuild; pending permissions/forms are cancelled, running sessions continue at the next boundary, catalogs refresh on success. It is not an OS service restart. |
| `/debug` | Client-side sanitized data | Fixed diagnostics whitelist (version/network/counts/state). No heap dump, environment, config, prompts, IDs, or secrets. Marked partial. |
| `/highlights` | TUI release runtime only | Unsupported: 2.1.4 does not expose the mounted highlights through HTTP; no current content was invented. |

Project command collisions keep **native built-in precedence**: a plain `/name` resolves to the
native adapter first, while the project command remains a separately labelled picker entry.
Selecting that entry records an explicit server-command choice, so the exact
`POST /api/session/{sid}/command` request still runs with the project command name.

## `/terminal` native PTY contract

The web adapter uses the installed 2.1.4 PTY contract, not a shell bridge invented by this client:

- `GET /api/pty?location[directory]=…` lists project terminals; `POST /api/pty` creates one only
  from an explicit user action, with `cwd` fixed to the selected session's real directory;
  `GET/PUT /api/pty/{id}` reads/updates title or `{cols,rows}`; `DELETE /api/pty/{id}` terminates.
- `POST /api/pty/{id}/connect-token` is called through the same-origin authenticated proxy with
  the native `x-opencode-ticket: 1` marker. It returns a short-lived ticket. The service Basic
  credential is held by the Vite dev proxy and is never put in browser code, a URL, the bundle,
  or logs.
- The browser opens a same-origin WebSocket to `/api/pty/{id}/connect?ticket=…&location[directory]=…`
  (plus a cursor only when the native protocol supplies one). It is not a raw backend port or a
  Basic-auth URL. The proxy upgrades `/api` WebSockets server-side, checks the canonical Origin
  before upgrade, and injects the held credential there. Private Tailscale Serve HTTPS is now
  deployed; there is no additional browser cookie/session auth by explicit approval.
- Server binary control frames (`0x00` + JSON `{cursor}`) update replay position and are not
  rendered. Terminal output strips OSC 52 clipboard writes and OSC 8 hyperlinks; no WebLinks
  addon, URL auto-open, or clipboard write from output exists. Copy/Paste are explicit user
  actions, with multiline paste confirmation.
- The Terminal tab lists PTYs on activation but connects only after explicit Open/Create. Switching
  tabs, closing the inspector, or changing session/project detaches the WebSocket without deleting
  the PTY; Terminate is a separate confirmed DELETE. Returning to the tab requires Open again and
  does not replay keystrokes. Reconnect obtains a fresh ticket and replays native output only.
  Header Refresh on the Terminal tab refreshes PTY list/metadata read-only and never creates,
  mints a ticket, auto-attaches, or reconnects.

The Terminal surface runs behind private Tailscale Serve HTTPS with canonical-origin/WS checks,
API path/method allowlisting, JSON mutation validation, and security headers. There is no
additional browser cookie/session authentication by design; the tailnet ACL is the access
boundary. This is **not** public/multi-tenant production auth.

## Dynamic `/api/command` catalog

Every entry returned for the active session directory is shown and executable generically
through the native command endpoint. This includes:

- core `init` and `review`;
- project/config custom commands;
- MCP prompt commands exposed by the server;
- plugin-added server commands.

The UI merges the complete returned catalog generically; it does not hardcode project, MCP, or
plugin command names beyond verified native built-ins.

The web picker does not hardcode their IDs beyond the verified built-ins and does not assume a
command implies model execution. Arguments are passed as raw text (quotes preserved), not shell
tokens. Attachments use the existing safe attachment/data-URI pipeline.

## CLI-only commands (documented, outside slash parity)

The current CLI docs list `run`, `mini`, `session`, `auth`, `models`, `mcp`, `plugin`, `stats`,
`serve`, `pair`, `service`, `reload`, `api`, `acp`, `debug`, `upgrade`/`update`, and `uninstall`
(with their subcommands). These are operational/CLI-local commands. Browser equivalents are not
claimed; auth, service, update, ACP, shell, MCP credentials, and CLI-only editor/clipboard
behavior remain unsupported or future scope.

## Unsupported and partial commands

| Gap | Source evidence | Requirement / severity | Safe web alternative | Current decision |
|---|---|---|---|---|
| `/highlights` | 2.1.4 mounts `app.highlights` only in the TUI runtime; no HTTP endpoint. | Release-specific content. **Low**. | Static release notes would need an approved source/version; none is exposed for 2.1.4 HTTP. | Unsupported; no content invented. |
| `/update` | No installation/update HTTP endpoint in protocol/server; update is installer/CLI operational behavior. | Engine install mutation. **High**. | None in this client. A web client cannot own engine updates without deployment approval. | Unsupported. |
| `/restart` | No server lifecycle API; service restart is OS/systemd ownership. | Service/OS lifecycle. **High**. | None; do not shell out or call systemd. | Unsupported. |
| `/pair`, `/web` | Native pairing endpoint exists. Private HTTPS transport and Origin/route guard are now deployed, but pairing-code semantics were not implemented and no code was minted. | Credential/session minting. **Medium security**. | Pairing is redundant for the approved tailnet trust model; if retained, implement only with verified native pairing contract and explicit user approval. | Unsupported; no codes minted. |
| `/exit`, `/quit`, `/q` | Browser cannot reliably close a tab/window; native action is TUI process exit. | UX/lifecycle. **Low**. | Could offer an explicitly labelled “return to home/detach” action, but that is not full `/exit` semantics. | Unsupported unless the user accepts the non-equivalent label. |
| `/connect` | Key/OAuth integration endpoints are implemented; external and command methods remain browser-unsafe/unimplemented, and provider-specific loopback callbacks may not work remotely. | Credential handling. **High security**. | Canonical HTTPS origin gate, ephemeral key state, safe OAuth URL allowlist, bounded polling/cancel, catalog refresh. No universal login claim. | Partial: key/OAuth support; external/command blocked. |
| `/debug` | TUI/server debug exposes broader process/heap/config data; client can offer only safe diagnostics. | Observability. **Medium/low**. | Whitelisted client diagnostics only; no heap or server internals. | Partial. |


## Limits

The client intentionally does not fake TUI-only/lifecycle behavior. Browser restrictions and
native gaps remain explicit; see the gap table above.
