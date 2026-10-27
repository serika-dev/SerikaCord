# syntax=docker/dockerfile:1.7
#
# SerikaCord: one Bun process (server.ts) serving the API, SSE, the bot
# gateway and the Next.js app. Built by Coolify's "Dockerfile" build pack.
#
# Why not Railpack: it builds in a separate BuildKit container, so every deploy
# exported the finished image as a tarball and imported it back into Docker
# (~3 min), and it copied the whole repo (incl. ~1.5 GB of committed Tauri
# build output) into the image. This file builds straight into the Docker
# daemon, keeps the build context small (.dockerignore) and reuses the
# dependency and webpack caches between deploys.

ARG NODE_VERSION=22.23.4
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION}-slim AS bun

# Node runs `next build` (as on Railpack); Bun installs and runs the server.
FROM node:${NODE_VERSION}-bookworm-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── Dependencies: only re-run when the manifest or lockfile changes ──────────
FROM base AS deps
COPY package.json bun.lock ./
RUN --mount=type=cache,id=serikacord-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .

# Commit being built (Coolify passes it as a build arg when "Include Source
# Commit in Build" is on). .git is dockerignored, so this is the only way the
# build learns its SHA — next.config.ts inlines it, see src/lib/version.ts.
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
ENV NODE_ENV=production

# The webpack cache persists between deploys, so only changed modules are
# recompiled.
RUN --mount=type=cache,id=serikacord-next-cache,target=/app/.next/cache \
    bun run build

# ── Runtime ──────────────────────────────────────────────────────────────────
# The custom server imports the API straight from src/ and needs the build,
# so the runtime is the build stage itself: no extra copies to export.
FROM build AS runtime
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=16 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
EXPOSE 3000
CMD ["bun", "server.ts"]
