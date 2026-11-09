# OpenCode V2 contract

This document records the native OpenCode V2 target and the app-layer security/API contracts the
client relies on. OpenCode owns backend behavior; this client does not edit or fork it.

Current target is OpenCode **2.1.4**. The API, file, artifact, notification, and auth rules below
are intentional; do not weaken them when simplifying UI code.


## Target [runtime]

- OpenCode **2.1.4**; the engine is a separate HTTP service. The UI server is the only
  browser-facing origin and injects the server-held credential. Engine URL and port are
  configuration-dependent: the CLI defaults to `http://127.0.0.1:4096`, while the direct/dev
  server defaults to `http://127.0.0.1:8090`.
- Registration JSON contains hostname, password, and port. The CLI reads
  `$XDG_CONFIG_HOME/opencode/service.json` or `~/.config/opencode/service.json`; the direct server
  uses `~/.config/opencode/service.json`. The password is read server-side and never printed,
  persisted in browser storage, or exposed to client code.
- The engine API is not a frontend review URL. Network isolation of the engine listener is outside
  this client and requires separate approval.

## Auth, CORS, and spec [runtime] [source] [spec]

- Unauthenticated `/api/*` and `/openapi.json` return **401**. Basic auth with username
  exactly `opencode` plus the registration password succeeds; empty/wrong username or
  Bearer fails 401. It is **not** generic Bearer.
- **CORS is origin-allowlisted, not absent** [source `packages/server/src/cors.ts:11-25`]:
  no-Origin requests, `http://localhost:*`, `http://127.0.0.1:*`, `oc://renderer`, Tauri
  origins, `https://*.opencode.ai`, and configured `cors` are allowed.
- The same-origin gateway is required by the app's security contract (hold the Basic credential
  server-side), not because CORS is absent. Do not weaken Origin/CSRF checks. Engine-side
  allowlists are not a substitute for the app-layer boundary.
- `/doc` is an SPA, not the spec. The OpenAPI document has **no `securitySchemes`**; auth
  is middleware-enforced.
- `/openapi.json`: 290180 bytes, SHA256
  `23a25e5604b1274987ab7093be1eea517bd93d588e849ea53ad93a977878db3a`;
  OpenAPI **3.1.0**, `info.version` **0.0.1** (spec version, not engine version);
  **124 paths / 149 operations / 293 schemas**. The key-sorted schema equals
  `https://opencode.ai/v2/openapi.json`.

## Access boundary assumptions

- The UI server is the browser-facing origin and holds the Basic credential server-side. It injects
  the credential for HTTP and WebSocket upstream requests and strips browser-supplied
  `Authorization`. No secret enters client code, URLs, bundles, or logs.
- Request guard: Host allowlist; exact Origin allowlist; WebSocket Origin checked before upgrade;
  unknown/missing unsafe origins rejected for mutations/WS; API path/method allowlist; JSON
  content-type for bodied mutations; security headers; no wildcard CORS; API
  `cache-control: no-store`; SSE remains `no-cache, no-transform`.
- **No browser cookie/session auth or extra login service is built in.** Loopback is the default
  boundary. Any non-loopback exposure needs its own authenticated access boundary and secure
  transport. Allowlists are not authentication or multi-tenant isolation; any client that can
  reach the UI has full app/engine access.
- The gateway is not network isolation. The engine endpoint is separate and must be protected
  independently.
- `/connect` supports native key/OAuth methods with ephemeral key state, bounded polling, and
  explicit cancellation. External/command methods remain blocked; no real credential/OAuth/login/
  pairing code/provider config was exercised.

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
  returns `FileSystem.Entry[]` (`{path, type: "file"|"directory"}`); returned paths stay relative
  to the requested location. `GET /api/fs/find?location[directory]=<abs>&query=...&type=file&limit=...`
  returns ranked entries. `GET /api/fs/read/<wildcard>?location[directory]=<abs>` streams raw bytes
  with ETag/Last-Modified and single-range support. The client requests a bounded first range and
  never uses `POST /api/experimental/fs/write` or a file editor. The server's location scope is
  authoritative; the client also rejects absolute/traversal paths, encodes every segment, and
  claims no new security boundary beyond backend auth.
- **Diffs:** `GET /api/session/{sid}/diff?from=<userMessageID>&to=<userMessageID>&context=N`
  returns `FileDiffInfo[]` (`file`, `patch`, `additions`, `deletions`, `status`) for a native
  session turn; omitting `from` uses the newest user turn. `GET /api/vcs/diff?location[directory]=<abs>&mode=working&context=N`
  returns the VCS HEAD-to-working-copy diff, a different scope. The inspector shows only the working
  tree and never fabricates patches from assistant prose.
