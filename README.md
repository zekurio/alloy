# alloy

Alloy is an open-source alternative to Medal.tv.

It is still a work in progress. Self-hosting is not polished yet, and Docker support exists but will be improved.

> **AI Disclaimer & Warning:** This is a personal project developed in my free time. I use AI to assist with development. I do my best to follow best practices and keep the code maintainable.

## Quick dev setup

If you use Nix, the fastest way to get started is with the flake:

```bash
nix develop
```

This shell provides `node`, `pnpm`, `psql`, PostgreSQL 17, and `ffmpeg`.

Then install dependencies:

```bash
pnpm install
```

## Local database

By default, `nix develop` handles most of the setup:

- Initializes a local PostgreSQL 17 cluster in `.pg`
- Starts it on `127.0.0.1:5432` if it is not already running
- Creates the `alloy` database
- Exports `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, and `PGDATABASE`

`.pg` is already gitignored in this repository.

Open a shell with:

```bash
psql "$DATABASE_URL"
```

Stop the local database started from the flake shell with:

```bash
alloy_pg_stop
```

If you prefer Docker for just the database, `compose.yaml` starts a PostgreSQL 17 instance with matching defaults:

```bash
docker compose up -d
psql postgresql://postgres:postgres@localhost:5432/alloy
```

## Environment

Copy the example environment files:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

For the local setup above, use:

```bash
DATABASE_URL=postgres://postgres@localhost:5432/alloy
```

The example file uses `postgres:postgres`. If you want to use the flake-managed local database, update `apps/server/.env` to match the value above.

## Run the app

Apply the database schema:

```bash
pnpm db:push
```

Start everything:

```bash
pnpm dev
```

This runs the web app on http://localhost:5173 and the server on http://localhost:3000.

In development, the frontend and API stay split so Vite can provide fast HMR.
Set `VITE_SERVER_URL=http://localhost:3000` in `apps/web/.env` and keep
`TRUSTED_ORIGINS=http://localhost:5173` in `apps/server/.env`.

## Production container

Production uses one Alloy application container: `ghcr.io/<owner>/<repo>-server`.
The server listens on port `3000`, serves `/api/*`, and mounts the built web app
from the same origin. Browser API calls therefore default to the current origin;
you should set `PUBLIC_SERVER_URL` to the public URL users visit.

PostgreSQL is not bundled in the application container. Provide it separately
and set `DATABASE_URL`.

The server image sets `SERVE_WEB=true` and `WEB_DIST_DIR=../web/dist`, so startup
fails if the web build is missing.

## Contributing

Contributions are not being accepted at this time.
