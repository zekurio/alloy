FROM docker.io/library/node:24-bookworm-slim AS base
COPY docker/install-ffmpeg-hwaccel-deps.sh /tmp/install-ffmpeg-hwaccel-deps.sh
RUN sh /tmp/install-ffmpeg-hwaccel-deps.sh openssl postgresql postgresql-contrib tini \
  && rm /tmp/install-ffmpeg-hwaccel-deps.sh
ENV FFMPEG_BIN=/usr/lib/jellyfin-ffmpeg/ffmpeg
ENV FFPROBE_BIN=/usr/lib/jellyfin-ffmpeg/ffprobe
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS web-build
COPY . .
RUN pnpm --filter web build

FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV ALLOY_DATA_DIR=/data
ENV PGDATA=/data/postgres
ENV POSTGRES_DB=alloy
ENV POSTGRES_USER=alloy
ENV POSTGRES_PASSWORD=alloy
ENV PORT=3000
ENV WEB_PORT=8080
ENV INTERNAL_API_URL=http://127.0.0.1:3000
ENV PUBLIC_APP_URL=http://localhost:8080
ENV PUBLIC_API_URL=http://localhost:8080
ENV BETTER_AUTH_URL=http://localhost:8080
ENV TRUSTED_ORIGINS=http://localhost:8080
ENV STORAGE_DRIVER=fs
ENV STORAGE_FS_ROOT=/data/storage
ENV STORAGE_PUBLIC_BASE_URL=http://localhost:8080
ENV RUNTIME_CONFIG_PATH=/data/runtime-config.json
ENV ENCODE_SCRATCH_DIR=/data/encode
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=deps /app/packages/api/node_modules /app/packages/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules /app/packages/db/node_modules
COPY . .
COPY --from=web-build /app/apps/web/.output /app/apps/web/.output
COPY docker/aio-entrypoint.sh /usr/local/bin/alloy-aio
RUN chmod +x /usr/local/bin/alloy-aio
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["tini", "--", "alloy-aio"]
