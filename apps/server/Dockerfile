FROM denoland/deno:2.7.14 AS base
USER root
COPY apps/server/docker/install-ffmpeg-hwaccel-deps.sh /tmp/install-ffmpeg-hwaccel-deps.sh
RUN sh /tmp/install-ffmpeg-hwaccel-deps.sh \
  && rm /tmp/install-ffmpeg-hwaccel-deps.sh \
  && mkdir -p /app /var/lib/alloy /var/cache/alloy/encode \
  && chown -R deno:deno /app /var/lib/alloy /var/cache/alloy
ENV FFMPEG_BIN=/usr/lib/jellyfin-ffmpeg/ffmpeg
ENV FFPROBE_BIN=/usr/lib/jellyfin-ffmpeg/ffprobe
ENV DENO_NO_PROMPT=1
WORKDIR /app
USER deno

FROM base AS deps
COPY --chown=deno:deno deno.json package.json deno.lock ./
COPY --chown=deno:deno apps/server/package.json apps/server/package.json
COPY --chown=deno:deno apps/web/package.json apps/web/package.json
COPY --chown=deno:deno packages/api/package.json packages/api/package.json
COPY --chown=deno:deno packages/contracts/package.json packages/contracts/package.json
COPY --chown=deno:deno packages/db/package.json packages/db/package.json
COPY --chown=deno:deno packages/ui/package.json packages/ui/package.json
RUN deno install --frozen

FROM deps AS server
COPY --chown=deno:deno . .
RUN deno task --cwd apps/server build \
  && touch /tmp/server-build-ok

FROM deps AS web
COPY --chown=deno:deno . .
RUN deno task --cwd apps/web build

FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --chown=deno:deno --from=deps /app/deno.json /app/package.json /app/deno.lock /app/
COPY --chown=deno:deno --from=deps /app/node_modules /app/node_modules
COPY --chown=deno:deno --from=deps /app/apps/server/package.json /app/apps/server/package.json
COPY --chown=deno:deno --from=deps /app/apps/web/package.json /app/apps/web/package.json
COPY --chown=deno:deno --from=deps /app/packages/api/package.json /app/packages/api/package.json
COPY --chown=deno:deno --from=deps /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --chown=deno:deno --from=deps /app/packages/db/package.json /app/packages/db/package.json
COPY --chown=deno:deno --from=deps /app/packages/ui/package.json /app/packages/ui/package.json
COPY --chown=deno:deno --from=deps /app/apps/web/node_modules /app/apps/web/node_modules
COPY --chown=deno:deno --from=deps /app/packages/api/node_modules /app/packages/api/node_modules
COPY --chown=deno:deno --from=deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --chown=deno:deno --from=deps /app/packages/db/node_modules /app/packages/db/node_modules
COPY --chown=deno:deno --from=deps /app/packages/ui/node_modules /app/packages/ui/node_modules
COPY --chown=deno:deno --from=server /deno-dir /deno-dir
COPY --chown=deno:deno --from=server /app/apps/server/src /app/apps/server/src
COPY --chown=deno:deno --from=server /app/apps/server/tsconfig.json /app/apps/server/tsconfig.json
COPY --chown=deno:deno --from=server /app/packages/contracts/src /app/packages/contracts/src
COPY --chown=deno:deno --from=server /app/packages/contracts/tsconfig.json /app/packages/contracts/tsconfig.json
COPY --chown=deno:deno --from=server /app/packages/db/src /app/packages/db/src
COPY --chown=deno:deno --from=server /app/packages/db/drizzle /app/packages/db/drizzle
COPY --chown=deno:deno --from=server /app/packages/db/tsconfig.json /app/packages/db/tsconfig.json
COPY --from=server /tmp/server-build-ok /tmp/server-build-ok
COPY --from=web /app/apps/web/dist /build/www
WORKDIR /app/apps/server
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_DIR=/build/www
ENV ALLOY_MIGRATIONS_DIR=/app/packages/db/drizzle
ENV ALLOY_CONFIG_FILE=/var/lib/alloy/runtime-config.json
ENV ENCODE_SCRATCH_DIR=/var/cache/alloy/encode
EXPOSE 3000
CMD ["deno", "run", "--quiet", "--cached-only", "--node-modules-dir=none", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "--allow-run", "src/index.ts"]
