# Native commands and web parity

The browser implements **34 supported built-in names + 7 supported aliases (41 commands)** in
native parity scope, with **0 partial and 0 unsupported in-scope commands**. A further **4 names
(`/editor`, `/update`, `/restart`, `/exit`) and 2 aliases (`/quit`, `/q`) are skipped** by user
decision; they stay visible in the picker with a reason but are not claimed as supported. Dynamic
server commands from `GET /api/command` are discovered and executed generically, so new server
commands need no UI release.

This parity is **browser-only over plain HTTP**, including non-loopback origins where
`window.isSecureContext === false`. All authenticated users get the same commands. The existing
app password gate and Host/Origin checks are retained; no extra per-command restrictions are
added. Unsupported or TUI-only behavior stays visible rather than being faked.

- Built-in inventory targets OpenCode **2.1.4**. `/usage` is added for the **2.3.2** capability and
  is version-gated at runtime (`>= 2.3.2`). `scripts/audit-slash-commands.ts` (`bun run audit:slash`)
  compares the local registry against upstream refs `v2.1.4` and `v2.3.2`.

## Web adapter rules

- A leading `/` in the composer is parsed by `parseSlashInput`, which mirrors the native TUI
  `parseSlashHead`: the name ends at the first space, tab, or newline; the single separator is
  dropped and the exact remaining text (repeated spaces, tabs, CRLF, quotes) is kept as raw
  arguments. Nothing is shell-evaluated.
- Exact name and alias matches rank above title/description matches in the picker, with native
  commands before server commands and deterministic category/name ordering after that.
- `/` opens a nonmodal anchored popover with a filtered list. ↑/↓ moves the highlight; Enter or
  **Tab** activates the highlighted item; Escape closes. Touch Enter keeps the composer's newline
  rule, so a touch user activates an item or presses Send. IME composition never submits.
- All explicit submit paths funnel through one slash-aware entry point (`submitActiveDraft`), so
  a leading-slash draft is dispatched as a command whether submitted by form, Enter, or Send. An
  unknown name is an explicit error with a **Send as literal message** action; it is never sent as
  a prompt by accident.
- Executing a **server** command sends `POST /api/session/{sessionID}/command` with
  `{name, text, files?, skills?}`. `text` is raw argument text; validated composer attachments are
  sent as `files`, selected skills as `skills: [{id}]`, and `delivery: "queue"` is added only while
  the session is running. Idle commands omit `delivery`. A stale directory catalog blocks execution
  and asks the user to reopen the command.
- Executing a **built-in** dispatches the matching local adapter; no arbitrary JS, plugin, OS, or
  shell command is evaluated in the browser.
- Project/config/MCP/plugin commands are inserted as `/name ` for argument entry, never run merely
  by highlight; an explicit activation or Send executes them.
- The project command catalog is scoped to the selected session directory, reloads on
  `command.updated` / `config.updated` and reconnect, and is cleared on project change.
- `/settings` opens the Settings workspace, not a dialog. Theme controls (Light/Dark/System,
  palettes, accents) live only in Settings → Appearance; no sidebar theme trigger or standalone
  picker is mounted.

## Native TUI slash inventory (34 supported names + 7 supported aliases)

