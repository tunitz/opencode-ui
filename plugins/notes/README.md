# @tunitz/opencode-notes

Standalone notes core for OpenCode UI. It owns a plaintext file store, a typed
service API, search, revision history, and an MCP stdio server that agents can call.
It no longer runs inside the OpenCode engine as a plugin: the former engine plugin
export, RPC contract, and TUI command surface are retired.

- Package: `@tunitz/opencode-notes`
- Core export: `@tunitz/opencode-notes` (`.`)
- MCP helper export: `@tunitz/opencode-notes/mcp` (`./mcp`)
- Runnable MCP entry: `plugins/notes/src/mcp/main.ts`

```sh
# From the repository root:
bun plugins/notes/src/mcp/main.ts
```

## Architecture

| Piece | Purpose |
| --- | --- |
| `src/types.ts` | v2 records, inputs/outputs, statuses, limits, `NotesError` |
| `src/store.ts` | `NotesStore` interface, `FileNotesStore`, `MemoryNotesStore`, parsers |
| `src/service.ts` | `NotesService` and `createNotesService` |
| `src/core/migrate.ts` | one-time read-only import from engine SQLite |
| `src/fs-utils.ts` | data-dir resolution, atomic writes, safe file names |
| `src/mcp/server.ts` | MCP server factory, tools/prompts/resources wiring |
| `src/mcp/main.ts` | stdio entry point |

The UI server imports the core in-process; agents connect to the MCP server. Both
resolve the same default data directory, so there is no sync step between them as
long as they run with the same user and environment.

## Data directory

Default: `$XDG_DATA_HOME/opencode-notes/v1`, or
`~/.local/share/opencode-notes/v1` when `XDG_DATA_HOME` is unset.
Override with `OPENCODE_NOTES_DATA_DIR`.

```text
notes/<noteID>.json                 plaintext note records
spaces/<spaceID>.json               plaintext space records
attachments/<attachmentID>          raw attachment bytes
history/<noteID>/<revision>-<savedAt>.json
migrated.json                       one-time migration marker
```

Writes use a temp file plus rename, files are `0600`, and directories are `0700`.
Per-record mutations take an advisory lock (`<record>.json.lock`, created with
`O_EXCL`, 50 ms retry × 40, stale takeover after 5 s) and do the
read-modify-write inside it. `expectedRevision` compare-and-set checks run under
that same lock, so two processes cannot silently overwrite each other.

A missing or corrupt individual record is skipped when listing; it does not take
the store down.

## Status model

```ts
type NoteStatus =
  | "idea"
  | "todo"
  | "in-progress"
  | "blocked"
  | "finished"
  | "cancelled"
  | "archived"

const STATUS_CATEGORIES = {
  backlog: ["idea", "todo"],
  active: ["in-progress", "blocked"],
  done: ["finished", "cancelled", "archived"],
}
```

- New notes default to `todo`.
- Transitions are not hard-enforced. Lifecycle is a convention:
  - `idea` / `todo` — not started.
  - `in-progress` — actively being worked; move a plan note here when work starts.
  - `blocked` — waiting on a decision or dependency.
  - `finished` — **verified**, with evidence (commands, outcomes, commit) appended
    to the note body.
  - `cancelled` / `archived` — intentionally not completed. The whole `done`
    category is terminal by convention; reopening is an explicit status change and
    is recorded in history.
- Legacy v1 statuses (`todo`, `in-progress`, `finished`) remain valid because they
  are a subset of the seven.
- `statusUpdatedAt` is set whenever the status changes and is omitted on legacy
  records that never had one.

## Spaces and directory scoping

Spaces are v2:

```ts
interface Space {
  id: string
  name: string
  projectDir: string | null // null = Global
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
}
```

- `projectDir === null` is a **Global** space, visible in every project and every saved connection.
- A non-null `projectDir` is a canonical project directory. Such a space also carries a `connectionId`: it is visible only on the saved OpenCode connection that owns it, so two connections with the same directory path never share its notes. A linked space without a `connectionId` is legacy data: it is preserved but hidden from normal listings until it is explicitly assigned from Settings → Connections. Unassigned notes (`spaceID: null`) stay shared across connections.
- The v1 `kind` / `project` vocabulary is gone. Legacy parsing/migration maps a
  global or unlinked space to `null`, and a linked planning space to
  `project.canonical ?? project.directory ?? null`.
