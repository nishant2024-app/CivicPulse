# syntax=docker/dockerfile:1.7
#
# One Dockerfile, three images (api, workers, web):
#   docker build -f infrastructure/docker/Dockerfile --target api     -t civicpulse-api .
#   docker build -f infrastructure/docker/Dockerfile --target workers -t civicpulse-workers .
#   docker build -f infrastructure/docker/Dockerfile --target web     -t civicpulse-web .
#
# Stages are shared, so building all three installs and compiles the workspace once.
# Every runtime image is small, runs as a non-root user and has a health check.

ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=10.28.0

# Optional: CA certificates to trust while building (corporate or sandbox TLS-intercepting
# proxies). Supply with `--build-context extra-ca=<directory of .crt files>`; empty by default.
FROM scratch AS extra-ca

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
COPY --from=extra-ca / /tmp/extra-ca/
RUN for f in /tmp/extra-ca/*.crt; do [ -f "$f" ] && cat "$f" >> /etc/ssl/certs/ca-certificates.crt; done; rm -rf /tmp/extra-ca
# Node uses its own CA list; point it at the system store so extra CAs apply to corepack and pnpm.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo

# ---------- dependencies: cached until the lockfile changes ----------
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# ---------- build: install offline from the fetched store, compile everything ----------
FROM fetch AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
# The web app bakes its API address into the rewrite rules at build time. Kubernetes and
# Compose both name the API service "api".
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @civicpulse/api build \
 && pnpm --filter @civicpulse/workers build \
 && pnpm --filter @civicpulse/web build
# Production-only dependency trees (npm packages stay external to the bundles).
RUN npm_config_node_linker=hoisted pnpm --filter @civicpulse/api deploy --legacy --prod /out/api \
 && npm_config_node_linker=hoisted pnpm --filter @civicpulse/workers deploy --legacy --prod /out/workers
# The migration files ship inside the API image so a Kubernetes Job can apply them.
RUN mkdir -p /out/api/migrations && cp -r packages/db/migrations/. /out/api/migrations/

# ---------- runtime: api ----------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api/package.json ./
COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/dist ./dist
COPY --from=build --chown=node:node /out/api/migrations ./migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/healthz >/dev/null || exit 1
CMD ["node", "dist/server.js"]

# ---------- runtime: workers ----------
FROM ${NODE_IMAGE} AS workers
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/workers/package.json ./
COPY --from=build --chown=node:node /out/workers/node_modules ./node_modules
COPY --from=build --chown=node:node /out/workers/dist ./dist
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4100/healthz >/dev/null || exit 1
CMD ["node", "dist/main.js"]

# ---------- runtime: web (Next.js standalone) ----------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