| Native name / aliases | Category | Web behavior | Arguments |
|---|---|---|---|
| `/help` | System | Explains the picker and keeps it available | none |
| `/sessions`, `/resume`, `/continue` | Session | Opens the session/project navigator | none |
| `/new` | Session | Opens the New session dialog | none |
| `/clear` | Session | Returns to the empty client view without deleting or stopping the session | none |
| `/open`, `/projects`, `/project` | Session | Opens the session/project navigator | none |
| `/models` | Agent | Opens the current-session model settings | none |
| `/agents` | Agent | Opens the current-session Agent setting | none |
| `/variants`, `/thinking`, `/effort` | Agent | Opens the current-session Thinking Level setting | none |
| `/mcps` | Integration | Native MCP status/resources plus add/remove/connect/disconnect | none |
| `/connect` | Integration | Native provider connect with key, OAuth, external, and command methods over plain HTTP | none |
| `/settings` | System | Opens the Settings workspace (not a dialog) | none |
| `/status` | System | Native server info plus connection/project/session/model state | none |
| `/themes` | System | Theme controls live in Settings → Appearance | none |
| `/diff` | Session | Opens the working-tree inspector | none |
| `/copy` | Session | Revert-aware copy of the latest assistant text or completed compaction summary | none |
| `/rename` | Session | Prefilled rename dialog with no arguments; arguments rename directly | optional title |
| `/timeline` | Session | Native durable user-message timeline with preview, jump, and optional prompt restore | none |
| `/fork` | Session | Native boundary picker; creates a child only on explicit confirmation | none |
| `/compact` | Session | Model-consequence confirmation, then a native compaction request | none |
| `/undo` | Session | Native revert preview with file effects; pending cancel or staged revert with prompt restore | none |
| `/redo` | Session | Clears the staged native revert and restores messages/files | none |
| `/export` | Session | Native JSON transfer plus formatted Markdown, with copy/download | none |
| `/btw` | Session | One-shot side answer from session context; no durable message or main-run steering | optional question |
| `/cd` | Session | Changes directory; absolute, relative (`./`, `../`), and `~`/`~/` paths can be prefilled | optional path |
| `/skills` | Prompt | Native directory-scoped skill catalog; selected skills are sent only on explicit Send | none |
| `/worktrees` | Project | Project-scoped native worktree list/create/refresh/remove | none |
| `/terminal` | Terminal | Real xterm terminal backed by native PTY APIs and a same-origin WebSocket bridge | none |
| `/plugins` | System | Native installed plugin metadata with check and update | none |
| `/stats` | System | Native experimental usage/session/tool/model statistics | none |
| `/usage` | System | Native usage limits when the engine is at least 2.3.2 | none |
| `/highlights` | System | Real public changelog highlights for the running release, or an honest empty state | none |
| `/pair`, `/web` | System | Native pairing code issued through the paired server | none |
| `/reload` | System | Native location reload with confirmation and catalog refresh | none |
| `/debug` | System | Sanitized client and native server diagnostics; heap dumps denied | none |

Every entry above is **supported**; model-triggering commands (`/btw`, `/compact`) and destructive
commands (`/undo`, `/redo`) keep their explicit confirmations.

## Skipped commands (visible, not in parity scope)

| Native name / aliases | Reason | Web status |
|---|---|---|
| `/editor` | Native behavior launches a local OS editor; excluded from the source audit. The picker still offers a labelled browser-local draft editor, which is not native editor parity. | skipped |
| `/update` | A web client cannot update the server installation. | skipped |
| `/restart` | The web client does not own service lifecycle. | skipped |
| `/exit`, `/quit`, `/q` | A browser page cannot reliably close its tab/window. | skipped |

These entries render with their reason and never POST or trigger a model. The audit script excludes
exactly `editor`, `update`, `restart`, `exit` and aliases `quit`, `q`; all other upstream names and
aliases must be present in the local registry or `bun run audit:slash` fails.

## Session and prompt adapters

These are exact native contracts, not browser-local simulations:

