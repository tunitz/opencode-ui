# Components — current architecture

The app is a shadcn/Base UI shell around an OpenCode-aware conversation and composer.
OpenUI is selected only where its installed component fits; custom code is limited to state
projection, layout behavior, and safety checks. Exact native routes, auth, file caps, and security
rules are in [contract.md](contract.md); command behavior is in [commands.md](commands.md).

## Component hierarchy

1. **shadcn AI elements / Base UI** — `MessageScroller`, `Message`, `Bubble`, `Attachment`,
   `Marker`, `Trace`, `CodeBlock`, `Item` (Confirmation), `Popover` + `Progress` (Context),
   `PromptInput`/`InputGroup`, plus dialogs, sheets, menus, selects, tabs and fields.
2. **OpenUI** — selective subpath imports only: `Callout`, `Card`, `CardHeader`, `Image`,
   `Table`, `Charts/BarChart`, `ThemeProvider`, `MetricIndicator`, and `Tag`. Code blocks are
   composed from shadcn `CodeBlock` parts in `src/components/openui-code-block.tsx`.
3. **Custom** — only native-state projection, safety checks and pure adapters in
   `src/lib/shadcn-ai/`, not chat markup or scroll behavior.

Do not import the OpenUI root entry, AgentInterface, chat/Lang runtime, generated cards,
ImageGallery/GalleryModal, or FollowUpBlock/Item.

## Current mapping

