# OpenCode Notes plugin

A standalone OpenCode V2 plugin, packaged separately from the UI. It stores notes in the
OpenCode server's plugin storage, exposes agent CRUD tools, publishes a typed RPC contract, and
adds a direct TUI command surface.

No engine, UI, or live configuration changes are required to build or test this package.

## Package layout

| Export     | File        | Purpose                                        |
| ---------- | ----------- | ---------------------------------------------- |
| `.`        | `index.ts`  | Server plugin (`id: "opencode-notes"`)         |
| `./server` | `server.ts` | Same server plugin, for package subpath hosts  |
| `./rpc`    | `rpc.ts`    | Portable RPC contract (`id: "opencode-notes"`) |
| `./tui`    | `tui.ts`    | TUI plugin (`id: "opencode-notes.tui"`)        |

The server export is a `Plugin.define`-compatible object with `id` and `setup`. It imports only
types at runtime, so it works whether the host resolves `@opencode/plugin` or not.

## Loading it

This repository does not configure the plugin for you. To load it in a separate OpenCode
configuration, point the V2 `plugins` array at this directory (the directory, not a single file):

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-ui/plugins/notes"],
}
```

OpenCode discovers the root `server.ts`/`index.ts` as the server part, root `rpc.ts` as the RPC
contract, and root `tui.ts` as the TUI part. These root files are thin forwarders, so both
local-directory loading and package-subpath resolution work.
Do not edit the live config unless the user explicitly asks for it.

## Model

- **Space** — `global` or `planning`. Both kinds may have an optional project link. A global
  space is usually unlinked and shared; a planning space is usually linked to one project.
- **Note** — belongs to zero or one space (`spaceID: null` means unassigned). Status is `todo`,
  `in-progress`, or `finished`.
- **Pinning** — notes and spaces can be pinned. Lists sort pinned entries first.
- A project link stores a project `id` plus `directory`/`canonical` snapshots. The `id` is the
  identity; the paths are display data and are not an authorization boundary.

## RPC contract

ID: `opencode-notes`. Methods: `list`, `create`, `update`, `delete`, `spaces`, `createSpace`,
`updateSpace`, `deleteSpace`. Event: `changed`.

All top-level inputs and outputs are closed objects (`additionalProperties: false`). Timestamps are
epoch milliseconds. IDs are opaque strings.

### Shared shapes

```ts
type NoteStatus = "todo" | "in-progress" | "finished"
type SpaceKind = "global" | "planning"

interface ProjectLink {
  id: string
  directory: string | null
  canonical: string | null
}

interface Space {
  id: string
  name: string
  kind: SpaceKind
  project: ProjectLink | null
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
}

interface Note {
  id: string
  spaceID: string | null
  title: string
  body: string
  status: NoteStatus
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
}

// revision starts at 1 for new records. Records written before revisions were
// added decode as revision 0. Every successful update increments it by one,
// independent of updatedAt (which may repeat within the same millisecond).
```

`ProjectInput` is `{ id: string; directory?: string | null; canonical?: string | null }`.
Every `Note`/`Space` returned by `list`, `spaces`, `create`, `update`, `createSpace`, or
`updateSpace` includes its current `revision`.

### Methods

```ts
list(input?: {
  spaceID?: string | null   // null selects unassigned notes
  projectID?: string
  status?: NoteStatus
  pinned?: boolean
  query?: string
  includeGlobal?: boolean   // default true when projectID is set
  limit?: number            // 1..1000, default 500
  offset?: number           // default 0
}): { notes: Note[]; total: number }

create(input: {
  spaceID?: string | null   // omit or null for an unassigned note
  title: string
  body?: string
  status?: NoteStatus
  pinned?: boolean
}): { note: Note }

update(input: {
  noteID: string
  expectedRevision?: number  // optional optimistic check
  spaceID?: string | null   // null unassigns
  title?: string
  body?: string
  status?: NoteStatus
  pinned?: boolean
}): { note: Note }

delete(input: {
  noteID: string
  expectedRevision?: number  // optional optimistic check
}): { deleted: boolean }

spaces(input?: {
  projectID?: string
  kind?: SpaceKind
  includeGlobal?: boolean
}): { spaces: Space[]; total: number }

createSpace(input: {
  name: string
  kind?: SpaceKind            // default "global"
  project?: ProjectInput | null
  linkCurrentProject?: boolean
  pinned?: boolean
}): { space: Space }

