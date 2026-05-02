FROM oven/bun:1.3.13-debian AS base
COPY apps/server/docker/install-ffmpeg-hwaccel-deps.sh /tmp/install-ffmpeg-hwaccel-deps.sh
RUN sh /tmp/install-ffmpeg-hwaccel-deps.sh \
  && rm /tmp/install-ffmpeg-hwaccel-deps.sh
ENV FFMPEG_BIN=/usr/lib/jellyfin-ffmpeg/ffmpeg
ENV FFPROBE_BIN=/usr/lib/jellyfin-ffmpeg/ffprobe
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile

FROM deps AS server
COPY . .
RUN bun --filter @workspace/server build \
  && touch /tmp/server-build-ok

FROM deps AS web
COPY . .
RUN bun --filter web build

FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules /app/apps/web/node_modules
COPY --from=deps /app/packages/api/node_modules /app/packages/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules /app/packages/db/node_modules
COPY --from=deps /app/packages/ui/node_modules /app/packages/ui/node_modules
COPY . .
COPY --from=server /tmp/server-build-ok /tmp/server-build-ok
COPY --from=web /app/apps/web/dist /build/www
WORKDIR /app/apps/server
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_DIR=/build/www
ENV PUBLIC_SERVER_URL=http://localhost:3000
ENV TRUSTED_ORIGINS=http://localhost:3000
EXPOSE 3000
CMD ["bun", "src/index.ts"]
