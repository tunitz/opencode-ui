# Components — current architecture

The app is a shadcn/Base UI shell around an OpenCode-aware conversation and composer.
OpenUI is selected only where its installed component fits; custom code is limited to state
projection, layout behavior, and safety checks. Exact native routes, auth, file caps, and security
rules are in [CONTRACT.md](CONTRACT.md); command behavior is in [COMMANDS.md](COMMANDS.md).

## Component hierarchy

1. **OpenUI** — actual `CodeBlock`, `Card`/`CardHeader`, `Table` primitives, `Image`, and lazy
   `Charts/BarChart` only.
2. **shadcn/Base UI** — dialogs, sheets, menus, selects, tabs, fields, buttons, checks, scroll
   areas, and other interactive chrome.
3. **Custom** — only native-state projection and behavior that the installed primitives do not
   provide.

Do not import the OpenUI root entry, AgentInterface, chat/Lang runtime, generated cards,
ImageGallery/GalleryModal, or FollowUpBlock/Item. The installed peer packages are present for
resolution; they are not a claim that generated-UI features are adopted.

## Current mapping

| Area | Tier | Components / modules | Constraints |
|---|---|---|---|
| App shell | shadcn + layout glue | `App`, sidebar, header, main | Permanent desktop sidebar; mobile session Sheet; Light/Dark/System; safe areas and visual-viewport height. |
| Project/session navigation | shadcn/Base UI | `ProjectSelect`, `SessionNav`, `NewSessionDialog`, responsive dialog/sheet, `AlertDialog`, `PickerSelect` | Project or All-projects scope; real native sessions; date-grouped accordion sessions with full-row search that flattens results; explicit create/rename/delete; destructive confirmation; mobile drawer closes only after selection/create. |
| Composer | shadcn | `Composer`, `InputGroup`, `ModelSettingsDrawer`, `Button` | One rounded surface: textarea + footer with plus, actual model/Thinking, Stop only while running, blue 44px Send. Touch Enter=newline/Send-only; fine-pointer Enter=send, Shift+Enter=newline; IME guarded. Idle Send omits delivery; active Send uses native steer; Queue is an explicit one-shot plus-menu action. |
| Model settings | shadcn/Base UI | composer trigger, modal Sheet/Dialog, three searchable `PickerSelect`s | Agent/Model/Thinking Level from the target native catalog; unavailable values stay honest; immediate autosave; no Done; focus returns to the composer trigger. |
| Conversation | TanStack Virtual + shadcn | `Conversation`, `Message`, `Bubble`, `Trace`, `Collapsible`, `Markdown` | Bounded DOM with cursor-paged older history, stable keys, live-to-durable reconciliation, no duplicate text/tool segments, focus pinning, no false bottom-follow. Tool traces start collapsed and preserve explicit expansion per session. Long structured tool errors have a mobile detail sheet; its source row remains pinned until close, while desktop stays inline. Error text remains bounded and escaped; artifact delivery is unchanged. Reading mode/Activity are not present. |
| Markdown and code | react-markdown + actual OpenUI | `Markdown`, lazy `CodeBlock` runtime, scoped code CSS, shadcn copy Button | Raw HTML skipped; script/data/remote-image URLs blocked; ordinary links stay ordinary. Fenced code uses actual OpenUI CodeBlock when settled; live growing code stays full-text plaintext to avoid per-token highlighting. Copy is exact; LTR in RTL. |
| Tables and images | actual OpenUI | `Table` primitives, `Card`, `CardHeader`, `Image` | GFM tables only, React nodes passed through, internal horizontal scroll. Images are safe inline data URLs or verified same-origin artifact routes; no arbitrary remote/SVG fetch. |
| User attachments | shadcn + native prompt files | `MessageFiles`, `PdfPreview`, paste/file picker, Dialog | Compact row above the user bubble; 8 MiB/file, 4 files, 16 MiB total; PDF via local PDF.js; text escaped; SVG/HTML/remote hazards rejected; per-session, not draft-persisted. |
| Assistant/tool artifacts | native `Tool.FileContent` + verified link route | `ToolArtifacts`, `ArtifactDialog`, `ArtifactImagePreview`, `artifact-delivery.ts` | Structured native files are primary. A file-like assistant link is promoted only when the server matches the exact href in native tool text plus a regular local file in an allowed root. Opaque route IDs; bounded bytes; Range/HEAD; `no-store`, `nosniff`, same-origin CORP, sandbox CSP; no arbitrary path or remote fetch. Tall screenshots use bounded scroll/zoom inside the Dialog. |
| Permissions and forms | shadcn/Base UI + native APIs | `PendingInbox`, `PermissionCard`, `FormView`, Dialog/Sheet, fields | One deliberate pending surface per active session; literal permission scope/patterns; Always only when native `save` exists; typed form fields, `when` rules, validation, explicit reply/cancel. Dismissal never answers. |
| Session inspector | shadcn/Base UI + native fs/diff APIs | `SessionInspector`, `FilesPanel`, `ChangesPanel`, Tabs, ScrollArea | Files and working-tree Changes. Mobile fixed-height bottom Sheet; desktop full right panel. Header refresh forces the active tab's actual scope with busy state and retained data. Files are read-only bounded previews; the working-tree diff is not a session-turn diff. Activity/tree/queue inspector is removed. |
| Terminal | currently unavailable | `TerminalPanel` | The PTY component exists but is not mounted in the current interface. The pinned `Pty` status is process running/exited, not agent activity. No terminal activity is inferred from output. |
| Settings | shadcn/Base UI + localStorage | `SettingsButton`, `SettingsDialog`, Tabs, `NotificationsSettings` | Mobile fixed-height bottom Sheet; desktop moderate Dialog; internal scrolling. Startup project, global defaults, worktree parent directory, and Alerts. Legacy browser-local project overrides are cleared. Browser-local, origin + backend-version scoped, separate from drafts; unavailable values block creation. The worktree path is not shared by UI sync. |
| Agent configuration | shadcn/Base UI + app server | Settings Agents tab, `server/agent-config.ts`, `agent-config-settings.tsx`, `agent-config.ts`, shared types | UI edits global sources only; existing project and ancestor configuration may still apply. Edits model, description, mode, hidden, steps, disabled, and ordered agent permission rules; JSONC comments/unknown fields and Markdown frontmatter/body are preserved. Expected-hash conflicts, atomic writes, fixed roots, and existing `/api/ui` guards. Permission rules are only one layer: top-level `permissions`/`policies` (`tool.use`), instructions/prompts, built-in/session rules and saved approvals can change the outcome, and tool exposure or provider/auth may still block or avoid a tool. Permission arrays with inline comments or unknown rule fields are read-only; legacy V1 `permission`/`tools` shapes are not migrated. No system prompts, top-level policies, request headers/body, providers, credentials, or arbitrary filesystem access; no experimental `fs/write`. |
| Notifications | app-layer Web Push | `NotificationsProvider`, Settings Alerts, `server/notifications.ts`, push-only `notifications-sw.js` | Explicit opt-in; permission only on click; generic privacy payloads; watched sessions only; server watcher without a tab; known push hosts only; private VAPID state outside git. In-app alerts when visible; OS push when hidden. Physical delivery remains manual pending. |
| Slash and integration dialogs | shadcn/Base UI + native APIs | command picker, session-command dialogs, `/btw`, integration/workspace/status dialogs | Content surfaces use fixed-height bottom sheets on mobile and centered dialogs on desktop, with internal scrolling; anchored pickers and safety confirmations retain their own primitives. Native catalogs and routes; no shell evaluation; unsupported items visible with reasons; explicit confirmation for destructive/model-triggering actions. `/mcps` and `/plugins` are read-only status/metadata views with no native mutations; worktree create/remove remain explicit and confirmed. Exact coverage and gaps are in [COMMANDS.md](COMMANDS.md). |
| Stats | actual OpenUI Charts | lazy `StatsTokenChart`, scoped ThemeProvider | Only explicit `/stats`; native input/output tokens by model; cost not plotted; text equivalent and zero/empty fallback; no chat/generated charts. |
| Theme/accessibility | shadcn tokens + thin providers | `ThemeProvider`, appearance dialog/sheet, direction provider, accessible primitives | Light/Dark/System with OS follow, browser-local palettes and accents, previews, and persistence; 44px controls; focus return; RTL; reduced motion; safe-area/keyboard layout; accessible names and necessary safety copy. |
| Network boundary | Vite middleware/Tailscale Serve | `request-security`, auth/artifact/notification routes | Basic held server-side; canonical Origin/WS checks; path/method allowlists; JSON content-type; host checks; no wildcard CORS; no-store APIs; private tailnet only. |

