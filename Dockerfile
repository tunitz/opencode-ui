# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY plugins/notes/package.json plugins/notes/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN OPENCODE_UI_BUILD_TARGET=production bun run build:bun && \
    bun run build:server:bundle

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/tunitz/opencode-ui" \
      org.opencontainers.image.description="Mobile-first web client for OpenCode V2 engine"

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/data \
    XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/data/config \
    OPENCODE_UI_HOST=0.0.0.0 \
    OPENCODE_UI_PORT=5174 \
    OPENCODE_UI_ROOT=/app \
    OPENCODE_UI_ASSET_DIR=/app/dist-bun-build

COPY --from=build --link --chown=1000:1000 /app/dist/server.js ./dist/server.js
COPY --from=build --link --chown=1000:1000 /app/dist-bun-build ./dist-bun-build
COPY --from=build --link --chown=1000:1000 /app/plugins/notes/src ./plugins/notes/src
COPY --from=build --link --chown=1000:1000 /app/plugins/notes/package.json ./plugins/notes/package.json

RUN mkdir -p /data /data/config && chown -R bun:bun /data
VOLUME /data

USER bun
EXPOSE 5174

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:5174/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "/app/dist/server.js"]