- `list`, `search`, and `spaces` accept `directory`. A note or space matches when its
  space has `projectDir === directory`, or `projectDir === null` while
  `includeGlobal !== false`.
- Notes with `spaceID: null` (unassigned) are always visible.
- There is no `projectID` or location object anymore.
- Omitting `directory` matches everything (`matchesDirectory` returns true without a directory).

The two callers apply different defaults on top of these rules:

- The browser adapter (`src/lib/notes-api.ts`, `createNotesAdapter`) passes `target = null` to its
  list and spaces calls, so it lists notes and spaces across every project of the **current
  connection**. The UI server injects that connection scope into every service call, including
  direct note and attachment access; Global spaces and unassigned notes remain shared. Drafts stay
  cached per connection and project directory.
- MCP tools default to a project scope. `notes_list`, `notes_search`, and `notes_spaces` resolve
  `directory` with `scopingDirectory(input.directory, context.defaultDirectory)`: an explicit
  `directory` wins, otherwise the server process's working directory is used. Global records are
  included unless the caller passes `includeGlobal: false`.

## Core API

```ts
import { createNotesService, type Note, type Space } from "@tunitz/opencode-notes"

const service = createNotesService() // file store + lazy migration
await service.ready()                // optional: force migration now

const notes = await service.list({ directory: "/repo", includeBodies: false })
```

`createNotesService(options)` options:

| Option | Meaning |
| --- | --- |
| `store` | Inject a `NotesStore` (tests). Migration runs only when the store has a `dataDir`. |
| `dataDir` | Override the file-store root. |
| `now` / `createID` | Deterministic clock/IDs for tests. |
| `onChange` | In-process listener for committed `{ entity, action, id }` events. |
| `migrate` | Explicitly enable/disable the engine import. |
| `engineDbPath` | Override the engine SQLite path. |

Service methods:

```ts
list({ spaceID?, directory?, status?, statuses?, pinned?, query?,
       includeGlobal?, includeBodies?, limit?, offset? }) // -> { notes, total }
get({ noteID })                                          // -> Note
create({ spaceID?, title, body?, status?, pinned? })     // -> Note
update({ noteID, expectedRevision?, spaceID?, title?, body?, status?, pinned? })
delete({ noteID, expectedRevision? })                    // -> { deleted }
spaces({ directory?, includeGlobal? })                   // -> { spaces, total }
createSpace({ name, projectDir?, pinned? })              // -> Space
updateSpace({ spaceID, expectedRevision?, name?, projectDir?, pinned? })
deleteSpace({ spaceID, expectedRevision?, cascade? })    // -> { deleted, deletedNotes }
createAttachment({ noteID, name, mime, data, expectedRevision? })
readAttachment({ noteID, attachmentID })                 // -> { attachment, data }
deleteAttachment({ noteID, attachmentID, expectedRevision? })
search({ query, directory?, spaceID?, statuses?, pinned?,
         includeGlobal?, limit?, offset? })              // -> { results, total }
history({ noteID, limit?, offset? })                     // -> { snapshots, total }
restore({ noteID, revision, expectedRevision? })         // -> { note }
```

- `limit` is `1..1000`, default 500 for `list` and 100 for `search`; history is
  capped at 50 snapshots per note.
- Lists sort pinned first, then `updatedAt` descending, then ID. Spaces sort pinned
  first, then Global, then directory/name.
- `includeBodies: false` returns empty bodies; filtering, totals, and pagination
  still use the stored bodies.
- `delete` / `deleteSpace` are idempotent for a missing target (`deleted: false`).
  `deleteSpace` refuses non-empty spaces even with `cascade: true`; `cascade` is
  accepted only for wire compatibility.
- Attachments: 4 MiB per file, 4 files per note, 8 MiB total. Active inline types
  (`image/svg+xml`, `text/html`, `application/xhtml+xml`, `application/javascript`,
  `text/javascript`, `application/ecmascript`, `text/ecmascript`, any
  `*/javascript`) are rejected. Notes expose metadata only; bytes are returned only
  by `readAttachment`.