| Area | Tier | Components / modules | Constraints |
|---|---|---|---|
| App shell | shadcn + layout glue | `App`, `AuthGateProvider`/`AuthScreen`, sidebar, header, main | Full-screen auth gate before the engine-connected app; collapsible desktop sidebar and matching right inspector rail; mobile session Sheet; full-width desktop conversation and composer; left-aligned desktop header; Back-to-conversation on the LEFT while Notes or Settings is open; Light/Dark/System; safe areas and visual-viewport height. |
| Access gate | app server + shadcn | `AuthGateProvider`, `AuthScreen`, `SettingsAccessSection`, `src/lib/auth.ts` | One-time `/api/ui/auth/status` check; setup or sign-in screen; 8–256-character password; HTTP-only 30-day session cookie; mid-session 401 re-shows the gate without polling. Password is optional on loopback and required on non-loopback binds; changed or removed in Settings → Access. |
| Project/session navigation | shadcn/Base UI | `ProjectSelect`, `SessionNav`, `NewSessionDialog`, responsive dialog/sheet, `AlertDialog`, `PickerSelect` | Project or All-projects scope; real native sessions; date-grouped accordion sessions with full-row search that flattens results; explicit create/rename/delete; destructive confirmation; mobile drawer closes only after selection/create. |
| Composer | shadcn `PromptInput` / `InputGroup` | `Composer`, `InputGroupTextarea`, `Attachment`, `ModelSelector`, `Button`, `ModelSettingsDrawer`, `ModelSettingsInline` | One rounded shadcn prompt surface: textarea + attachment chips + model/effort selectors + Stop only while running and 44px Send. File references are plain `@"path"` tokens inserted at the caret; slash commands, note references, prompt recall, drafts and dictation stay string-based. Touch Enter=newline/Send-only; fine-pointer Enter=send, Shift+Enter=newline; IME guarded. Lexical is no longer used. |
| Model settings | shadcn/Base UI | inline desktop chips, anchored desktop Popover fallback, mobile Sheet, three searchable `PickerSelect`s | Desktop shows compact borderless Agent/Model/Thinking Level triggers that open upward; the full form is still available through the model chip/popover fallback and `/models`, `/agents`, `/thinking`. Mobile keeps the single model trigger and bottom sheet unchanged. Agent/Model/Thinking Level from the target native catalog; unavailable values stay honest; immediate autosave; no Done; focus returns to the composer trigger. |
| Conversation | shadcn AI elements | `Conversation`, `MessageScroller`, `Message`, `Bubble`, `Marker`, `Trace`, `CodeBlock`, `Markdown` | `MessageScroller` owns anchoring, streaming follow, prepend preservation and jump-to-latest; every direct content child is a `MessageScrollerItem`, user turns carry `scrollAnchor`. Cursor-paged older history, stable keys, live-to-durable reconciliation and focus pinning stay. Tool activity is `Trace` rows with `TraceLine` status mapped by `src/lib/shadcn-ai/`; headings pass the secret sanitizer. |
| Markdown and code | react-markdown + shadcn `CodeBlock` | `Markdown`, `CodeBlock`, scoped code CSS | Raw HTML skipped; script/data/remote-image URLs blocked; ordinary links stay ordinary. Fenced code and tool output use shadcn `CodeBlock`/`CodeBlockContent` with copy button; live growing code stays full-text plaintext. Copy is exact; LTR in RTL. |
| Tables and images | actual OpenUI | `Table` primitives, `Card`, `CardHeader`, `Image` | GFM tables only, React nodes passed through, internal horizontal scroll. Images are safe inline data URLs or verified same-origin artifact routes; no arbitrary remote/SVG fetch. |
| User attachments | shadcn `Attachment` + native prompt files | `MessageFiles`, `Attachment`, `AttachmentGroup`, `PdfPreview`, paste/file picker, Dialog | Compact shadcn attachment row above the user bubble; no file count or size cap; PDF via local PDF.js; text escaped; SVG/HTML/remote hazards rejected; per-session, not draft-persisted. |
| Notes | shadcn/Base UI + notes HTTP API | `NotesProvider`, `NotesPanel`, `NotesSidebar`, `NoteStatusLabel`, `NoteAttachmentDialog`, `NoteReferencePicker`, notes mode in `Markdown`, `src/lib/notes-api.ts` | App-server notes (`POST /api/ui/notes/*`) with fetch and an SSE `changed` refresh; no engine-plugin gate and no `window.confirm`. Read-only Markdown preview with explicit edit; seven status labels (icon plus text, never color alone), filter chips and a status menu grouped Backlog/Active/Done; one de-duplicated space list with Global/project badges; unpin and delete actions confirmed with `AlertDialog`; project-relative file links and safe raster images; local attachments (4 files, 4 MiB each, 8 MiB total; SVG/HTML/JS rejected) with bounded previews; per-directory adapters keep drafts across project switches; composer note references arrive as Markdown attachments with an attachment manifest. |
| Settings | shadcn/Base UI + app server | `SettingsProvider`, `SettingsWorkspace`, `SETTINGS_SECTIONS`, `AppearancePanel`, `AgentConfigSettings`, `NotificationsSettings`, `KeybindingsSettings`, `SettingsPluginsSection`, `SettingsAccessSection` | Full workspace, not a dialog: `@container` two-pane at ≥40rem, one pane below it, Back-to-conversation in the app header, mutually exclusive with Notes. Sections in order (ids `appearance`, `agents`, `alerts`, `keys`, `plugins`, `access`): Appearance, Agents, Alerts, Keys, Plugins, Access. Agent edits keep the unsaved-changes `AlertDialog` on close/section change. Plugins lists each built-in MCP plugin (Notes) with its state chip, Enable/Disable and a restart hint; a divergent live engine state shows an "Engine out of sync" chip with a retry/restart hint instead of a bare Connected. Access sets, changes, or (on non-required binds) removes the UI password. |
| Assistant/tool artifacts | native `Tool.FileContent` + verified link route | `ToolArtifacts`, `ArtifactDialog`, `ArtifactImagePreview`, `artifact-delivery.ts` | Structured native files are primary. A file-like assistant link is promoted only when the server matches the exact href in native tool text plus a regular local file in an allowed root. Opaque route IDs; bounded bytes; Range/HEAD; `no-store`, `nosniff`, same-origin CORP, sandbox CSP; no arbitrary path or remote fetch. Tall screenshots use bounded scroll/zoom inside the Dialog. |
| Permissions and forms | shadcn Confirmation (`Item`) + native APIs | `PendingInbox`, `PermissionCard`, `FormView`, `Item`, `Button`, Dialog/Sheet, `FieldGroup` | One deliberate pending surface per active session; approvals are `Item` + Deny/Allow buttons; literal permission scope/patterns; Always only when native `save` exists; typed form fields, `when` rules, validation, explicit reply/cancel. Dismissal never answers. |
| Session inspector | shadcn AI elements + native fs/diff APIs | `SessionInspector`, `SessionInspectorPanel`, `FilesPanel`, `ChangesPanel`, `Trace`, `Tabs`, `ScrollArea` | Files and working-tree Changes. Activity/subagent/task rows use shadcn `Trace`-based AI elements; pending approvals use `Item`. Mobile fixed-height bottom Sheet; desktop persistent, non-modal right sidebar that matches the session navigation width, carries the working-tree summary, and collapses to the same icon rail. Clicking outside never dismisses it. Header refresh forces the active tab's actual scope with busy state and retained data. Files are read-only bounded previews; the working-tree diff is not a session-turn diff. |
| Terminal | not shipped | none | `/terminal` is reported as unsupported in the command picker. No terminal UI is mounted; do not infer terminal activity from output. |
| Agent configuration | shadcn/Base UI + app server | Settings Agents section, `server/agent-config.ts`, `agent-config-settings.tsx`, `agent-config.ts`, shared types | UI edits global sources only; existing project and ancestor configuration may still apply. Edits model, description, mode, hidden, steps, disabled, and ordered agent permission rules; JSONC comments/unknown fields and Markdown frontmatter/body are preserved. Expected-hash conflicts, atomic writes, fixed roots, and existing `/api/ui` guards. Permission rules are only one layer: top-level `permissions`/`policies` (`tool.use`), instructions/prompts, built-in/session rules and saved approvals can change the outcome, and tool exposure or provider/auth may still block or avoid a tool. Permission arrays with inline comments or unknown rule fields are read-only; legacy V1 `permission`/`tools` shapes are not migrated. No system prompts, top-level policies, request headers/body, providers, credentials, or arbitrary filesystem access; no experimental `fs/write`. |
| Notifications | app-layer Web Push | `NotificationsProvider`, Settings Alerts, `server/notifications.ts`, push-only `notifications-sw.js` | Explicit opt-in; permission only on click; generic privacy payloads; watched sessions only; server watcher without a tab; known push hosts only; private VAPID state outside git. In-app alerts when visible; OS push when hidden. Physical delivery remains manual pending. |
| Slash and integration dialogs | shadcn/Base UI + native APIs | command picker, session-command dialogs, `/btw`, integration/workspace/status dialogs | Content surfaces use fixed-height bottom sheets on mobile and centered dialogs on desktop, with internal scrolling; anchored pickers and safety confirmations retain their own primitives. Native catalogs and routes; no shell evaluation; unsupported items visible with reasons; explicit confirmation for destructive/model-triggering actions. `/mcps` and `/plugins` are read-only status/metadata views with no native mutations; worktree create/remove remain explicit and confirmed. Exact coverage and gaps are in [commands.md](commands.md). |
| Stats | actual OpenUI Charts | lazy `StatsTokenChart`, scoped ThemeProvider | Only explicit `/stats`; native input/output tokens by model; cost not plotted; text equivalent and zero/empty fallback; no chat/generated charts. |
| Theme/accessibility | shadcn tokens + thin providers | `ThemeProvider`, `AppearancePanel` in Settings, direction provider, accessible primitives | Light/Dark/System with OS follow, browser-local palettes and accents, previews, and persistence; all controls live in Settings → Appearance, and the sidebar theme trigger/dialog is retired. 44px controls; focus return; RTL; reduced motion; safe-area/keyboard layout; accessible names and necessary safety copy. |
| Network boundary | Bun gateway | `request-security`, auth/notes/plugins/artifact/notification routes | Basic credential held server-side; shared password gate for `/api/*` when configured or non-loopback; canonical Origin/WS checks; path/method allowlists; JSON content-type; host checks; no wildcard CORS; no-store APIs; authenticated boundary and secure transport still required beyond loopback. |

## Native-state modules

Session navigation additionally offers server-wide pins and labels, stored in
app-owned state through `/api/ui/session-shortcuts` (`server/session-shortcuts.ts`, default
`~/.local/share/opencode-ui/session-shortcuts.json`, overridable with
`OPENCODE_UI_SESSION_SHORTCUTS_STATE`) and shared by every browser and device rather than kept
in the browser; a full-row session search temporarily flattens the date groups;
direct subagent discovery is bounded to the first page. Project worktrees are
available from desktop and mobile navigation, using the selected project in
project scope or the active session's project in All projects scope. Existing worktrees offer
session creation in their directory with the normal catalog and project checks. The command center
module is retained but not mounted; when enabled it opens existing actions, including model settings,
and Alt+Shift+C focuses the composer only outside editable surfaces, terminals, overlays and IME composition. Presets and dictation are explicit; browser speech may
use a remote service.

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
- ImageGallery/GalleryModal (compact attachments/Dialog retained).
- FollowUpBlock/FollowUpItem (app-owned actions instead).
- Remote Markdown images and arbitrary server-side URL/file access.
- Browser screenshot tool guarantees; the app displays only structured or verified artifacts.
