# alloy-server

Hono API server for Alloy. It owns auth, clips, uploads, playback, feeds, search,
notifications, admin/runtime config, storage, encoding jobs, and production web
asset serving.

## Layout

```text
packages/server/
  src/index.ts          Node entrypoint
  src/app.ts            Hono app assembly
  src/web.ts            production web asset serving
  src/routes/           HTTP routes
  src/auth/             auth, sessions, OAuth, passkeys, desktop linking
  src/clips/            clip access, playback, HLS/live helpers
  src/storage/          storage drivers and upload token flow
  src/queue/            encoding queue and ffmpeg integration
  src/config/           runtime config schema, secrets, store
  src/runtime/          path, shutdown, response, and process helpers
```

## Commands

```bash
pnpm --filter alloy-server dev
pnpm --filter alloy-server build
pnpm --filter alloy-server start
pnpm --filter alloy-server typecheck
pnpm --filter alloy-server test
```

Database commands are available from either root or this package:

```bash
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:studio
```

## Local Development

Start Postgres, then run the server:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
pnpm dev:server
```

The root dev runner sets defaults for `PORT`, `PUBLIC_SERVER_URL`,
`TRUSTED_ORIGINS`, `DATABASE_URL`, `ALLOY_DATA_DIR`, and storage/cache folders.

## Production

`pnpm --filter alloy-server build` emits `packages/server/dist`. The Nix package
copies that output and wraps it with runtime defaults for:

- `WEB_DIST_DIR`
- `ALLOY_MIGRATIONS_DIR`
- `FFMPEG_BIN`
- `FFPROBE_BIN`
- `NODE_ENV=production`

## Guidelines

Prefer shared validation and contracts from `alloy-contracts` and `alloy-api`.
Keep upload, playback, and queue paths defensive: failures should produce clear
status, avoid partial state where possible, and not wedge future interactions.