### Search

Case-insensitive. A title match scores 100; each body occurrence adds 10, capped at
50. `snippet` is ±80 characters around the first body match, whitespace-collapsed,
and ellipsized when cut. Result notes always have `body: ""`; use `notes_get` for
the full content. Results sort by score, then by the normal note order.

### History and restore

Before every note update, delete, or attachment mutation, the previous record is
snapshotted to `history/<noteID>/`. The newest 50 snapshots are kept. A snapshot
records the full note plus `savedAt`; `history()` returns only metadata (revision,
title, status, spaceID, savedAt, updatedAt).

`restore` restores title, body, status, spaceID, and pinned state from a snapshot as
a **new** revision, and snapshots the pre-restore state first. Attachments are not
restored. Unknown revisions throw `snapshot_not_found`.

### Errors

| Type | When |
| --- | --- |
| `invalid` | Bad field, limit, base64, MIME shape, revision, or missing confirmation |
| `revision_conflict` | `expectedRevision` does not match the stored revision |
| `note_not_found` | Unknown note |
| `space_not_found` | Unknown space |
| `space_not_empty` | Deleting a space that still has notes |
| `attachment_not_found` | Note does not own the attachment, or bytes are missing |
| `snapshot_not_found` | Unknown history revision |
| `limit_exceeded` | Per-file/count/total attachment limit exceeded |
| `mime_rejected` | Active content type rejected |

`NotesError` exposes `type` plus a `data` object. `revision_conflict` data is
`{ entity, id, expectedRevision, revision }`.

## Migration from the engine plugin

On first service creation (for any store with a data directory; pass `migrate: false`
to opt out) the service checks `migrated.json`. If it is absent, it reads the engine
SQLite database **read-only** at `$XDG_DATA_HOME/opencode/opencode.db` (default
`~/.local/share/opencode/opencode.db`, override `OPENCODE_ENGINE_DB_PATH`), selects
keys like `plugin:<hex>:opencode-notes/v1/{note,space,attachment}/<id>`, converts v1
spaces to v2, decodes attachment base64 into bytes files, and then writes
`migrated.json` `{ at, notes, spaces, attachments }`.

- Missing database → a zero marker is written and the import is skipped.
- Records that already exist in the new store are never overwritten.
- The engine database is never written to.
- The migration marker makes the operation idempotent and lazy; deleting the marker
  reruns the import for IDs that are still missing.

If a real notes file already exists next to a legacy engine database, the file-store
record wins.

## MCP server

`src/mcp/main.ts` connects over stdio. Tools return JSON text; failures set
`isError` and prefix the text with the error type.

### Tools (15)

| Tool | Purpose |
| --- | --- |
| `notes_list` | List/filter notes; `includeBodies: false` for cheap browsing |
| `notes_get` | Read one note including body and attachment metadata |
| `notes_create` | Create a note in a space or unassigned |
| `notes_update` | Patch title, body, status or space; pass `expectedRevision` to reject stale writes. Pinned state is UI-only |
| `notes_delete` | Delete; confirmation via elicitation unless `expectedRevision` is given |
| `notes_search` | Scored search with snippets |
| `notes_history` | List saved snapshots (metadata only) |
| `notes_restore` | Restore a snapshot as a new revision |
| `notes_spaces` | List spaces in the current project plus Global |
| `notes_create_space` | Create a Global or project space |
| `notes_update_space` | Rename, re-scope, or pin a space |
| `notes_delete_space` | Delete an empty space |
| `notes_attachment_create` | Attach a file/image from base64 bytes (4 files, 4 MiB each, 8 MiB total); rejects active types |
| `notes_attachment_read` | Read a text attachment (≤64 KiB); binary returns metadata only |
| `notes_attachment_delete` | Delete one attachment by ID; pass `expectedRevision` to reject stale deletes |

Created attachments are referenced in note bodies as `![name](attachment://id)`
for images or `[name](attachment://id)` for other files. The agent should pass
the `expectedRevision` from a recent `notes_get` when attaching or deleting, so
a concurrent edit is reported instead of overwritten.

