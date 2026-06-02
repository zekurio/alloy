FROM denoland/deno:2.7.14 AS deno-base

USER root

ENV DENO_NO_PROMPT=1

WORKDIR /app

RUN chown deno:deno /app

USER deno

FROM deno-base AS deps

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

USER deno

COPY --chown=deno:deno deno.json deno.lock ./
COPY --chown=deno:deno apps/server/deno.json apps/server/deno.json
COPY --chown=deno:deno apps/web/deno.json apps/web/deno.json
COPY --chown=deno:deno packages/api/deno.json packages/api/deno.json
COPY --chown=deno:deno packages/contracts/deno.json packages/contracts/deno.json
COPY --chown=deno:deno packages/db/deno.json packages/db/deno.json
COPY --chown=deno:deno packages/ui/deno.json packages/ui/deno.json

RUN deno install --frozen

FROM deno-base AS server-deps

COPY --chown=deno:deno deno.server.json deno.server.lock ./
COPY --chown=deno:deno apps/server/deno.json apps/server/deno.json
COPY --chown=deno:deno packages/contracts/deno.json packages/contracts/deno.json
COPY --chown=deno:deno packages/db/deno.json packages/db/deno.json
COPY --chown=deno:deno packages/logging/deno.json packages/logging/deno.json

RUN deno install \
  --config deno.server.json \
  --lock deno.server.lock \
  --frozen

FROM deps AS server-check

COPY --chown=deno:deno . .

RUN deno task --cwd apps/server build

FROM server-deps AS server

COPY --chown=deno:deno . .
COPY --chown=deno:deno --from=server-check /app/apps/server/dist/server-cache-ok /tmp/server-cache-ok

RUN deno compile \
    --config deno.server.json \
    --lock deno.server.lock \
    --cached-only \
    --frozen \
    --no-check \
    --unstable-sloppy-imports \
    --output /app/alloy \
    --allow-env \
    --allow-net \
    --allow-read \
    --allow-write \
    --allow-run \
    --allow-ffi \
    --allow-sys=osRelease \
    apps/server/src/index.ts

FROM deps AS web

COPY --chown=deno:deno . .

RUN deno task --cwd apps/web build

FROM debian:bookworm-slim AS runtime

USER root

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY apps/server/docker/install-ffmpeg-hwaccel-deps.sh /tmp/install-ffmpeg-hwaccel-deps.sh

RUN groupadd --system --gid 1993 deno \
  && useradd --system --uid 1993 --gid deno --home-dir /app --shell /usr/sbin/nologin deno \
  && sh /tmp/install-ffmpeg-hwaccel-deps.sh \
  && rm /tmp/install-ffmpeg-hwaccel-deps.sh \
  && mkdir -p /app /config /cache/encode /data \
  && chown -R deno:deno /app /config /cache /data

COPY --chown=root:root --from=server /app/alloy /usr/local/bin/alloy

COPY --chown=deno:deno --from=server /app/packages/db/drizzle /app/packages/db/drizzle

COPY --from=web /app/apps/web/dist /build/www

COPY --chown=root:root apps/server/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/server

ENV NODE_ENV=production
ENV PORT=2552
ENV FFMPEG_BIN=/usr/lib/jellyfin-ffmpeg/ffmpeg
ENV FFPROBE_BIN=/usr/lib/jellyfin-ffmpeg/ffprobe
ENV WEB_DIST_DIR=/build/www
ENV ALLOY_MIGRATIONS_DIR=/app/packages/db/drizzle

ENV ALLOY_CONFIG_FILE=/config/runtime-config.json
ENV ALLOY_STORAGE_DIR=/data/storage
ENV ENCODE_SCRATCH_DIR=/cache/encode

EXPOSE 2552

CMD ["/entrypoint.sh"]