## Native-state modules

Session navigation additionally offers local pins/labels and a full-row session
search that temporarily flattens the date groups; direct subagent discovery is bounded to the first page. Project worktrees are
available from desktop and mobile navigation, using the selected project in
project scope or the active session's project in All projects scope. Existing worktrees offer
session creation in their directory with the normal catalog and project checks. The command center
module is retained but not mounted; when enabled it opens existing actions, including model settings,
and Alt+Shift+C focuses the composer only outside editable surfaces, terminals, overlays and IME composition. Presets and dictation are explicit; browser speech may
use a remote service. Cross-device preference snapshots are manual and opt-in,
not authentication or multi-user isolation; see [UI-SYNC.md](UI-SYNC.md).

`src/lib/opencode.ts` owns the typed `@opencode/client` instance. `use-opencode.ts` owns
connection/project/session/history state, native SSE correlation, prompt admission, interrupt,
pending permissions/forms, reconnect, and durable reconciliation. Pure helpers cover event
reduction, form validation, drafts, reconnect/backoff, selection, viewport, accessibility, and
message history. Components consume those modules rather than parsing prose for state.
`server/agent-config.ts` is a narrow app-server editor for the engine's own agent source files:
it resolves the global config directory and one project's `.opencode` directory, edits only
whitelisted fields through a JSONC-preserving modifier or YAML frontmatter document, validates
before writing, and uses an expected whole-file hash plus an atomic same-directory rename.

`@opencode/client` is pinned to 2.1.4 and uses `window.location.origin`; the proxy injects the
server-held Basic credential. The browser never receives it.

## Deliberately omitted / deferred

- OpenUI AgentInterface, chat/Lang runtime, generated cards, and generative-UI registry.
- ImageGallery/GalleryModal (source-inspected; existing compact attachments/Dialog retained).
- FollowUpBlock/FollowUpItem (source-inspected; “Related Queries” semantics do not fit app-owned
  actions).
- Activity pending-queue/subagent-tree inspector and reading mode.
- Remote Markdown images and arbitrary server-side URL/file access.
- Browser screenshot tool guarantees; the app displays only structured or verified artifacts.
