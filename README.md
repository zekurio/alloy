# alloy

Alloy is an open-source alternative to Medal.tv.

It is still a work in progress. Self-hosting is not polished yet, and Docker support exists but will be improved.

> **AI Disclaimer & Warning:** This is a personal project developed in my free time. I use AI to assist with development. I do my best to follow best practices and keep the code maintainable.

## Quick dev setup

If you use Nix, the fastest way to get started is with the flake:

```bash
nix develop
```

This shell provides `deno`, `psql`, PostgreSQL 17, and `ffmpeg`.

Then install dependencies:

```bash
deno install
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

## Run the app

Apply the database schema:

```bash
deno task db:push
```

The server runs startup migrations only when `NODE_ENV=production`, which is
what the Docker image sets. Local development keeps `NODE_ENV=development` and
uses `db:push` instead, so Drizzle's dev push workflow does not collide with the
production migration journal.

Start everything:

```bash
deno task dev
```

This runs the web app on http://localhost:5173 and the server on http://localhost:3000.

In development, the frontend and API stay split so Vite can provide fast HMR.
The dev scripts provide the local server URL and trusted origin defaults.

## Deployment

Build the packaged web app and server bundle:

```bash
deno task build:prod
```

Run the bundled server with production migrations enabled:

```bash
NODE_ENV=production \
DATABASE_URL=postgres://... \
PUBLIC_SERVER_URL=https://alloy.example.com \
TRUSTED_ORIGINS=https://alloy.example.com \
deno task start:prod
```

`PUBLIC_SERVER_URL` must be the externally reachable origin in production.
Startup rejects localhost or loopback values so OAuth callbacks, WebAuthn,
generated media URLs, CORS, and secure cookies use the deployment host.

For Docker deployments, mount persistent storage for runtime config and encoder
scratch data:

```bash
-v alloy-config:/var/lib/alloy
-v alloy-encode:/var/cache/alloy
```

## Contributing

Contributions are not being accepted at this time.
