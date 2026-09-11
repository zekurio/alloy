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
  src/clips/            clip access, playback, and event helpers
  src/storage/          storage drivers and upload token flow
  src/queue/            media processing queue (ffprobe/ffmpeg probe/trim/encode)
  src/config/           env-backed config and DB-backed instance settings
  src/runtime/          path, shutdown, response, and process helpers
```

## Commands

```bash
pnpm --filter @alloy/server dev
pnpm --filter @alloy/server build
pnpm --filter @alloy/server start
pnpm test packages/server
pnpm --filter @alloy/server typecheck
```

Database commands are available from either root or this package:

```bash
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:studio
```

Production startup applies pending Drizzle migrations automatically.
`PUBLIC_SERVER_URL` must use an externally reachable HTTPS origin. Terminate
TLS and set HSTS at the reverse proxy. Local development can still use loopback
HTTP.

## Local Development

Use a devenv shell, which runs its own Postgres on a random free localhost port
and exports `DATABASE_URL`, or provide a local Postgres yourself. Non-devenv
local development can use `packages/server/.env`, whose default database URL
matches the Podman-published local Postgres. Then run the server:

```bash
pnpm dev:server
```

`PORT`, `PUBLIC_SERVER_URL`, storage, auth policy, OAuth, and integration
settings are parsed in `src/env.ts`; `DATABASE_URL`,
`ALLOY_VIEWER_COOKIE_SECRET`, and `ALLOY_UPLOAD_HMAC_SECRET` are required.
Shell environment always wins over `.env` files.

## Production

`pnpm --filter @alloy/server build` emits `packages/server/dist`. The Nix package
copies that output and wraps it with runtime defaults for:

- `WEB_DIST_DIR`
- `ALLOY_MIGRATIONS_DIR`
- `NODE_ENV=production`

## Desktop HTTP compatibility

`GET /api/server-info` publishes exact desktop HTTP contract IDs. Alloy has one
operator and no external deployments, so contract 1 can change when the desktop
and server are updated together. Once independent deployments exist, version
breaking changes and define a support window for older clients.

Product SemVer is diagnostic only. The desktop requires compatible IDs in
`/api/server-info` and rejects a server that does not provide that document.

## Guidelines

Prefer shared validation and contracts from `@alloy/contracts` and `@alloy/api`.
Keep upload, playback, and queue paths defensive: failures should produce clear
status, avoid partial state where possible, and not wedge future interactions.
