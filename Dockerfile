# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

FROM base AS build

ENV DO_NOT_TRACK=1
ENV TURBO_TELEMETRY_DISABLED=1

COPY . .

RUN pnpm install --frozen-lockfile --filter @alloy/server... --filter @alloy/web...
RUN pnpm --filter @alloy/server build && pnpm --filter @alloy/web build

RUN mkdir -p /out/server /out/web /out/migrations \
  && cp -R packages/server/dist /out/server/dist \
  && cp packages/server/package.json /out/server/package.json \
  && node scripts/prune-server-node-modules.mjs . /out/server \
  && cp -R packages/web/dist/. /out/web \
  && cp -R packages/db/drizzle/. /out/migrations

FROM node:24-bookworm-slim AS runtime

ARG APP_VERSION=0.0.1

LABEL org.opencontainers.image.title="alloy"
LABEL org.opencontainers.image.description="Open-source and self-hostable alternative to Medal.tv"
LABEL org.opencontainers.image.source="https://github.com/zekurio/alloy"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
LABEL org.opencontainers.image.version=$APP_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1993 alloy \
  && useradd --system --uid 1993 --gid alloy --home-dir /app --shell /usr/sbin/nologin alloy

WORKDIR /app

ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/web
ENV ALLOY_MIGRATIONS_DIR=/app/migrations
ENV PORT=2552
ENV APP_VERSION=$APP_VERSION
ENV ALLOY_STORAGE_DRIVER=fs
ENV ALLOY_STORAGE_FS_CLIPS_PATH=/data/storage/clips
ENV ALLOY_STORAGE_FS_USERS_PATH=/data/storage/users

COPY --from=build --chown=alloy:alloy /out/server /app/server
COPY --from=build --chown=alloy:alloy /out/web /app/web
COPY --from=build --chown=alloy:alloy /out/migrations /app/migrations
COPY scripts/docker-entrypoint.sh /usr/local/bin/alloy-entrypoint

RUN chmod +x /usr/local/bin/alloy-entrypoint \
  && mkdir -p /data/storage/clips /data/storage/users \
  && chown -R alloy:alloy /app /data

EXPOSE 2552

ENTRYPOINT ["alloy-entrypoint"]
CMD ["node", "/app/server/dist/index.js"]