`notes_list`, `notes_search`, and `notes_spaces` accept `directory` and default it to
`process.cwd()`. Inputs are closed JSON Schema objects (`additionalProperties:
false`).

### Prompts

| Prompt | Arguments | Behavior |
| --- | --- | --- |
| `notes:capture` | `title?`, `space?`, `status?` | Distill the conversation into a durable note via `notes_create` |
| `notes:daily` | `date?` | Find/create the Global "Daily" space and a note titled `YYYY-MM-DD`, then append a dated section |
| `notes:review` | `directory?` | Review pinned and active notes, verify statuses, update with `expectedRevision`, append evidence before `finished` |

### Resources

- `notes://note/{noteID}` — a note as Markdown with YAML-ish frontmatter
  (`id`, `status`, `space`, `updated`).
- `notes://spaces` — space inventory text with project scope and note counts.
- `resources/list` returns those two entries plus up to 50 pinned/most-recent notes.
- `resources/templates/list` also exposes the note URI template.

### Elicitation

Only `notes_delete` uses elicitation, and only when `expectedRevision` is omitted.
The client must advertise form elicitation; the request asks for
`{ confirm: boolean }` and names the note title. If the capability is missing, the
request fails, or the user declines/cancels, the call aborts with an `invalid`
error whose text contains `confirmation_required`. Passing `expectedRevision`
skips confirmation.

## Registering with the engine

Settings → Plugins writes a `notes` MCP server into the engine's global config file under
`mcp.servers.notes` (atomic JSONC edit; `opencode.jsonc` preferred when present, else
`opencode.json`) and then tries to hot-connect it. That config write is what survives an engine
reload; the engine's experimental MCP API does not. The engine may still need a restart to apply
the registration, which the API reports as `restartRequired`.

```jsonc
{
  "type": "local",
  "command": ["/absolute/path/to/bun", "/path/to/opencode-ui/plugins/notes/src/mcp/main.ts"],
  "disabled": false,
  "codemode": false
}
```

Keep `codemode: false` so each notes call renders as a real tool row instead of a
code-mode snippet. Tools accept an explicit `directory`; when it is omitted they
default to the server process's working directory, so pass the project directory
when the server is not launched from that project. The UI registration does not
set a `cwd`.

The UI server also imports the core directly for its `/api/ui/notes/*` endpoints;
that path does not require the engine MCP registration.

## Limits

Names 200, titles 500, bodies 100,000, search queries 500, IDs 200, directory paths
4,096, list pages 1,000. Attachments: 4 MiB each, 4 per note, 8 MiB total per note.
History: 50 snapshots per note.

## Security and honest limitations

- Notes and attachments are plaintext on disk. Do not store secrets, tokens, or
  credentials.
- Attachment validation covers size, name shape, and active-inline MIME rejection
  only. It is not a virus scanner or encrypted vault.
- Access control is the filesystem's. Anyone who can read the data directory can
  read every note.
- IDs are generated locally; record IDs that are unsafe as file names are rejected
  rather than encoded.
- The store has per-record locks, not multi-record transactions. A crash between an
  attachment byte write and the note metadata write can leave an orphan, and space
  deletion checks are not atomic with note creation.
- MCP clients that do not support elicitation cannot delete notes without an
  explicit `expectedRevision`.

## Exports

```ts
// @tunitz/opencode-notes
export * from "./src/types.js" // Note, Space, inputs/outputs, NOTE_STATUSES, STATUS_CATEGORIES, LIMITS, NotesError
export { NotesService, createNotesService } from "./src/service.js"
export { FileNotesStore, MemoryNotesStore, parseNote, parseSpace, ... } from "./src/store.js"
export { resolveDataDir, resolveEngineDbPath, ... } from "./src/fs-utils.js"
export { migrateEngineData, migrationMarkerPath, readMigrationMarker, ... } from "./src/core/migrate.js"

// @tunitz/opencode-notes/mcp
export { createNotesMcpServer, startNotesMcpServer, NOTES_TOOLS, NOTES_PROMPTS, ... }
```

The former `./server`, `./rpc`, and `./tui` exports and the root
`index.ts`/`server.ts`/`rpc.ts`/`tui.ts` forwarders are removed, along with the
`@opencode/plugin` dependency and the TUI command surface.
