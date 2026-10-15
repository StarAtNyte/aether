# Aether server + studio in one container (optional self-hosting; the public
# copy of the studio is a static site, see docs/DEPLOYMENT.md).
#
#   docker build -t aether .
#   docker run --rm -p 127.0.0.1:8787:8787 -v aether-data:/data aether
#
# Stages: `build` compiles the studio and precompresses it (Brotli + gzip),
# `deps` installs production dependencies only, and the runtime image runs the
# TypeScript server with tsx as the unprivileged `node` user. The image never
# runs anyone's Codex / Claude Code login (AETHER_HOSTED=1 forbids local AI)
# and needs no model key: without one it serves the offline planner.

# Node 24 LTS (the version CI and development use).
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=1 \
    NODE_OPTIONS=--max-old-space-size=2048
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY assets/catalog.json assets/manifest.json assets/heroes.json assets/sources.json ./assets/
COPY assets/lib ./assets/lib
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
RUN npm run build \
 && npx tsx scripts/precompress.ts apps/studio/dist

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CI=1
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY assets/catalog.json ./assets/
# Production dependencies only. The Codex CLI binaries (~430 MB) are only used
# by local AI, which this image never enables, so they are removed.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/@openai/codex-linux-* node_modules/@openai/codex-darwin-* node_modules/@openai/codex-win32-* \
           apps/studio/src apps/studio/public apps/cli \
 && npm cache clean --force

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Aether" \
      org.opencontainers.image.description="Describe a world in plain language and get a physically verified, playable 3D scene in the browser." \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    AETHER_HOSTED=1 \
    AETHER_LOCAL_AI=off \
    AETHER_PROVIDER=mock \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    LOG_LEVEL=info \
    NODE_OPTIONS=--max-old-space-size=384
COPY --from=deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/studio/dist /app/apps/studio/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Exec form, node directly (not npm): SIGTERM reaches the server for a graceful drain.
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
