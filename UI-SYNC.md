# Optional UI metadata snapshot

Sync is not enabled automatically and does not observe browser storage. The
Settings → Defaults controls explicitly share, import, or delete a snapshot.
The source-checkout `uiSync` helper in `src/lib/ui-sync.ts` exposes explicit
`upload(snapshot, revision)`, `download(backendVersion)`, and `remove(revision)` operations. A UI integration
must obtain informed user consent, construct the snapshot from selected
non-secret metadata, and explicitly apply a downloaded snapshot. It must not
send whole localStorage records, drafts, prompts, transcripts, credentials,
notifications, or live engine state. Preset names and labels are user-supplied
text; callers must not place secrets or session content in them. Validation
cannot determine whether arbitrary text is sensitive.

`PUT /api/ui/sync` replaces the entire version-1 snapshot; `GET` returns it and
an ETag or 404 when absent. PUT requires `If-None-Match: *` to create, or the
ETag in `If-Match` to replace; DELETE also requires `If-Match`. A stale write
or deletion returns 412, requiring a fresh download and explicit resolution.
The shared snapshot contains a backend version: mismatched downloads are
rejected by the helper and mismatched replacements receive 409. Deleting a
different-version snapshot requires explicit user confirmation. The
contract and limits are in `src/lib/ui-sync-contract.ts`. Errors are surfaced
to the caller, not silently converted to successful syncs.

The store is created only on upload at
`~/.local/state/opencode-ui/sync/snapshot.json`, with a private directory and
0600 file. The existing gateway's Host, Origin, JSON mutation, body-size, and
no-store protections apply. This is a single shared snapshot, not per-user
storage or authentication; use the existing trusted access boundary and secure
transport. Anyone with access to the UI API can read, replace, or delete it.

## Source implementation

`collectUiSyncSnapshot(storage, origin, backendVersion)` explicitly selects
the existing theme, version-scoped web preferences, model preset format
(`opencode-ui:model-presets:v1`), and version/origin-scoped session shortcuts.
The worktree parent directory, palette, and accent remain browser-local and
are not included in the shared snapshot.
The existing shortcut parser normalizes malformed entries; the resulting
snapshot is validated, and unsupported IDs, labels, or presets cause an error
instead of being uploaded.
`uiSyncStorageUpdates(snapshot, origin, backendVersion, localWorktreeParentDirectory)`
returns the exact browser storage updates for a confirmed download, preserving
the supplied local worktree path; it does not apply them.
The manual control describes the shared data and access boundary, obtains a
revision before writing, and requires confirmation. A conflict requires a new
attempt. Reload after importing to apply all imported values. Storage updates
across several browser keys are not transactional; a best-effort rollback is
attempted if storage fails.

Mutations use a private exclusive lock across server processes. After an
unclean crash a leftover `.snapshot.lock` causes 503; stop all UI servers,
verify no sync write is active, then remove that lock manually before retrying.
