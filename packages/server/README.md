# @alloy/server

Hono API server for Alloy. It owns auth, clips, uploads, playback, feeds, search,
admin instance settings, storage, encoding jobs, and production web asset
serving.

## Layout

```text
packages/server/
  src/index.ts          Node entrypoint
  src/app.ts            Hono app assembly
  src/web.ts            production web asset serving
  src/routes/           HTTP routes
  src/auth/             auth, sessions, OAuth, passkeys, desktop linking
  src/clips/            clip access, playback, direct-play HLS packaging
  src/storage/          storage drivers and upload token flow
  src/queue/            media processing queue (mediabunny probe/trim/package)
  src/config/           env-backed config and DB-backed instance settings
  src/runtime/          path, shutdown, response, and process helpers
```

## Commands

```bash
pnpm --filter @alloy/server dev
pnpm --filter @alloy/server build
pnpm --filter @alloy/server start
pnpm --filter @alloy/server typecheck
```

Database commands are available from either root or this package:

```bash
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:studio
```

## Local Development

Use a devenv shell, which runs its own Postgres on a random free localhost port
and exports `DATABASE_URL`, or provide a local Postgres yourself. Then run the
server:

```bash
pnpm dev:server
```

`PORT`, `PUBLIC_SERVER_URL`, storage, auth policy, OAuth, and integration
settings are parsed in `src/env.ts`; `DATABASE_URL`,
`ALLOY_VIEWER_COOKIE_SECRET`, and `ALLOY_UPLOAD_HMAC_SECRET` are required.
Shell environment always wins over the repo-root `.env` file.

## Production

`pnpm --filter @alloy/server build` emits `packages/server/dist`. The Nix package
copies that output and wraps it with runtime defaults for:

- `WEB_DIST_DIR`
- `ALLOY_MIGRATIONS_DIR`
- `NODE_ENV=production`

## Guidelines

Prefer shared validation and contracts from `@alloy/contracts` and `@alloy/api`.
Keep upload, playback, and queue paths defensive: failures should produce clear
status, avoid partial state where possible, and not wedge future interactions.
