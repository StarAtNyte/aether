# Aether server + studio — single container.
# Build from the REPOSITORY ROOT:  docker build -f apps/server/Dockerfile -t aether .
# (BuildKit picks up apps/server/Dockerfile.dockerignore automatically.)

FROM node:22-slim AS build
WORKDIR /app
ENV CI=1
# Copy only what the build needs (never .env or local data).
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && rm -rf apps/server/data \
 && npm cache clean --force

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    AETHER_HOSTED=1 \
    AETHER_LOCAL_AI=off \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
# Source-level workspace exports + tsx at runtime mean the full workspace is shipped.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run node directly (not npm/npx) so SIGTERM reaches the server for graceful shutdown.
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
