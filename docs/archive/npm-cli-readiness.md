# Bun CLI integration readiness — source only

**Date:** 2026-11-01  
**Source assessment:** no additional implementation blocker identified in the reviewed CLI/package integration.  
**Runtime/package verification:** **UNVERIFIED**.  
**Release readiness:** **NEEDS WORK** — not production or publication certification.

## Evidence and findings

- `npm-cli-tasklist.md` records all three source QA passes, including the shared runtime-module packaging fix and legacy artifact-root retry fix. These are source assessments, not execution evidence. Its final “Packaging Constraints” bullets describing private metadata and the old output mismatch are historical baseline notes; current files supersede those descriptions.
- `package.json:5–43` matches the architecture: Bun 1.4.4, a Bun-shebang TypeScript executable, explicit runtime/production-output allowlist, no private flag, publisher-side production `prepack`, and no consumer install build hook. The inspected server import graph is covered, including `src/lib/agent-config-types.ts`; that shared module has no imports. External runtime imports `jsonc-parser`, `yaml`, and `web-push` are declared dependencies. This establishes source closure, not actual tarball contents or successful dependency installation.
- `scripts/build-bun.ts:24–34,236–294` emits `dist-bun-build/` outside dev mode, includes copied public assets and emitted CSS/fonts/chunks/URL assets, and stages replacement without overwriting legacy `dist-bun/`. Only the production NODE_ENV constant is explicitly defined for browser bundling. Generated assets and release contents have not been inspected or executed.
- `bin/opencode-ui.ts:41–100` parses scalar/list flags, rejects unsupported syntax and duplicate scalars, handles help/version before service imports, resolves user paths against cwd, and resolves frontend assets relative to the package. CLI trust is explicitly loopback-only by default; remote binding requires explicit non-loopback host and origin additions. Artifact roots default to empty. Startup errors do not echo arbitrary exceptions or credential-bearing inputs.
- `server/bun-config.ts` and `server/bun-server.ts:24–99` share validation, read a nonempty registration password only after configuration/assets validation, and inject server-only Basic authorization. Explicit roots (including empty arrays) override environment roots; empty environment roots stay empty; only absent environment roots use legacy defaults. Direct/dev asset and trust behavior remains separate from CLI behavior.
- Gateway/proxy/security source retains Host/Origin and WebSocket guards, route/method restrictions, JSON mutation checks, response security/cache policy, and removal of upstream CORS headers. Credential-bearing engine HTTP call sites in `web-proxy.ts`, `agent-config.ts`, `artifact-delivery.ts`, and `notifications.ts` use manual redirects. CLI root configuration still enters the existing artifact service rather than bypassing its provenance checks. This is not a fresh comprehensive security audit.
- README documents the separate compatible engine/credential prerequisite, implemented options, explicit remote access boundary, opt-in artifacts, direct/dev differences, and intended publishing workflow. Its stale pending-source-QA sentence is now corrected. There is still no browser authentication; allowlists do not make public or multi-tenant deployment safe.

## Outstanding release gates

1. After execution is authorized, build and pack with the supported Bun version; inspect the actual archive for complete assets/runtime modules and absence of private state or secrets. Verify executable installation and runtime dependencies without consumer dev dependencies.
2. Smoke-test the installed package from an unrelated cwd: credential-free help/version, invalid arguments and sanitized errors, frontend loading with a compatible separate engine, HTTP/SSE/PTY behavior, trust rejection/explicit remote configuration, artifact defaults, and direct/dev compatibility. Runtime behavior, package lifecycle, asset loading, and executable permissions are all **UNVERIFIED** here.
3. Confirm registry name availability/ownership and publishing authorization privately; publish only when authorized after package verification. Neither ownership nor publication is established by source metadata. Verify the published installation path before claiming `bunx opencode-ui` is available to users.

## Review limits

Source reads/navigation only; the knowledge graph was stale relative to HEAD and was used only for initial orientation. Actual source controlled this assessment. No shell commands, CLI execution, builds, lint/type checks, tests, packing, screenshots, registry/service calls, git-state mutations, or live-state changes were performed. Only this report and README documentation were edited. No visual certification, runtime pass, quality score, or readiness percentage is asserted.
