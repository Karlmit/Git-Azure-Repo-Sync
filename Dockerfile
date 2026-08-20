# syntax=docker/dockerfile:1

# ---- Stage 1: build frontend ----
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci
COPY packages/frontend packages/frontend
RUN npm run build --workspace=packages/frontend

# ---- Stage 2: build backend ----
FROM node:20-slim AS backend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci
COPY packages/backend packages/backend
RUN npm run build --workspace=packages/backend
RUN npm prune --omit=dev

# ---- Stage 3: runtime ----
FROM node:20-slim AS runtime
ARG APP_VERSION=0.0.0-unknown
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}

COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/packages/backend/dist ./packages/backend/dist
COPY --from=backend-build /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=frontend-build /app/packages/frontend/dist ./packages/frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3012

# Stays root at container start on purpose: the entrypoint chowns whatever host
# folder is bind-mounted at /data to PUID:PGID (default 1000:1000, override via
# env vars) and then drops privileges via gosu before actually running node - the
# same pattern used by most self-hosted Docker images, so a plain bind mount to a
# root-owned host folder just works instead of crashing on SQLITE_CANTOPEN.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3012/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/backend/dist/index.js"]