updateSpace(input: {
  spaceID: string
  expectedRevision?: number  // optional optimistic check
  name?: string
  kind?: SpaceKind
  project?: ProjectInput | null   // null unlinks
  linkCurrentProject?: boolean
  pinned?: boolean
}): { space: Space }

deleteSpace(input: {
  spaceID: string
  expectedRevision?: number  // optional optimistic check
  cascade?: boolean           // accepted for compatibility; never deletes notes
}): { deleted: boolean; deletedNotes: number }
```

Notes may be unassigned (`spaceID: null`). Unassigned notes are returned without a `projectID`
filter and by `spaceID: null`; they do not match a project view.

Project filtering: when `projectID` is set, a note/space matches if its space is linked to that
project, or if it is a `global` space and `includeGlobal` is not `false`. With
`includeGlobal: false`, only directly linked spaces match. `list` without `projectID` returns every
note.

`createSpace`/`updateSpace`: `project` and `linkCurrentProject` are mutually exclusive.
`linkCurrentProject: true` uses the server plugin instance's current project. Passing `project: null`
unlinks. Omitting both on `updateSpace` preserves the link.

Errors:

| Type              | Data                                         | When                                                                     |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `invalid`         | `{ field: string; message: string }`         | Empty/oversized values, bad enum, bad limit/offset, bad expectedRevision |
| `conflict`        | `{ entity; id; expectedRevision; revision }` | `expectedRevision` does not match the stored revision                    |
| `space_not_found` | `{ spaceID: string }`                        | Creating a note in, moving to, or updating an unknown space              |
| `note_not_found`  | `{ noteID: string }`                         | Updating an unknown note                                                 |
| `space_not_empty` | `{ spaceID: string; noteCount: number }`     | Deleting a non-empty space, with or without `cascade: true`              |

`conflict` data is `{ entity: "note" | "space"; id: string; expectedRevision: number; revision: number }`.
The revision check runs inside the same per-instance mutation queue as the write, before any change.

`delete` and `deleteSpace` are idempotent for a missing target: they return `deleted: false` rather
than `not_found`, even when `expectedRevision` is supplied. A conflict is reported only when the
target exists and its stored revision differs.

`deleteSpace` never deletes notes. Non-empty spaces are refused with `space_not_empty` even when
`cascade: true`, because plugin storage has no transaction that could make a partial cascade safe.
`deletedNotes` is therefore always 0. Delete notes individually, then delete the empty space.

### Event

`changed` data:

```ts
{
  entity: "note" | "space"
  action: "created" | "updated" | "deleted"
  id: string
}
```

Events are hints to refetch and are live-only. Deleting an empty space emits one `space` event;
notes are never deleted by a space delete.

## Agent tools

Tools are registered in namespace `notes` with Code Mode enabled:

`notes_list`, `notes_create`, `notes_update`, `notes_delete`, `notes_spaces`,
`notes_create_space`, `notes_update_space`, `notes_delete_space`.

Their inputs mirror the RPC methods, including optional `expectedRevision` on update and delete
tools. Successful results are JSON text in the tool content, including `revision`. Service errors
become thrown tool errors with a `type: message` prefix. Agents should call `notes_spaces` before
creating a note when they do not know a space ID, and must delete notes individually before
`notes_delete_space`.

## TUI

`src/tui.ts` (forwarded by root `tui.ts`) registers palette and slash commands:

| Command             | Slash           | Behavior                                                                       |
| ------------------- | --------------- | ------------------------------------------------------------------------------ |
| `notes.list`        | `/notes`        | Pick from all notes, including unlinked and unassigned notes                   |
| `notes.create`      | `/note-new`     | Create an assigned or explicitly unassigned note                               |
| `notes.update`      | `/note-edit`    | Edit title, body, status, pin; sends only changed fields plus expectedRevision |
| `notes.move`        | `/note-move`    | Move a note to another space, or make it unassigned                            |
| `notes.delete`      | `/note-delete`  | Pick and confirm deletion with expectedRevision                                |
| `notes.spaces`      | `/notes-spaces` | Browse spaces                                                                  |
| `notes.createSpace` | `/notes-space`  | Create a space, link any host project or leave it unlinked, and pin it         |
| `notes.editSpace`   | `/notes-edit`   | Rename, re-scope, link/unlink a project, or pin a space                        |
| `notes.deleteSpace` | `/notes-delete` | Confirm deletion of an empty space with expectedRevision                       |

The TUI part intentionally uses only commands and dialogs; it never calls a model. It does not
render a sidebar slot, so it has no Solid/OpenTUI JSX peer dependency. Its note picker uses an
all-notes view with no project filter, so unlinked and unassigned notes remain reachable. It pages
through `list` in 500-note pages and deduplicates by note ID, so notes beyond the first page are
selectable. This is a best-effort snapshot, not a transaction: concurrent inserts or deletes during
paging can still produce a stale or skipped entry; rerun the command for a fresh view. A safety cap
of 200 pages (100,000 notes) shows a truncation warning instead of looping forever.

Project choices come from `context.data.project.list()` plus an explicit "Not linked to a project"
option. Note-space choices include an explicit "No space" option. Cancelling a prompt or picker
preserves the existing value; only selecting "No space" or "Not linked to a project" clears a field.
Space deletion requires confirmation and is refused before calling the RPC when the space is
non-empty; a race that adds a note after that check is still rejected by the RPC. A host UI can
render the same data through the RPC.

## Mapping to the UI notes panel

The existing `src/components/notes-panel.tsx` `NotesAdapter` can be backed by this RPC:

- `NotesNote.content` ↔ `Note.body`.
- `NotesNote.spaceID` maps directly; both support `null`.
- `NotesSpace.projectID` ↔ `space.project?.id ?? null`.
- `NotesSnapshot.spaces` comes from `spaces({})`; `NotesSnapshot.notes` from `list({ limit: 1000 })`;
  `projects` comes from the host UI's project data, not this plugin.
- `NotesNote.revision` / `NotesSpace.revision` map directly. Pass them as `expectedRevision` on
  update/delete for best-effort stale-write detection.
- `deleteSpace` refuses non-empty spaces even with `cascade: true`; surface `space_not_empty` and
  require the user to delete notes individually before deleting the space.
- When `projectID` is chosen, send `kind: "planning"`; when it is cleared, `kind: "global"` is a
  reasonable default. Pass `project: { id: projectID }`; the plugin fills known paths only when the
  ID matches its own current project.

## Storage and concurrency

Keys:

- `opencode-notes/v1/space/<id>`
- `opencode-notes/v1/note/<id>`

Each record is a separate JSON value. Writes are serialized in-process by `NotesService` so a single
plugin instance does not interleave its own read-modify-write operations. `expectedRevision` checks
run inside that queue, immediately before the write.

There are **no transactions, locks, compare-and-swap operations, or cross-instance guarantees**.
Two independent OpenCode server instances can read the same revision and both write the same next
revision; the last write wins and stale-write detection is then bypassed. Cross-instance CAS is
unavailable, and this plugin cannot make it available without an atomic storage primitive. Plugin
storage may also be scoped by the host; this plugin does not create a cross-project database.
Do not treat this as a database.

## Security and honest limitations

- Notes are stored as plaintext JSON in OpenCode plugin storage. Do not put secrets, tokens, or
  private credentials in notes.
- RPC access inherits the OpenCode server's existing access boundary. This plugin adds no login,
  authorization, tenant isolation, or encryption. Any client permitted to call server RPC can read
  and modify all notes in the plugin's storage.
- Agent tools are available to agents whose permissions allow them. Tool inputs are validated, but
  a model can still create/modify notes.
- Project paths in a link can become stale after a move/rename. Use the project ID for identity.
- "Global" means global within OpenCode's plugin storage scope. The host decides whether that scope
  spans projects/locations; this plugin does not create a separate cross-project database.
- Cascade deletion is deliberately unsupported. A non-empty space must be emptied one note at a
  time, then deleted, so a storage failure cannot leave an irreversible partial cascade.
- The TUI is a command/dialog surface, not a persistent sidebar. It has not been exercised inside a
  live OpenCode TUI in this repository.

## Verification

```sh
bun test plugins/notes/test
```

The tests use in-memory storage and a fake OpenCode context. They cover revision increments under
colliding timestamps, stale update/delete conflicts, cascade refusal without partial deletion, TUI
access past 500 notes, duplicate rows across pages, the all-notes TUI view, cancellation safety, and
changed-fields-only TUI updates. They do not touch the engine, live configuration, credentials, or
the network.
