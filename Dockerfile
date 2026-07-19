# SerikaCord Dockerfile
# Multi-stage build for optimal production image

FROM oven/bun:1 AS base

# Install dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
# Cache mounts persist webpack's incremental compilation cache across builds.
# This dramatically speeds up rebuilds (only changed modules are recompiled).
RUN --mount=type=cache,id=serikacord-next-cache,target=/app/.next/cache \
    --mount=type=cache,id=serikacord-node-cache,target=/app/node_modules/.cache \
    bun run build

# Production stage — runs the custom server (Next.js + bot gateway, one port).
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Full app: the custom server needs source (server.ts, src/) and the build.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "server.ts"]