- **Prompt attachments:** prompt input `files` is `{uri, name?, description?, mention?}`; `uri` is
  either a canonical `data:<mime>;base64,...` URL or a local `file:` URI. The installed 2.1.4
  server materializes it into public `PromptFileAttachment` `{data (base64), mime, source,
  name?, ...}`, accepts at most 20 MiB, normalizes supported images, and rejects unsupported
  URI schemes. The client uses a stricter 8 MiB per file / 4 files / 16 MiB total bound, rejects
  SVG, unknown binary, and remote URLs, and never fetches a user-supplied URL. Model acceptance is
  checked against `ModelInfo.capabilities.input` (`text`, `image`, `pdf`, ...). The UI accepts a
  file-only prompt when the native prompt schema permits empty text with files; no live
  attachment/model roundtrip was exercised once in final acceptance on a free model with a
  synthetic text fixture; no broad model/type claim is made.
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
  `/agent` with `{agent}`.
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
  subject defaults to the canonical HTTPS origin; no invented email identity.
- Subscription endpoints: HTTPS only, no credentials/query secrets, port 443, and host allowlist
  `web.push.apple.com`, `fcm.googleapis.com`, Mozilla push hosts, and official Windows WNS suffix.
  Localhost/private/metadata/arbitrary hosts are rejected before any push request.
- App routes under `/api/ui/notifications`: `GET public-key`, `GET state?deviceId`, `GET health`,
  `POST subscribe`, `POST preferences`, `POST watch`, `POST heartbeat`, `POST test`,
  `POST unsubscribe`. They pass the existing exact Origin/Host/path/JSON guards; no new login,
  cookie, wildcard CORS, or public Funnel.
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
| `@openuidev/react-ui` | 0.18.1 | MIT. Installed for selective subpaths only: `CodeBlock` (+scoped code CSS), `Card`, `CardHeader`, `Table` primitives, `Image`, and lazy `Charts/BarChart` (+scoped chart CSS). Root `dist/index.mjs` remains ~964 KB raw and imports chat/Lang surfaces; **do not import the root**. Card/Table/Image have no provider/Lang dependency. The stats chart uses a local actual `ThemeProvider` with `cssSelector=".openui-chart-scope"` (scoped vars + portal class, no body/global reset) and actual `BarChart`; chart JS **122.95 kB/41.53 kB gzip** + CSS **39.46/4.68 kB gzip**, lazy only in `/stats`. The CodeBlock subpath imports IconButton, `react-syntax-highlighter` Prism, lucide, and clsx, not AgentInterface/chat/Lang/zustand/d3. `ImageGallery`/`GalleryModal` were inspected but not imported because they require OpenUI ThemeProvider/portal scope and would replace the compact attachment/focus behavior. `FollowUpBlock`/`FollowUpItem` are standalone but their hardcoded “Related Queries” prompt semantics do not fit app-owned stats actions; explicitly deferred by the user and not implemented. |
| `react-syntax-highlighter` | 16.1.2 | Transitive `react-ui` dependency used by the actual CodeBlock. The full Prism build makes the lazy CodeBlock chunk **776.45 kB / 242.62 kB gzip**; initial wrapper impact remains **+6.18 kB raw/+2.21 kB gzip**. The static Card/Table/Image subpaths add **+13.38 kB raw/+4.32 kB gzip** main JS and **+5.25 kB/+0.92 kB gzip** CSS over the CodeBlock build, with no new dependencies. |
| `web-push` | 3.6.7 | MPL-2.0. App-layer Web Push/VAPID sender only; used by `server/notifications.ts`, never imported into the browser bundle. Private VAPID key/state lives outside the repository with mode 600. `@types/web-push` 3.6.4 is dev-only. |
| `@openuidev/react-headless` | 0.18.1 | MIT; installed as declared peer resolution only. Not imported by the CodeBlock path. |
| `@openuidev/react-lang` | 1.0.1 | Installed as declared peer resolution only. Not imported by the CodeBlock path; no generated Lang UI/model/service or extra LLM is used. |
| `zustand` | 4.5.7 | Installed peer resolution; unused by the CodeBlock path. |
| `zod` | 4.6.7 | Installed peer resolution; unused by the CodeBlock path. |
| `@openuidev/lang-core` | 1.0.1 | Transitive peer support package. Its postinstall telemetry is **blocked** by Bun (`bun pm untrusted`) and not run; not imported by the CodeBlock path. |
| `react` / `react-dom` | 19.3.1 | Satisfy OpenUI CodeBlock peers (`^18.3.1 || ^19.0.0`). |
| Bun | 1.4.4 | Runtime and package manager. Runtime setup must ensure it is on `PATH` or referenced explicitly. |

Registry tarball integrity, exports, and peer graphs were checked; **hash values were not
retained in this repo**. The published/cached `@openuidev/react-ui@0.18.1`
manifest, `CodeBlock` subpath types/source, official docs/repo, and actual import/build graph before
integration. Its `CodeBlockProps` are exactly `language`, `codeString`, and optional `theme`;
OpenUI's own copy control is not used because it is 32px, hover-only, and lacks a clipboard
fallback.
Pins are not evidence of integration.

## Known limits

- There is no browser login. Non-loopback use needs its own authenticated boundary; allowlists are
  not authentication or multi-tenant isolation.
- `/connect` key/OAuth support is implemented; external/command methods and some provider loopback
  paths remain limited. `/debug` is client-only.
- Physical iPhone/desktop closed-app notification delivery is manual pending; mock/browser tests
  are not a vendor push receipt.
