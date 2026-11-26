# Security Policy

## Supported Versions

Security fixes are applied to `main` and released via the latest version tag and container image.

| Version | Supported |
| --- | --- |
| Latest release (`main`) | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately through GitHub Security Advisories:

- <https://github.com/tunitz/opencode-ui/security/advisories/new>

Include a clear description of the issue, steps to reproduce or proof-of-concept, affected versions/deployment mode, and potential impact. You will receive an acknowledgement as soon as possible.

## Security Model and Scope

- OpenCode UI uses a **single shared UI password** (argon2id hash + HTTP-only `SameSite=Lax` session cookie) protecting `/api/*`, SSE, and PTY WebSocket upgrades. It is an access boundary for a single operator/trusted group, **not** multi-tenant isolation.
- Saved engine credentials stay on the UI server (`0600` state files) and are injected server-side.
- Host and Origin allowlists, WebSocket origin checks, JSON mutation checks, artifact-root checks, and `no-store` API headers are enforced by default.
- Always terminate **TLS (HTTPS)** in front of OpenCode UI when exposing it beyond loopback or a trusted private network, and protect the upstream OpenCode V2 engine independently.
- Notes and attachments are stored as plaintext on disk (`0700` dir / `0600` files); do not store secrets inside notes.
