# AGENTS.md — OpenCode UI

## Project

This is a standalone React, TypeScript, Vite, and Tailwind web client for an existing OpenCode V2
engine. The engine is a separate dependency; do not edit or fork its backend as part of this project.
Use Bun for dependency management and scripts; do not use npm, npx, pnpm, or yarn.

## Development

- Keep changes scoped and compatible with the pinned OpenCode client and native contracts. Prefer
  structured tool and file state over prose heuristics, and keep loading and error states honest.
- Use an installed OpenUI component when it fits, then shadcn/Base UI, then custom UI. Check the
  actual component capabilities and restrictions in [COMPONENTS.md](COMPONENTS.md).
- Preserve mobile and desktop accessibility: Light, Dark, and System themes, 44px targets,
  keyboard and focus behavior, RTL, reduced motion, and accessible names.
- Preserve composer behavior: on touch, Enter inserts a newline and only Send submits; on a
  fine-pointer desktop, Enter sends and Shift+Enter inserts a newline. Never submit during IME
  composition. Preserve browser-local drafts and preferences.
- Run appropriate verification without asking for separate permission. Report what was run and any
  unverified behavior. Real-model tests must use verified free/zero-cost models or explicit
  zero-cost paths; never silently fall back to paid or unknown models.

## Security and live state

- The UI server holds an engine credential; do not expose it to the browser or logs. Keep secrets,
  subscriptions, capability IDs, transcripts, and private state out of version control.
- Preserve explicit host and Origin checks, WebSocket guards, route/method allowlists, JSON
  mutation checks, no wildcard CORS, and `no-store` API responses. Do not bypass artifact
  provenance or file safety checks. See [CONTRACT.md](CONTRACT.md) for relevant details.
- There is no separate browser login. Do not represent the UI as safe for public or multi-tenant
  use without an appropriate access boundary and secure transport.
- Ask before mutating live sessions, PTYs, providers, notifications, credentials, engine or agent
  configuration, permission policies, or deployment state. Do not stage, commit, or push unless
  requested.

## References

[README.md](README.md) explains setup. [COMPONENTS.md](COMPONENTS.md),
[CONTRACT.md](CONTRACT.md), and [COMMANDS.md](COMMANDS.md) describe implementation details and
historical decisions; deployment-specific examples are not universal requirements.
