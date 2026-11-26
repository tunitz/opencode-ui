# OpenCode V2 contract

This document records the native OpenCode V2 target and the app-layer security/API contracts the
client relies on. OpenCode owns backend behavior; this client does not edit or fork it.

Current target is OpenCode **2.1.4**. The API, file, artifact, notification, and auth rules below
are intentional; do not weaken them when simplifying UI code.


## Target [runtime]

- OpenCode **2.1.4**; the engine is a separate HTTP service. The UI server is the only
  browser-facing origin and injects the saved engine password when configured. No engine URL
  or profile is created at startup. The user sets the engine origin during connection setup.
- The engine password is required and separate from the UI password. After entry the engine
  password is kept server-side and never printed, persisted in browser storage, or returned in
  responses. Engine registration files are not read.
- The engine API is not a frontend review URL. Network isolation of the engine listener is outside
  this client and requires separate approval.

## Auth, CORS, and spec [runtime] [source] [spec]

- On a password-protected engine, unauthenticated `/api/*` and `/openapi.json` return **401**.
  New connections use Basic auth with username `opencode` and the supplied engine password.
  When an older profile has no password, edit it to supply the engine password.
- **CORS is origin-allowlisted, not absent** [source `packages/server/src/cors.ts:11-25`]:
  no-Origin requests, `http://localhost:*`, `http://127.0.0.1:*`, `oc://renderer`, Tauri
  origins, `https://*.opencode.ai`, and configured `cors` are allowed.
- The same-origin gateway is required by the app's security contract (hold the Basic credential
  server-side), not because CORS is absent. Do not weaken Origin/CSRF checks. Engine-side
  allowlists are not a substitute for the app-layer boundary.
- `/doc` is an SPA, not the spec. The OpenAPI document has **no `securitySchemes`**; auth
  is middleware-enforced. `/openapi.json` serves OpenAPI **3.1.0**; its key-sorted schema matches
  the official OpenCode v2 spec at `https://opencode.ai/v2/openapi.json`.

## Access boundary assumptions

- The UI server is the browser-facing origin and holds the Basic credential server-side. It injects
  the credential for HTTP and WebSocket upstream requests and strips browser-supplied
  `Authorization`. No secret enters client code, URLs, bundles, or logs.
- Request guard: Host allowlist; exact Origin allowlist; WebSocket Origin checked before upgrade;
  unknown/missing unsafe origins rejected for mutations/WS; API path/method allowlist; JSON
  content-type for bodied mutations; security headers; no wildcard CORS; API
  `cache-control: no-store`; SSE remains `no-cache, no-transform`. A non-loopback bind with no
  explicit trust values derives exact trusts from this host's private IPv4 addresses and matching
  `http://<address>:<port>` origins (`server/trusted-origins.ts`). An explicit `--allowed-origin`
  also trusts its hostname; an explicit non-loopback `--allowed-host` derives a matching HTTP origin.
  Public/CGNAT addresses and custom HTTPS proxy names require explicit values. The checks are never
  wildcarded or disabled.
- **Browser access gate:** a shared UI password gates `/api/*` (HTTP and WebSocket upgrades)
  whenever a password is configured or the bind host is non-loopback. Loopback with no password
  stays pass-through. It is one shared credential, not multi-tenant isolation.
- **Commands work on plain HTTP, including non-loopback origins.** All built-in and server slash
  commands are available to every authenticated user with no extra per-command roles and no secure-
  context requirement; `window.isSecureContext === false` is a supported state. The app password
  gate and Host/Origin checks are unchanged. Plain HTTP means provider keys, pairing codes, and
  terminal traffic traverse an unencrypted origin: use secure transport behind the UI for real
  credential protection. Allowlists are not encryption.
- `/connect` uses the native key, OAuth, external, and command methods on the current origin. Keys
  live only in React state, are sent once, and never enter URLs, storage, or logs; OAuth
  authorization URLs must still be absolute HTTPS. Live credential/OAuth/pairing flows are not
  verified by the synthetic checks.
- `/api/pair` is allowlisted behind the same Host/Origin/JSON guards for native pairing codes.
  `/api/debug` is not exposed through the browser; `POST /api/debug/heap-dump` remains explicitly
  denied (403) as defense in depth because heap dumps can contain credentials and transcript data.
  `/debug` uses `GET /api/info` plus sanitized client data instead.
- `/terminal` bridges a same-origin WebSocket at `/api/pty/{id}/connect` — `ws://` on HTTP pages and
  `wss://` on HTTPS pages, with no HTTPS gate. The bridge owns the engine credential, rechecks
  Host/Origin on upgrade, forwards only the short-lived connect-ticket query, drops browser
  credentials and subprotocols, and enforces payload/backpressure caps. The browser never sees the
  engine credential.
- **Notes are an app-layer API, not a general browser proxy:** `POST /api/ui/notes/<method>` exposes
  only the fixed method list below. `/api/rpc/opencode-notes/*` and `NOTES_RPC_PATHS` were removed;
  no plugin RPC route remains.
