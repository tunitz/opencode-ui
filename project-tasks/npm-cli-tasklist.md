# OpenCode UI CLI Development Tasks

## Specification Summary

- **User requirement:** “production UI usable as `bunx opencode-ui` plus flags, no Vite, publishable for anyone.”
- **Execution constraint:** “Do not run tests or checks (user previously explicitly requested no tests/checks). Do not mutate deployment, registry, git commits or live state.”
- **Stack:** Existing Bun server and Bun frontend build; React, TypeScript and Tailwind. No Laravel, Livewire or FluxUI requirement is specified. No timeline is specified.
- **Specification gap:** `ai/memory-bank/site-setup.md` and `ai/agents/pm.md` are absent. The exact flag names, defaults, engine connection options and registry ownership/availability need confirmation; do not assume that the package name is available or publish it.

## Development Tasks

### [x] Task 1: Package the production UI (30–60 minutes)
**Status:** Implemented; Task 1 source review PASS. The previously omitted runtime dependency is now explicitly allowlisted as `src/lib/agent-config-types.ts`, matching the server import and updated architecture; the shared module has no further imports. Runtime/package verification remains UNVERIFIED and pending authorization; this is not production-readiness approval. Source inspection only: no tests, checks, commands, builds, packing, CLI execution, publication, deployment changes, or live-state mutations performed. CLI configuration remains Task 2.
**Description:** Make the package publishable with a Bun-executable `opencode-ui` entry point and include the built frontend and all runtime server code/dependencies in the package, without requiring Vite or a source checkout.

**Acceptance criteria:**
- Package metadata is no longer private and declares the `opencode-ui` executable; package contents include the server and production assets and exclude private state and credentials.
- The Bun build output and server asset path agree; installed execution resolves assets relative to the package, not the caller’s working directory.
- The package is prepared for publishing but is not published; no registry or deployment state is changed.

**Files:** `package.json`, `scripts/build-bun.ts`, `server/bun-server.ts`, CLI entry point as needed.

### [x] Task 2: Provide safe CLI configuration (30–60 minutes)
**Status:** Implemented; Task 2 source review PASS following the minimal legacy artifact-root fix. Source confirms explicit option arrays (including empty) override the environment; explicitly empty/comma-whitespace environment values remain empty; only an absent environment value uses legacy defaults. Includes strict CLI parsing, shared CLI/server validation, isolated loopback trust defaults, explicit remote trust, XDG-aware CLI service-file selection, sanitized credential/startup diagnostics, and manual redirects for credential-bearing engine HTTP requests. Help/version defer service imports and never read credentials or start watchers. Existing no-argument direct and dev entrypoints retain legacy configuration defaults. Runtime/package verification remains UNVERIFIED and pending authorization; this is not production-readiness approval. No tests, checks, commands, builds, packing, CLI execution, registry/git/deployment changes, or live-state mutations performed. Task 3 documentation remains separate.
**Description:** Connect the executable to the existing Bun server and implement agreed flags for its supported configuration; document or resolve unspecified flag behavior before adding options.

**Acceptance criteria:**
- `bunx opencode-ui` starts the packaged production server without Vite; supported flags are parsed, invalid values produce actionable errors, and help describes defaults and usage.
- Engine and credential prerequisites are explicit; avoid machine-specific artifact paths as an unqualified universal requirement.
- Explicit host/Origin and WebSocket guards, route/method and JSON checks, no-store responses, artifact safety and credential secrecy remain intact. Non-loopback access does not silently broaden trust.

**Files:** CLI entry point, `server/bun-server.ts`, existing security configuration as needed.

### [x] Task 3: Document installation and operation (30–60 minutes)
**Status:** Implemented; Task 3 source review PASS. README matches the inspected CLI flags, environment defaults, package scripts, separate engine/service credential prerequisite, explicit remote trust and access boundary, opt-in artifacts, Bun development and direct-server asset differences, and intended publisher prepack workflow. It explicitly does not claim publication or release readiness. Documentation review is source-only; no tests, checks, commands, builds, CLI execution, registry/git/deployment changes, or live-state mutations performed. Package-name availability, registry credentials, publication, and runtime/package behavior remain UNVERIFIED; this is not release-readiness approval.
**Description:** Replace outdated Vite-specific run guidance with accurate Bun CLI production instructions and describe packaging prerequisites.

**Acceptance criteria:**
- README explains `bunx opencode-ui`, the implemented flags and defaults, supported Bun and compatible separate OpenCode engine requirements, credential setup, and relevant environment settings.
- Security guidance states that there is no browser login and describes the need for an access boundary and secure transport; no secrets are printed or included.
- Existing local development instructions accurately reflect the Bun scripts and do not instruct users to edit nonexistent Vite configuration.

**Files:** `README.md`.

## Packaging Constraints and Quality Notes

- `package.json` is currently `private: true` and has no `bin`; the Bun build emits `dist-bun-build` while the production server expects `dist-bun`. Resolve this mismatch as part of packaging.
- The current server reads `~/.config/opencode/service.json`, targets `127.0.0.1:8090`, defaults to port `5174` and loopback binding, and uses `/tmp/opencode/shots` as its default artifact root. These are current implementation details, not confirmed universal requirements.
- The build copies `public/` and emits CSS, fonts, chunks and the PDF worker; include the complete output in the distributable. Build tooling is in dev dependencies, so published installation must not require a consumer-side source build.
- No tests, checks, server startup or screenshot capture are authorized for this task. Implementation acceptance criteria are targets, not claims of verification.
