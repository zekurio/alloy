FROM denoland/deno:2.7.14 AS base

USER root

COPY apps/server/docker/install-ffmpeg-hwaccel-deps.sh /tmp/install-ffmpeg-hwaccel-deps.sh

RUN sh /tmp/install-ffmpeg-hwaccel-deps.sh \
  && rm /tmp/install-ffmpeg-hwaccel-deps.sh \
  && mkdir -p /app /config /cache/encode /data \
  && chown -R deno:deno /app /config /cache /data

ENV FFMPEG_BIN=/usr/lib/jellyfin-ffmpeg/ffmpeg
ENV FFPROBE_BIN=/usr/lib/jellyfin-ffmpeg/ffprobe
ENV DENO_NO_PROMPT=1

WORKDIR /app

USER deno

FROM base AS deps

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

FROM deps AS server

COPY --chown=deno:deno . .

RUN deno task --cwd apps/server build \
  && deno compile \
    --cached-only \
    --frozen \
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

FROM base AS runtime

USER root

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY --chown=deno:deno --from=deps /app/deno.json /app/deno.lock /app/
COPY --chown=deno:deno --from=deps /app/apps/server/deno.json /app/apps/server/deno.json
COPY --chown=deno:deno --from=deps /app/apps/web/deno.json /app/apps/web/deno.json

COPY --chown=deno:deno --from=deps /app/packages/api/deno.json /app/packages/api/deno.json
COPY --chown=deno:deno --from=deps /app/packages/contracts/deno.json /app/packages/contracts/deno.json
COPY --chown=deno:deno --from=deps /app/packages/db/deno.json /app/packages/db/deno.json
COPY --chown=deno:deno --from=deps /app/packages/ui/deno.json /app/packages/ui/deno.json

COPY --chown=root:root --from=server /app/alloy /usr/local/bin/alloy
COPY --chown=deno:deno --from=server /deno-dir /deno-dir

COPY --chown=deno:deno --from=server /app/apps/server/src /app/apps/server/src
COPY --chown=deno:deno --from=server /app/apps/server/tsconfig.json /app/apps/server/tsconfig.json

COPY --chown=deno:deno --from=server /app/packages/contracts/src /app/packages/contracts/src
COPY --chown=deno:deno --from=server /app/packages/contracts/tsconfig.json /app/packages/contracts/tsconfig.json

COPY --chown=deno:deno --from=server /app/packages/db/src /app/packages/db/src
COPY --chown=deno:deno --from=server /app/packages/db/drizzle /app/packages/db/drizzle
COPY --chown=deno:deno --from=server /app/packages/db/tsconfig.json /app/packages/db/tsconfig.json

COPY --from=web /app/apps/web/dist /build/www

COPY --chown=root:root apps/server/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/server

ENV NODE_ENV=production
ENV PORT=2552
ENV WEB_DIST_DIR=/build/www
ENV ALLOY_MIGRATIONS_DIR=/app/packages/db/drizzle

ENV ALLOY_CONFIG_FILE=/config/runtime-config.json
ENV ENCODE_SCRATCH_DIR=/cache/encode

EXPOSE 2552

CMD ["/entrypoint.sh"]
