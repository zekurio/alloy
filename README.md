# alloy

Alloy is an open-source alternative to Medal.tv.

It is still a work in progress. Self-hosting is not polished yet, and Docker support exists but will be improved.

> **AI Disclaimer & Warning:** This is a personal project developed in my free time. I use AI to assist with development. I do my best to follow best practices and keep the code maintainable.

## Quick dev setup

If you use Nix, the fastest way to get started is with the flake:

```bash
nix develop
```

This shell provides `deno`, `uv`, Python 3.11, `psql`, PostgreSQL 17, and
`ffmpeg`.

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

This runs the web app on http://localhost:5173, the server on
http://localhost:3000, and the optional ML service on http://localhost:3003.

In development, the frontend and API stay split so Vite can provide fast HMR.
The dev scripts provide the local server URL and trusted origin defaults.

## Optional machine learning service

Alloy includes an Immich-style Python service at `machine-learning/` for runtime
inference. The app server talks to it over HTTP, and the service owns model
loading, cache management, and inference. The current game classifier is
advisory: it should produce ranked suggestions, not silently choose or overwrite
the clip's game.

The classifier checkpoint is pulled at runtime from Hugging Face and cached
under `data/ml-cache`; it is not baked into the image. The default model is
pinned to Hugging Face commit
`05b8d2af2b704a21366e58e9fd6bef5cef2847cb`, and admins can change the game
classifier repo, revision, filename, or local checkpoint path from runtime
configuration.

For local Python development, run just the ML service:

```bash
deno task dev:ml
```

Or start the web app, API server, and ML service together with the standard dev
task:

```bash
deno task dev
```

The `dev:ml` task follows Immich's service workflow: it enters
`machine-learning/`, runs `uv sync --extra cpu`, sets
`MACHINE_LEARNING_CACHE_FOLDER=../data/ml-cache`, and starts
`python -m alloy_ml`. Set `MACHINE_LEARNING_UV_SYNC=0` to skip dependency sync
after the first run.

For container development, use the ML compose profile:

```bash
deno task ml:up
```

Use `deno task ml:start` to run it detached and `deno task ml:stop` to stop
only the ML container.

The service listens on http://localhost:3003 and exposes `/ping`, `/health`,
`/predict`, and `/v1/game-classifier/predict`. See
[`machine-learning/README.md`](./machine-learning/README.md) for the request
contract.

The Alloy server exposes the classifier as an authenticated advisory API:

- `GET /api/ml/config` returns the client-safe frame sampling limits.
- `POST /api/ml/game-suggestions` accepts `multipart/form-data` with repeated
  JPEG or PNG `frames` fields and optional `topK`.

## Deployment

### NixOS

The flake exposes an `x86_64-linux` package and NixOS module. Pin Alloy to a
release tag and make it follow your system `nixpkgs` input so the same Alloy
module can be used with either the current stable channel or unstable:

```nix
inputs.alloy.url = "github:zekurio/alloy/v0.0.1";
inputs.alloy.inputs.nixpkgs.follows = "nixpkgs";
```

The Nix package version follows the tagged `deno.json` version.

Then import the module:

```nix
{
  imports = [ inputs.alloy.nixosModules.default ];

  services.alloy-clips = {
    enable = true;
    publicServerUrl = "https://alloy.example.com";
    database.createLocally = true;
  };
}
```

The module provisions PostgreSQL by default, creates `/var/lib/alloy` and
`/var/cache/alloy`, sets `ALLOY_CONFIG_FILE`, `ALLOY_STORAGE_DIR`,
`ENCODE_SCRATCH_DIR`, and wraps the packaged server with the built web assets,
migrations, and ffmpeg paths. `initialRuntimeConfig` can be used as an optional
one-shot JSON bootstrap config; otherwise Alloy creates the mutable runtime JSON
with fresh secrets on first boot.

Build the web app and server:

```bash
deno task build
```

Run the server with production migrations enabled:

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
