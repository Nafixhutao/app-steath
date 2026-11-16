# syntax=docker/dockerfile:1
#
# One image runs the three Node processes of the platform:
#
#   control-plane   next start
#   worker          node worker/index.mts
#   migrate         node scripts/migrate.mts
#
# They share one codebase, so a single image keeps them in lockstep: a migration
# can never run against code from a different commit than the Control Plane.
#
# The image is not built from `.next/standalone`. The worker and the migration
# script import `lib/` directly through Node's TypeScript support, which output
# tracing does not cover, so the runner keeps the full build plus production
# `node_modules` instead.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The browser bundle inlines NEXT_PUBLIC_* at build time, so the public origin has
# to be known here. It is a public URL, not a secret.
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=${NEXT_PUBLIC_BETTER_AUTH_URL}

# Placeholders only. The pools connect lazily and the real values arrive at
# runtime from the environment; nothing here is baked into a server bundle.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    BETTER_AUTH_SECRET="build-placeholder-secret-at-least-32-chars" \
    BETTER_AUTH_URL="http://localhost:3000"

RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# `.next` carries the image-optimizer cache (`cache/images`), which `next start`
# writes at runtime, so it belongs to the runtime user rather than root.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# Runtime code shared by the worker and the migration script. The migration
# runner reads `database/migrations` from the working directory, so the SQL files
# have to ship with the image.
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/scripts/migrate.mts ./scripts/migrate.mts
COPY --from=builder /app/database ./database

# Without S3 credentials a Backup is written to disk. The directory belongs to the
# runtime user so a named Volume mounted here inherits that owner: Docker copies
# the image's directory metadata into a fresh Volume.
RUN mkdir -p /app/backups && chown nextjs:nodejs /app/backups

USER nextjs
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
