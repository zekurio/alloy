FROM docker.io/library/node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg openssl postgresql postgresql-contrib tini \
  && rm -rf /var/lib/apt/lists/*
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
ARG TARGETARCH
ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV ALLOY_DATA_DIR=/data
ENV PGDATA=/data/postgres
ENV POSTGRES_DB=alloy
ENV POSTGRES_USER=alloy
ENV POSTGRES_PASSWORD=alloy
ENV MINIO_DATA_DIR=/data/minio
ENV MINIO_ROOT_USER=alloy
ENV MINIO_ROOT_PASSWORD=alloy-minio-password
ENV MINIO_BUCKET=alloy
ENV PORT=3000
ENV WEB_PORT=8080
ENV INTERNAL_API_URL=http://127.0.0.1:3000
ENV PUBLIC_APP_URL=http://localhost:8080
ENV PUBLIC_API_URL=http://localhost:8080
ENV BETTER_AUTH_URL=http://localhost:8080
ENV TRUSTED_ORIGINS=http://localhost:8080
ENV STORAGE_DRIVER=s3
ENV STORAGE_PUBLIC_BASE_URL=http://localhost:8080
ENV S3_REGION=us-east-1
ENV S3_ENDPOINT=http://127.0.0.1:9000
ENV S3_FORCE_PATH_STYLE=true
ENV RUNTIME_CONFIG_PATH=/data/runtime-config.json
ENV ENCODE_SCRATCH_DIR=/data/encode
RUN case "$TARGETARCH" in \
    amd64) minio_arch=amd64 ;; \
    arm64) minio_arch=arm64 ;; \
    *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://dl.min.io/server/minio/release/linux-${minio_arch}/archive/minio.${MINIO_RELEASE}" -o /usr/local/bin/minio \
  && curl -fsSL "https://dl.min.io/client/mc/release/linux-${minio_arch}/archive/mc.${MINIO_MC_RELEASE}" -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/minio /usr/local/bin/mc
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=deps /app/packages/api/node_modules /app/packages/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules /app/packages/db/node_modules
COPY . .
COPY --from=web-build /app/apps/web/.output /app/apps/web/.output
COPY apps/aio/entrypoint.sh /usr/local/bin/alloy-aio
RUN chmod +x /usr/local/bin/alloy-aio
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["tini", "--", "alloy-aio"]