| Native command | Native contract | Web behavior |
|---|---|---|
| `/rename` | `PATCH /api/session/{sid}` via `session.update({title})` | Empty argument opens a prefilled rename dialog; an argument renames directly. Cancel/blank sends no PATCH. |
| `/timeline` | `GET /api/session/{sid}/message?type=user&order=desc&cursor=…` | Bounded newest page, search loaded messages, page older with the native cursor, preview and jump to the selected durable message; optional checkbox restores its text to the composer. |
| `/export` | `GET /api/experimental/session/{sid}/export?sanitize=` | Fetches the native transfer, then offers exact pretty-printed JSON or a formatted Markdown transcript (user/assistant/tool sections, optional thinking/tools), with explicit copy/download. Filenames follow the selected format. |
| `/fork` | `POST /api/session/{sid}/fork` with optional `{before: messageID}` | Full-session or user-message boundary picker; creates nothing until confirmation, then selects the child on success. |
| `/compact` | `POST /api/session/{sid}/compact` | Confirms that compaction may run a model request; queues one native request only after confirmation. No test/live model call is made. |
| `/undo` | Pending `DELETE /api/session/{sid}/inbox/{inboxID}` or `DELETE /api/session/{sid}/revert` + `POST .../revert/stage` | Previews the latest user boundary and files recorded by later assistant snapshots. A still-pending message is cancelled with its text restored to the composer instead of staging a revert; otherwise the staged revert restores the prior prompt text. Busy conflicts stay in the dialog. |
| `/redo` | `DELETE /api/session/{sid}/revert` | Confirms clearing the staged native revert and restoring its files/messages; no staged revert is a disabled no-op. |
| `/cd` | `GET /api/location?location[directory]=…`, then `POST /api/session/{sid}/move` | Resolves absolute, relative, and `~`/`~/` arguments against the session directory (preserving `~` when home is unknown), with no role/safety gate; the native location lookup and move are authoritative. Check resolves, then a separate confirmation moves the session. |
| `/copy` | Native `messages.copy` selection | Copies the latest assistant text or the latest completed compaction summary, ignoring anything at or after a staged revert. |
| `/clear` | Native TUI home/workspace transition only | Client view reset only: no DELETE, Stop, or interrupt; drafts stay keyed to the session ID. |
| `/skills` | `GET /api/skill?location[directory]=…`, then prompt `skills` attachments | Select/remove skills with composer chips; `skills: [{id}]` is sent only with an intentional Send. |
| `/btw` | `POST /api/session/{sid}/generate` with `{prompt}` | Mobile Sheet/desktop Dialog; explicit Ask only, using the selected session model/agent/variant and TUI instruction envelope. One-shot text, no durable messages or steering. |

## System and integration adapters

