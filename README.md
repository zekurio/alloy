# alloy

Alloy is an open-source alternative to medal.tv.

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

## Container hardware encoding

The `server` and `aio` images use Jellyfin's ffmpeg build plus VA-API, Intel
Media SDK, oneVPL, and Mesa Vulkan/VA userspace packages so the same image can
run on common NVIDIA, Intel, and AMD hosts. The host still has to expose the GPU
to the container.

The AIO image is meant for simple deploys: mount `/data` and it will use the
embedded Postgres instance plus filesystem storage under `/data/storage` without
requiring database or storage environment variables. Use the split deployment
with an external S3-compatible bucket when you want object storage to serve
upload and download bandwidth directly.

For Intel QSV or VA-API, and for AMD VA-API/AMF setups, pass the render device:

```bash
docker run --device /dev/dri:/dev/dri ghcr.io/<owner>/<repo>-aio:unstable
```

For NVIDIA NVENC, install the NVIDIA Container Toolkit on the host and pass the
GPU plus video capabilities:

```bash
docker run --gpus all \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  ghcr.io/<owner>/<repo>-aio:unstable
```

In Alloy's admin encoder settings, choose the global hardware acceleration
method, then choose an output codec on each variant. QSV and VA-API show a
device field; use `/dev/dri/renderD128` unless your host exposes a different
render node. The capability probe in the admin UI is the source of truth for
which encoders the running container can actually use.

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

## Contributing

Contributions are not being accepted at this time.