- The gateway is not network isolation. The engine endpoint is separate and must be protected
  independently.

## Browser access gate [app layer]

State is file-backed at `~/.local/share/opencode-ui/auth/state.json` (override
`OPENCODE_UI_AUTH_STATE`), directory `0700`, file `0600`, atomic temp+rename. It contains an argon2id
password hash (`Bun.password`) and SHA-256 session-token hashes; passwords and raw tokens are never
persisted or logged. Passwords are 8–256 characters. Sessions last 30 days, are capped at 20, and are
pruned on each auth write.

- Cookie: `opencode_ui_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, with
  `Secure` only when the request URL is HTTPS. Plain HTTP is supported and simply omits `Secure`;
  protect that origin with transport/network controls. `OPENCODE_UI_SESSION_COOKIE` overrides the
  cookie name; keep the default unless running another UI instance on the same host, because cookies
  are host-scoped and ignore port numbers.
- The UI server requires an access password on every bind, including loopback.
- Every path starting with `/api` requires a valid session cookie, including SSE and
  WebSocket upgrades, except `/api/ui/auth/status`, `/api/ui/auth/setup`, `/api/ui/auth/login`, and
  `/api/ui/auth/logout`. Static/SPA paths and `/openapi.json` are not gated.
- Unauthorized API response: **401** JSON `{ "error": { "code": "auth_required" } }`, or
  `setup_required` when no password exists but one is required. Unauthorized WebSocket upgrades get
  a bare 401. All responses keep the shared security headers.
- Login throttling: per remote IP, 10 failed attempts per 60 seconds → 429 `too_many_attempts`, plus a
  250 ms delay per failure.

| Method and path | Body | Result |
|---|---|---|
| `GET /api/ui/auth/status` | none | `{ configured, required, authenticated }`; `authenticated` is true for a valid session. |
| `POST /api/ui/auth/setup` | `{ password }` | 200 `{ ok: true }` + session cookie; 409 `already_configured`; 400 `invalid`. |
| `POST /api/ui/auth/login` | `{ password }` | 200 `{ ok: true }` + session cookie; 401 `invalid_credentials`; 409 `not_configured`; 429 `too_many_attempts`. |
| `POST /api/ui/auth/logout` | none | 204, clears the cookie, removes the session server-side. |
| `PUT /api/ui/auth/password` | `{ current, next }` | 200 `{ ok: true }`; 401 `invalid_credentials` or `auth_required`; 409 `password_required` when `next: ""`. Changing the password keeps the current session and invalidates others. |

Auth bodies are JSON objects limited to 8 KiB; failures use `{ "error": { "code" } }`. The UI fetches
status once at boot and re-fetches it after sign-in; it does not poll. Mid-session `auth_required` /
`setup_required` responses from UI-owned `/api/ui/*` routes re-show the auth screen. A 401 from
the generic engine proxy does not: engine credential failures stay in the calling surface instead
of blinking the whole app into the password gate.

## UI host environment [app layer]

- `GET /api/ui/environment` → `200 { homeDirectory }`, read-only and `no-store`. It reports the
  UI host's home directory (or `OPENCODE_UI_SESSION_HOME`) for the New Session folder default; it
  contains no credentials or engine state.

## Sources beyond the engine API [app layer]

Most browser-facing data is proxied from the engine API. The known exceptions, detailed in their
own sections, are:

- Notes storage and the Notes change stream (`/api/ui/notes/*`) are served locally; enabling the
  Notes MCP server writes `mcp.servers.notes` into the engine's global config through an atomic
  JSONC edit.
- Legacy notes are imported once from the engine SQLite `kv` table, read-only
  (`OPENCODE_ENGINE_DB_PATH`); that database is never written.
- Artifacts are delivered from verified local files through opaque `/api/ui/artifacts/*` and
  `/api/ui/project-artifacts/*` capabilities; no engine configuration is changed.
- `GET /api/ui/environment` reports the UI host home (or `OPENCODE_UI_SESSION_HOME`) for the New
  Session default.
- `/highlights` fetches the public upstream changelog from GitHub with a credential-free, bounded
  request; it is not an engine API call.

## App-layer Engine Connections API [app layer]

Mounted under `/api/ui/connections` before the generic engine proxy; body limit 16 KiB. Saved
profiles live in `~/.local/share/opencode-ui/connections.json` (or `OPENCODE_UI_CONNECTIONS_STATE`)
with directory mode `0700` and file mode `0600` (atomic temp-file + rename). With no profiles,
engine-dependent routes return 503 and the authenticated home screen links to Settings → Connections.

- `GET /api/ui/connections` → `{ activeId, active, profiles, suggestedEngineUrl? }`. With no
  profiles, `activeId` and `active` are null. The optional suggestion comes from `--engine-url`.
  Each summary contains `{ id, name, engineUrl, hasPassword, isRemote, unencryptedRemote, isActive, createdAt, updatedAt }`.
- `POST /api/ui/connections` → verifies the required password and saves
  `{ name, engineUrl, password, activate? }` (max 32 profiles). On success, returns 201 with the state
  and created `profile`; the first profile is activated. A failed engine check returns 422
  `engine_connection_failed` without saving.
- `PUT /api/ui/connections/:id` → updates a profile. Omit `password` to keep it at the same origin.
  An empty password is rejected. Changing the origin while omitting a saved password is rejected
  with 400 `credential_required_for_url_change`. Changed credentials are verified before saving.
- `DELETE /api/ui/connections/:id` → deletes an inactive profile or the last profile. Switch
  away from an active profile before deleting it if other profiles are saved.
- `POST /api/ui/connections/:id/activate` → resolves credentials, switches the live proxy, PTY
  WebSocket bridge, notifications watcher, artifact delivery, and plugins API, and persists
  `activeId`.
- `POST /api/ui/connections/test` → probes `GET <engineUrl>/api/info` (`redirect: "manual"`,
  `proxy: false`, 5 s timeout) and returns `{ ok, reachable, authenticated, status, version, latencyMs, unencryptedRemote, error }`. Reusing a saved password via `profileId` is allowed only when `engineUrl` matches that profile's saved origin.

## App-layer Notes API [app layer]

One `NotesService` instance per UI-server process, backed by the shared file store. Mounted under
`/api/ui/notes/*` before the generic engine proxy.

- `POST /api/ui/notes/<method>` where method is one of `list`, `get`, `create`, `update`, `delete`,
  `search`, `history`, `restore`, `spaces`, `createSpace`, `updateSpace`, `deleteSpace`,
  `createAttachment`, `readAttachment`, `deleteAttachment`. The JSON body is the service input and may
  include `directory` for scoping. Success is 200 with the service output object (for example
  `{ notes, total }`).
- Mutations must use a JSON content type; otherwise the response is 415 with code `invalid`.
- Body limit is 1 MiB, except `POST createAttachment`, which allows 8 MiB. Oversized bodies are
  rejected with 413 by the dispatcher. Notes attachments have their own store-level limits
  (4 files, 4 MiB each, 8 MiB total per note), separate from prompt attachments below.
- Errors: `invalid` → 400, `note_not_found` / `space_not_found` / `snapshot_not_found` /
  `attachment_not_found` → 404, `revision_conflict` / `space_not_empty` → 409, `limit_exceeded` → 413,
  `mime_rejected` → 415, anything else → 500. Body `{ "error": { "code", "message" } }`.
- `GET /api/ui/notes/events` is an SSE stream (`text/event-stream`, `no-cache, no-transform`). It
  sends `event: changed` with `data: {"at":<epochMs>}` for in-process mutations and for filesystem
  changes under `notes/`, `spaces/`, and `attachments/` (250 ms debounce), plus a 30-second
  `event: heartbeat` keep-alive. There is no replay; clients refetch.
- `/api/ui` remains an allowed API prefix in request security. `NOTES_RPC_PATHS` and its POST/JSON
  special cases are removed.

## App-layer Plugins API [app layer]

Mounted under `/api/ui/plugins`; body limit 8 KiB. The UI server uses the server-held engine Basic
credential and never exposes it to clients. A trusted descriptor registry covers the built-in
`notes` plugin. Registration persists in the engine config file's `mcp.servers.<id>`
(atomic JSONC edit), so it survives engine reloads; hot-connecting the running engine is best-effort
and an engine restart may be required.

- `GET /api/ui/plugins` → `{ engineAvailable, plugins: [{ id, name, description, configured, installed, registered, connected, restartRequired, engineSynced }] }`.
  `registered` is read from the config: `mcp.servers.<id>` exists, is not `disabled: true`, and the
  entry (plus each descriptor's required runtime files) is installed in this build. `connected`
  comes from `GET <engine>/api/mcp` and additionally requires the entry to be installed; when the
  engine is unreachable the response is 200 with `engineAvailable: false` and `connected: false`,
  while a persisted registration still reports `registered: true`. `restartRequired` is
  `registered && !connected`.
  `engineSynced` is the residual: `true` when the engine's server list agrees with the persisted
  config (entry present when configured, absent when not), `false` when it diverges, and `null` when
  the engine is unreachable or its list shape is unknown. A config read failure → 500
  `{ error: { code: "config_read_failed" } }`.
- `POST /api/ui/plugins/<id>/enable` → sets `mcp.servers.<id>` to the descriptor's canonical entry.
  For Notes that is
  `{ "type": "local", "command": ["<bun executable>", "<repoRoot>/plugins/notes/src/mcp/main.ts"], "disabled": false, "codemode": false }`.
  The bun executable is the UI server's own `process.execPath`, so the engine never depends on PATH.
  The plugin's entry file must exist in the installation root, matching what `GET` reports as
  `installed`; otherwise 409
  `{ error: { code: "plugin_not_installed" } }` and nothing is persisted.
  The global config directory follows `$OPENCODE_CONFIG_DIR` → `$XDG_CONFIG_HOME/opencode` →
  `~/.config/opencode` (this still applies to the Notes MCP registration after removal of the
  agent-config editor); `opencode.jsonc` is preferred when present, else `opencode.json`. The edit
  keeps all other keys, servers, and comments (`jsonc-parser`) and is written atomically (private
  temp file, fsync, rename, directory fsync). A config write failure → 500
  `{ error: { code: "config_write_failed" } }` and the engine is not touched. The whole settle pass
  is ordered by the in-process queue; the cooperative config lock covers only the atomic edit and is
  released before any engine call, so a slow engine cannot starve another plugin or process. After
  the lock is released the server re-reads the persisted entry and performs exactly one reconcile:
  an enabled entry is applied with `PUT /api/experimental/mcp/<id>` (and
  `POST /api/experimental/mcp/<id>/connect` when not connected), and a disabled entry is
  compensated with `DELETE /api/experimental/mcp/<id>` only when the engine still lists it. The
  reconcile is bounded as a whole; a spent budget or failed call is reported from the last status
  read, never assumed. That hot registration is ephemeral, so the config write is authoritative;
  the response is `{ registered, connected, restartRequired, engineSynced }` computed from the
  authoritative re-read, even when the engine is unreachable or rejects the apply. A concurrent
  writer in another process can still change the config between the lock release and the reconcile;
  that divergence is reported, not hidden.
- `POST /api/ui/plugins/<id>/disable` → removes `mcp.servers.<id>` with the same atomic JSONC edit
  (a missing key or file is success; a missing config directory is not created) and compensates the
  engine through the same ordered reconcile. Response `{ registered, connected, restartRequired,
  engineSynced }`: `engineSynced` is `false` when the engine still lists the entry, and `null` when
  an unreachable or timed-out engine cannot confirm removal, so the ephemeral entry may survive
  until the engine reloads. `GET` reports the same residual, and the Settings UI surfaces it with an
  "Engine out of sync" chip instead of showing a bare "Connected" next to an Enable action.
- A divergent Notes disable (`registered: false` while `engineSynced: false`) is treated as
  unknown by `src/lib/notes-plugin-state.ts`: the Notes surfaces stay visible while Settings
  explains the pending engine removal. Notes are hidden only on a definitive disabled answer, and
  transport, HTTP-shape or missing-entry failures also stay unknown rather than hiding them.
- The in-process queue and cooperative lock waits are bounded from request arrival; exceeding the
  bound returns 500 `config_write_failed` without touching the config or the engine. A held lock is
  never reclaimed automatically, and the error names the lock file for manual recovery.
- Engine list shape is `{ location, data: [{ name, status }] }`, where `status` is
  `{ status: "connected" | "pending" | "disabled" | "failed" | "needs_auth" }`. The UI treats only
  `connected` as connected; a registered non-connected server surfaces `restartRequired`.
  `disabled: false` means enabled.
- `codemode: false` is required so each notes tool call renders as a real tool row.

## Dispatch order [app layer]

The gateway applies the auth gate to HTTP requests and WebSocket upgrades before dispatch; denied
upgrades receive a bare 401. Within `web-dispatch.ts` the order is: request security, auth endpoints,
Notes API, Plugins API, session shortcuts (`/api/ui/session-shortcuts`), notifications,
artifacts (`/api/ui` fallback), engine proxy (`/api*` and `/openapi.json`), then static frontend
assets. `/api/pair` is an allowlisted native prefix that flows through the same engine proxy and
guards; `/api/debug` is rejected by request security, including the heap-dump endpoint. Notes and
Plugins branches are skipped when those services are not installed. Notes events and
`/api/event` disable the request timeout. The former `/api/ui/agents` and `/api/ui/agents/default`
file-editor endpoints are removed and explicitly answer 404; no app-layer agent-config editor
remains.

## API contract [source/spec; runtime exercised only for info, spec, auth, SSE]

- **SSE:** `GET /api/event` is global and **volatile**: no replay, no location filter, and
  a slow consumer overflows. Actual frames are `data: {json}` [source
  `packages/server/src/event-feed.ts:29-31`]. Ordinary payloads carry `id`, `type`, `data`,
  `created`, optional `location`/`metadata`, and durable events add
  `durable {aggregateID, seq, version}`; `server.connected` is emitted with only
  `id`/`type`/`data`, no `created`/`location` [source
  `packages/server/src/handlers/event.ts:13-20`]. The OpenAPI `V2Event` union advertises a
  wider envelope, so do not assume `created` on every frame. V2 session events keep
  `sessionID` inside `data`. There is no `event:` field.
- **Ordering:** subscribe/correlate before prompting. Filter by `location.directory` /
  `sessionID`, correlate inbox/message/execution IDs, and handle events that arrive before
  the prompt response without dropping them.
- **Prompt:** `POST /api/session/{sessionID}/prompt` with
  `{text, id?, files?, agents?, skills?, metadata?, delivery?: steer|queue, resume?}`
  returns `{data: Session.Inbox.User}` — durable admission, **not a stream**.
- **Pending inbox:** `GET /api/session/{sid}/inbox` returns only still-pending
  `SessionInboxInfo` items (user/synthetic/compaction/move), ordered by the backend’s
  enqueued sequence. `PATCH /api/session/{sid}/inbox/{inboxID}` with exactly
  `{delivery: "steer" | "queue"}` changes delivery (204; 409 conflict when no longer
  pending); `DELETE .../inbox/{inboxID}` cancels (204; the server maps an internal
  conflict to 204, so a successful no-op can mean already delivered; session 404). Live
  `session.inbox.enqueued|delivered|cancelled|delivery.changed` events carry exact inbox
  ids. Prompt `delivery` is only for an active run; an idle/first prompt omits it. The
  client must not reorder pending items or treat cancel as Stop.
- **Parent/child sessions:** `SessionInfo.parentID` is the native subagent relation;
  `GET /api/session?parentID={sid}` lists direct children (with cursor), and
  `GET /api/session/{sid}` resolves a session directly. The native subagent tool’s
  structured metadata may carry a child `sessionID`, but child text/plain output must not
  be parsed as a tree. Tree discovery is bounded by explicit depth/call/node caps; report
  incomplete/truncated trees rather than claiming an arbitrary full tree.
- **Filesystem (client read-only):** `GET /api/fs/list?location[directory]=<abs>&path=<relative-or-abs>`
  returns `FileListOutput` `{ location, data }`, where `data` is the entry array
  (`{path, type: "file"|"directory"}`); returned paths stay relative to the requested location.
  `GET /api/fs/find?location[directory]=<abs>&query=...&type=file&limit=...`
  returns ranked entries. `GET /api/fs/read/<wildcard>?location[directory]=<abs>` streams raw bytes
  with ETag/Last-Modified and single-range support. The client requests a bounded first range and
  never uses `POST /api/experimental/fs/write`, and the app exposes no file-editor endpoint. The
  server's location scope is authoritative; the client also rejects absolute/traversal paths,
  encodes every segment, and claims no new security boundary beyond backend auth.
- **Diffs:** `GET /api/session/{sid}/diff?from=<userMessageID>&to=<userMessageID>&context=N`
  returns `FileDiffInfo[]` (`file`, `patch`, `additions`, `deletions`, `status`) for a native
  session turn; omitting `from` uses the newest user turn. `GET /api/vcs/diff?location[directory]=<abs>&mode=working&context=N`
  returns the VCS HEAD-to-working-copy diff, a different scope. The inspector shows only the working
  tree and never fabricates patches from assistant prose.
- **Prompt attachments:** prompt input `files` is `{uri, name?, description?, mention?}`; `uri` is
  either a canonical `data:<mime>;base64,...` URL or a local `file:` URI. The installed 2.1.4
  server materializes it into public `PromptFileAttachment` `{data (base64), mime, source,
  name?, ...}`, accepts at most 20 MiB, normalizes supported images, and rejects unsupported
  URI schemes. The client (`src/lib/attachments.ts`) deliberately leaves attachment count and
  size unbounded and validates MIME support against `ModelInfo.capabilities.input` (`text`,
  `image`, `pdf`, ...); it rejects SVG, unknown binary, and remote URLs and never fetches a
  user-supplied URL. The 20 MiB engine cap is distinct from provider/model acceptance, which is
  checked separately; no broad claim is made about which model/type combinations succeed. The UI
  accepts a file-only prompt when the native prompt schema permits empty text with files.
- **Sessions/location:** `GET /api/session?directory=/abs/path&project=id`;
  `POST /api/session` with `{location: {directory}, agent?, model?: {id, providerID,
  variant?}, ...}`. Use query/body location as the primary contract. The undocumented
  `x-opencode-directory` header exists as a URL-decoded **fallback** in
  `packages/server/src/location.ts:71-78`; do not claim it is absent or rely on it first.
  Session routes resolve the session's own location.
- **History/state:** `GET /api/session/{sid}/message` takes a query `cursor` and returns
  `cursor.next`/`cursor.previous`; `GET /api/session/active` returns
  `{data: Record<sid, {type: "running"}>}`; `GET /api/session/{sid}/context` returns
  current context.
- **Stop:** `POST /api/session/{sid}/interrupt?resume=true|false` returns
  `{interrupted: boolean}` (`resume` is a query string, not a JSON boolean). A browser
  abort is not a stop.
- **Permissions:** `GET /api/permission/request?location[directory]=/abs` lists pending;
  `POST /api/session/{sid}/permission/{requestID}/reply` with
  `{decision: once|always|reject, message?}`. Source semantics
  [`packages/core/src/permission.ts:290-313`]: `always` persists **project-scoped**
  action + patterns only when `request.save` is non-empty; it may then resolve other
  pending matching asks in that project, including other sessions. With no/empty `save`,
  `always` behaves like once and persists nothing. UI must show literal patterns/scope
  (`*` = all resources for that action in the project, not global) and hide or disable
  `Always allow` when unsavable; no separate settings UI is added. Not runtime-exercised.
- **Forms:** `GET /api/form?location[directory]=...` and
  `GET /api/session/{sid}/form`; `POST /api/session/{sid}/form/{formID}/reply` with
  `{answer: {key: value}}`; `DELETE /api/session/{sid}/form/{formID}?message=...` cancels.
  Fields are string, number, integer, boolean, multiselect, or external; `when` rules are
  ANDed and inactive fields are neither required nor answerable
  [source `packages/schema/src/form.ts:28-39`]. External fields carry an out-of-band `url`;
  the answer is acknowledgement `true` [source `packages/core/src/form.ts:235-255`].
  Cancel is allowed only while pending and is not restricted by external fields. Global
  MCP elicitation forms use `sessionID: "global"` and need the location fallback
  [source `packages/server/src/middleware/form-location.ts:24-33`,
  `packages/client/src/solid/data.ts:164-171`]. Form events are ephemeral/live-only.
  Not runtime-exercised.
- **Reconnect:** refetch durable messages/inbox, active state, and pending permissions/
  forms. Text/reasoning/tool-input deltas, `tool.progress`, and permission/form events are
  live-only. `session.step.streamed` is a **durable boundary marker** with
  `assistantMessageID`, not a fragment [source `packages/schema/src/session-event.ts:349-358`].
  Ended/full content is durable, but the global SSE remains volatile and does not replay.
- **Models/agents:** `GET /api/model`, `/api/model/default`, `/api/agent` require
  `location[directory]`; set via `POST /api/session/{sid}/model` with `{model}` and
  `/agent` with `{agent}`. New-session and composer agent/model/variant choices come from these
  engine catalogs at the destination (target) session location, not from a local config editor;
  variants are the ones reported by the model entries.
- **Experimental log:** `GET /api/experimental/session/{sid}/log?after=seq&follow=true`
  is implemented in v2.1.4 source [source `packages/core/src/session.ts:179-183`,
  `packages/server/src/handlers/session.ts:581-589`, protocol
  `packages/protocol/src/groups/session.ts:665-682`]: it replays durable events after an
  exclusive `seq` and can continue live. It is **not runtime-exercised** and is optional/
  experimental — not a guaranteed replay transport.

## Native assistant/tool file output

The actual client schema exposes assistant/tool file bytes as structured content, not as message
prose:

- `SessionMessageAssistantTool.state` is `streaming | running | completed | error`;
  `SessionMessageToolStateCompleted.content` is a non-empty `ToolContent[]`, and
  `SessionMessageToolStateError.content` is optional (`@opencode/client@2.1.4`,
  `dist/promise/generated/types.d.ts`).
- `ToolContent = ToolTextContent | ToolFileContent`, tagged by `type`.
  `ToolFileContent = { type: "file"; uri: string; mime: string; name?: string | null }`.
- Live `session.tool.success` carries the same tagged array at `data.content`; failed tools may
  carry `data.content` as partial output. Archived `packages/schema/src/tool.ts` confirms the
  schema. Archived `packages/ai/src/protocols/meta-responses.ts` and
  `packages/ai/test/tool-runtime.test.ts` show the canonical inline `data:${mime};base64,...`
  form, plus `https://` and `file:///` references. Archived
  `packages/plugin-browser/src/tools.ts` shows a browser plugin can return files; **this is not
  evidence that the live target has an enabled browser/screenshot tool or that a given agent can
  call one.**

`PromptFileAttachment` is a separate user-upload path. The UI never derives an artifact from
arbitrary assistant prose, a bare filepath, an external harness transcript, or browser-claimed
provenance. It may request an app-layer resolution for a file-like assistant Markdown link, but
only the server can approve it:

- `POST /api/ui/artifacts/resolve` accepts `{sessionID, href}`. It fetches the native session's
  message history server-side (read-only), scans **tool text content only**, requires the exact
  href/URL to occur in a tool output and a regular local path with the same basename in that same
  tool output, then validates that path against exact configured artifact roots. Tool-text path
  candidates may use any absolute prefix; only realpath-confirmed files inside those exact roots
  are served. The browser never submits a path.
- Direct-server default root: `/tmp/opencode/shots`; the CLI starts with no roots unless
  `--artifact-root` or `OPENCODE_UI_ARTIFACT_ROOTS` is supplied. Realpath must remain inside a
  root. Symlink escape, secret-like names, non-regular files, `/dev`/`/proc`, active HTML/SVG,
  unknown MIME, null/backslash/UNC-style paths, and files <=0 or >32 MiB are rejected. MIME is
  sniffed from bytes (PNG/JPEG/GIF/WebP/AVIF/PDF/text/binary).
- Approved artifacts get an opaque in-memory ID and `/api/ui/artifacts/<id>` (no path query).
  TTL is 15 minutes/capped entries; deleted or file-changed entries return 404. Reads support
  `HEAD` and single-byte `Range` (206/`Content-Range`, invalid 416), stream from disk, set
  `private, no-store`, `nosniff`, same-origin CORP, and `sandbox; default-src 'none'`. Images are
  inline with sanitized filenames; explicit download uses attachment disposition. No redirects,
  no wildcard CORS, no remote fetch, and no engine/backend edit.
- Existing request security owns `/api/ui` exact prefix. Foreign/missing Origin on resolve is
  403, cross-site fetches are blocked, JSON content-type is required, unknown `/api/ui` routes are
  app-layer 404s, and the rest of `/api` remains proxied only through the existing allowlist.

`Tool.FileContent` `data:` images/PDF/text/binary remain the primary structured path; credential-
free `https:` Tool.FileContent remains an explicit no-prefetch link. `file:`/local `Tool.FileContent`
paths remain unavailable unless the same verified-root link route approves them (it currently
derives from tool text, not a bare Tool.FileContent URI). Active HTML/SVG, raw base64, MIME
mismatch, malformed/missing URI, >8 MiB inline content, and traversal/unsafe names remain rejected.
Previews cap image thumbnails at 2 MiB and text at 256 KiB; route text previews read a bounded
byte prefix and cancel the response even if the upstream ignores Range. PDF uses the existing local bounded
PDF.js canvas or the same-origin route URL. Download is explicit and uses exact validated bytes
and a sanitized filename; temporary object URLs are revoked, and previews never use object URLs.

## Automatic project attachments [app layer, synthetic verification only]

- Separate from the existing approved-root/tool-provenance route above:
  `POST /api/ui/project-artifacts/resolve` accepts JSON `{sessionID, messageID, href}` and
  returns `{data:{id,url,name,mime,size,kind,toolName,canonicalId}}`. Errors distinguish
  `403 outside` (lexically outside/unsafe path) from `404 unavailable` (unproven link,
  incomplete/failed/interrupted turn, missing file, engine denial, or upstream failure).
- The server reads authoritative native history in durable sequence order, follows pagination
  through the final empty page, and requires an actual Markdown link (including reference
  links, excluding image/code/prose-only references) in the final assistant message of a
  succeeded idle-delimited turn. That assistant must have `finish: stop`, completion time,
  and no error. Steered prompts do not start a separate turn; shutdown without idle does not
  qualify. Browser-claimed text/path/location is never authoritative.
- Links may be project-relative or absolute inside the session directory. External/file URLs,
  UNC/backslash/control paths, traversal segments (including percent-encoded traversal),
  query/fragment suffixes, and sibling-prefix paths are rejected. Engine `fs/read` performs
  realpath confinement and regular-file validation, including symlink escape denial. That
  denial is reported as unavailable; the UI server does not inspect its own filesystem.
- Historical filesystem identity cannot be reconstructed reliably across location switches:
  2.1.4 public history omits workspace placement. Attachments spanning a location switch or
  preceding any later switch are conservatively unavailable, rather than silently rebound to
  the current project. Known workspace placements are rejected. The public API can hide
  placement entirely; the native engine's location resolution/confinement remains authoritative,
  and workspace-backed file delivery is not claimed (native host-filesystem issue #44568).
- An opaque process-local capability returns `/api/ui/project-artifacts/<id>`; GET/HEAD and
  `?download=1` stay behind the existing Host/Origin/fetch-site/JSON gateway. Each read rechecks
  provenance/location and opens current bytes from the configured authenticated engine's raw
  `GET /api/fs/read/<segment-encoded-path>?location[directory]=...`. Resolve probes one byte and
  cancels immediately; no whole-file buffering, artifact byte cap, or artifact-count cap is used.
  Capabilities are lost on UI-server restart. Metadata can become stale after edits; reads are
  current bytes, not snapshots. History is refetched, never cached as authorization.
- Single ranges are forwarded to the native engine (206/416; native malformed-range behavior
  applies). HEAD opens and immediately cancels a native GET because the pinned raw route is GET.
  Downstream cancellation/request abort aborts the upstream stream. Header acquisition and
  metadata/history calls have 10-second timeouts, no retries; successful file streams have no
  duration/byte cutoff. Redirects are not followed. Only file length/range headers are copied;
  cookies, authorization, CORS, validators and upstream errors are not exposed. Responses are
  no-store/nosniff/same-origin CORP with sandbox CSP and sanitized Content-Disposition. Only
  raster images can be inline; PDF is attachment, text is downgraded to plain text, active or
  unknown MIME is octet-stream attachment.
- **Approved engine race caveat:** the pinned engine checks realpath/stats before its eventual
  stream open, not an atomic confined file-descriptor open. Concurrent path/symlink replacement
  can race those checks. Multiple session/history/file requests are likewise not a transactional
  snapshot. This client does not claim to repair that native boundary or provide multi-tenant
  isolation. All new verification uses synthetic engine fixtures, never models/live sessions.

## Opt-in notification contract [app layer]

- App-owned state path: `~/.local/state/opencode-ui/notifications/state.json`, directory 700 and
  file 600. Contains VAPID keys, opaque device subscriptions/preferences, watched session IDs/titles,
  and bounded event-dedupe IDs; no transcripts or prompt/tool content. The VAPID private key is
  never sent to the browser, bundled, committed, or logged.
- `web-push@3.6.7` (MPL-2.0) and `@types/web-push@3.6.4` implement standards VAPID/Web Push. VAPID
  subject defaults to `mailto:opencode-ui@localhost` (override `OPENCODE_UI_VAPID_SUBJECT`); it is
  a local contact identity, not the app's public origin.
- Subscription endpoints: HTTPS only, no credentials/query secrets, port 443, and host allowlist
  `web.push.apple.com`, `fcm.googleapis.com`, Mozilla push hosts, and official Windows WNS suffix.
  Localhost/private/metadata/arbitrary hosts are rejected before any push request.
- App routes under `/api/ui/notifications`: `GET public-key`, `GET state?deviceId`, `GET health`,
  `POST subscribe`, `POST preferences`, `POST watch`, `POST heartbeat`, `POST test`,
  `POST unsubscribe`. They pass the existing exact Origin/Host/path/JSON guards and the shared access
  gate; no separate login, wildcard CORS, or public Funnel.
- A single server-side background watcher uses the server-held Basic credential against native
  `/api/event`; it runs without a browser tab. It maps native `session.execution.succeeded/failed`,
  `permission.asked`, and `form.created` to generic completion/failure/needs-attention payloads.
  Interrupted/user stops are not failure notifications. It does not replay historical completions
  on boot; reconnect pending snapshots use native `/api/permission/request` and `/api/form` with
  dedupe. Watched sessions expire after 30 days without an active use; `POST watch` with an empty
  list clears them. Subagent sessions are not watched unless explicitly used.
- A short visibility heartbeat lets the visible page show an in-app alert while suppressing an OS
  push; hidden/closed pages receive Web Push. Delivery is best-effort through the browser/OS push
  service. `public/notifications-sw.js` is the only SW: always `showNotification` for push, generic
  privacy text by default, same-origin session click/focus, no fetch handler, no cache/offline
  handler, no permission actions. iOS requires the installed Home Screen app.
- The physical iPhone Home Screen closed-app delivery and desktop/mobile closed-app push are
  **manual pending**; VM/browser-mock SW tests are not a vendor push receipt.

## Package pins [selected packages installed; exact versions]

| Package | Pin | Notes |
|---|---|---|
| `@opencode/client` | 2.1.4 | MIT; matches target. Browser promise entry exports 8 reachable files with no node builtins. Do **not** import `@opencode/client/service` in the browser (node imports). |
| `@openuidev/react-ui` | 0.18.1 | MIT. Installed for selective subpaths only: `Callout`, `Card`, `CardHeader`, `Table` primitives, `Image`, `MetricIndicator`, `Tag`, and lazy `Charts/BarChart` (+scoped chart CSS). The root entry imports chat/Lang surfaces; **do not import the root**. Card/Table/Image/Callout/MetricIndicator/Tag have no provider/Lang dependency. Code blocks are composed from shadcn `CodeBlock` parts in `src/components/openui-code-block.tsx`. The stats chart uses a local `ThemeProvider` with `cssSelector=".openui-chart-scope"` (scoped vars + portal class, no body/global reset) and actual `BarChart`, lazy only in `/stats`. |
| `web-push` | 3.6.7 | MPL-2.0. App-layer Web Push/VAPID sender only; used by `server/notifications.ts`, never imported into the browser bundle. Private VAPID key/state lives outside the repository with mode 600. `@types/web-push` 3.6.4 is dev-only. |
| `@openuidev/react-headless` | 0.18.1 | MIT; installed as declared peer resolution only. |
| `@openuidev/react-lang` | 1.0.1 | Installed as declared peer resolution only; no generated Lang UI/model/service or extra LLM is used. |
| `zustand` | 4.5.7 | Installed peer resolution; unused by app code. |
| `zod` | 4.6.7 | Installed peer resolution; unused by app code. |
| `@openuidev/lang-core` | 1.0.1 | Transitive peer support package. Its postinstall telemetry is **blocked** by Bun (`bun pm untrusted`) and not run. |
| `react` / `react-dom` | 19.3.1 | Satisfy UI peers (`^18.3.1 || ^19.0.0`). |
| Bun | 1.4.4 | Runtime and package manager. Runtime setup must ensure it is on `PATH` or referenced explicitly. |

## Known limits

- The browser password is one shared credential. It is an access boundary, not multi-tenant
  isolation; non-loopback use still needs secure transport and network protection. Allowlists are
  not authentication.
- MCP registration is engine-side state: a newly registered Notes server may need an engine restart
  before its tools appear. The UI reports `restartRequired` and never restarts the engine itself.
- Notes use per-record advisory locks plus `expectedRevision` compare-and-set, not multi-record
  transactions. Cross-process races are bounded by lockfiles (50 ms retry × 40, stale takeover after
  5 s); a crash can leave an orphaned attachment, and space deletion is not atomic with note creation.
- `/connect` exposes all native methods on plain HTTP; OAuth authorization URLs stay HTTPS, and
  credentials on an unencrypted origin are the operator's responsibility. `/debug` reports sanitized
  client and native server data; heap dumps are denied.
- Physical iPhone/desktop closed-app notification delivery is manual pending; mock/browser tests
  are not a vendor push receipt.