| Native command | Native contract | Web behavior |
|---|---|---|
| `/mcps` | `GET /api/mcp`, `GET /api/mcp/resource`, plus `openCode.mcp.add/remove/connect/disconnect` | Statuses, resources/templates, and native add/remove/connect/disconnect with confirmations and sanitized native errors. |
| `/connect` | `GET /api/integration` plus native key/OAuth/external/command connect methods | All native auth methods are connectable over the current origin; keys stay in React state and are sent once, never in URLs/storage/logs. A plain-HTTP origin shows an explicit credential-risk notice. OAuth authorization URLs must still be absolute HTTPS. |
| `/worktrees` | `GET/POST/DELETE /api/worktree`, `POST /api/worktree/refresh` | Project-scoped inventory/create/refresh/remove with confirmations and explicit force on remove; the backend performs git operations. |
| `/plugins` | `GET /api/plugin` plus `openCode.plugin.check/update` | Installed plugin metadata with check and update confirmations. |
| `/stats` | `GET /api/experimental/session/stats` | Native sessions/subagents/prompts/steps/tokens/tools/models/cost; zero cost is labelled as possibly unknown. |
| `/status` | `openCode.server.info()` plus client connection state | Native version, PID, URLs and capabilities (secrets stripped), alongside connection/project/session/model state. |
| `/reload` | `POST /api/location/reload` | Confirmed global location rebuild; catalogs refresh on success. Not an OS service restart. |
| `/debug` | Sanitized client data + `openCode.server.info()` | Fixed diagnostics whitelist for client and native server details; `/api/debug` is not exposed through the browser and heap dumps remain denied. |
| `/pair` | `openCode.server.pair()` | Issues a native pairing code through the server. |
| `/highlights` | Public upstream `CHANGELOG.md` for the running release | Fetches and parses real public changelog highlights (capped at five) with credential-free, bounded requests; an empty list is reported honestly, never invented. |
| `/usage` | `GET /api/experimental/usage/limits?location[directory]=…` | Native usage limits, gated at engine version `>= 2.3.2`; unavailable below that version. Sensitive payload keys are dropped. |
| `/terminal` | Native PTY APIs + same-origin `/api/pty/{id}/connect` WebSocket bridge | See [Terminal](#terminal). |

Project command collisions keep **native built-in precedence**: a plain `/name` resolves to the
native adapter first, while the project command stays a separately labelled picker entry.
Selecting that entry records an explicit server-command choice, so the exact
`POST /api/session/{sid}/command` request still runs with the project command name.

## Notes: retired TUI commands, MCP prompts

The Notes package is no longer an OpenCode engine plugin. Its former TUI command surface is retired
and is not implemented in the web picker; do not claim notes slash commands. Notes are used from the
Notes workspace, or by agents through the Notes MCP server.

When the server is registered and connected from Settings → Plugins (an engine restart may be needed
first), its three prompts appear in the engine catalog and therefore in the generic command picker
like any other MCP prompt command. They render instructions; the agent then calls the notes tools.

| Prompt | Arguments | Intent |
|---|---|---|
| `notes:capture` | `title?`, `space?`, `status?` | Distill the current conversation into a durable note after checking for an existing related note. |
| `notes:daily` | `date?` (YYYY-MM-DD) | Find or create the Global "Daily" space and a note titled with the date, then append a dated summary section. |
| `notes:review` | `directory?` | Review pinned and active notes for the project, reconcile statuses, and append evidence before setting `finished`. |

Without the MCP registration these prompts are absent; there is no browser-local substitute.

## Terminal

`/terminal` is supported. Opening it creates or reuses a native PTY for the selected session
directory and mounts a real **xterm** terminal (loaded lazily so it stays out of the main bundle).
A fresh short-lived connect ticket is minted for each connect/reattach and placed in the query
string of a same-origin WebSocket URL: `/api/pty/{id}/connect`. The page protocol selects `ws://`
on HTTP pages and `wss://` on HTTPS pages; there is no HTTPS gate, so plain HTTP, including
non-loopback origins, works because the server bridge owns authentication.

`server/pty-websocket-bridge.ts` holds the engine Basic credential, rechecks Host/Origin before the
upgrade, forwards only the ticket query, strips browser-supplied credentials/subprotocols, and
enforces payload and backpressure limits. Upstream close reasons are not reflected; the browser
shows sanitized disconnect messages. Reconnect is an explicit **Reattach**, never an automatic
retry loop.

## Dynamic command catalog

The browser loads server commands with `openCode.command.list({ location })` against
`GET /api/command`; the response is `{ location, data }`, where `data` is the command array for that
directory. Every entry is shown and executed generically through the native command endpoint. This
includes core `init` and `review`, project/config custom commands, MCP prompt commands, and
plugin-added server commands. New server commands work without a UI release.

Built-in TUI actions are **not** returned by `GET /api/command`; they remain a client-local,
source-audited registry in `src/lib/commands.ts`. `scripts/audit-slash-commands.ts`, run with
`bun run audit:slash` (or `bun test tests/upstream-command-audit.test.ts`), compares that registry
to upstream TUI slash definitions at `v2.1.4` and `v2.3.2`, excluding the six skipped names/aliases
above. It is a release-gate helper, not runtime code.

Arguments for server commands are passed as raw text (quotes preserved), not shell tokens.
Attachments use the existing safe attachment/data-URI pipeline.

## CLI-only commands (documented, outside slash parity)

CLI docs list `run`, `mini`, `session`, `auth`, `models`, `mcp`, `plugin`, `stats`, `serve`, `pair`,
`service`, `reload`, `api`, `acp`, `debug`, `upgrade`/`update`, and `uninstall` (with their
subcommands). These are operational/CLI-local commands; browser equivalents beyond the adapters
above are not claimed.

## Limits

The client does not fake TUI-only or lifecycle behavior. Skipped entries are shown with their reason
and never POST or trigger a model; see the skipped table above. Adapter dialogs require the normal
session/directory context and keep native confirmations for model-triggering, destructive, and
credential/operation-changing actions. Live model, credential, pairing, and PTY sessions are not
verified by the synthetic checks.
