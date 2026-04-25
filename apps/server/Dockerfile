FROM docker.io/library/node:24-bookworm-slim AS base
COPY docker/install-ffmpeg-hwaccel-deps.sh /tmp/install-ffmpeg-hwaccel-deps.sh
RUN sh /tmp/install-ffmpeg-hwaccel-deps.sh \
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

FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=deps /app/packages/api/node_modules /app/packages/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules /app/packages/db/node_modules
COPY . .
WORKDIR /app/apps/server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
