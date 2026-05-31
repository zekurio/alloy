# alloy

Alloy is an open-source alternative to Medal.tv.

It is still a work in progress. Self-hosting is not polished yet, and Docker support exists but will be improved.

> **AI Disclaimer & Warning:** This is a personal project developed in my free time. I use AI to assist with development. I do my best to follow best practices and keep the code maintainable.

## Quick dev setup

Use the Nix dev shell:

```bash
nix develop
```

This shell provides `deno`, `uv`, Python 3.11, `psql`, PostgreSQL 17, and
`ffmpeg`.

Then install dependencies:

```bash
deno install
```

Start the app:

```bash
deno task dev
```

This starts local PostgreSQL, applies the dev schema with Drizzle, then runs the
API server and Vite dev server. Open http://localhost:5173.

## Local services

The dev shell provides `deno`, `uv`, Python 3.11, `psql`, PostgreSQL 17, and
`ffmpeg`. The dev scripts use those tools directly:

- PostgreSQL data lives in `.pg`
- PostgreSQL listens on `127.0.0.1:5432`
- The default database is `alloy`
- Runtime app data and ML cache live under `data/`

Useful service commands:

```bash
deno task pg:status
deno task pg:stop
psql "$DATABASE_URL"
```

In development, the frontend and API stay split so Vite can provide fast HMR.
The dev scripts provide the local database URL, server URL, and trusted origin
defaults.

`deno task dev` runs `db:push` before starting the app. Use
`deno task dev:quick` when you only want to restart Hono and Vite without
touching the schema.

The server runs startup migrations only when `NODE_ENV=production`. Local
development keeps `NODE_ENV=development` and uses Drizzle's dev push workflow,
so production migrations do not collide with local schema iteration.

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

Or start the web app, API server, and ML service together:

```bash
deno task dev:all
```

You can also run `deno task dev -- --ml`. The ML service is optional in the
dev supervisor; if it exits, the web app and API keep running.

The `dev:ml` task follows Immich's service workflow: it enters
`machine-learning/`, runs `uv sync --extra cpu`, sets
`MACHINE_LEARNING_CACHE_FOLDER=../data/ml-cache`, and starts
`python -m alloy_ml`. Set `MACHINE_LEARNING_UV_SYNC=0` to skip dependency sync
after the first run.

The service listens on http://localhost:2662 and exposes `/ping`, `/health`,
`/predict`, and `/v1/game-classifier/predict`. See
[`machine-learning/README.md`](./machine-learning/README.md) for the request
contract.

The Alloy server exposes the classifier as an authenticated advisory API:

- `GET /api/ml/config` returns the client-safe frame sampling limits.
- `POST /api/ml/game-suggestions` accepts `multipart/form-data` with repeated
  JPEG or PNG `frames` fields.

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
  };
}
```

The module enables PostgreSQL and creates the Alloy database by default,
creates `/var/lib/alloy` and `/var/cache/alloy`, sets `ALLOY_CONFIG_FILE`,
`ALLOY_STORAGE_DIR`,
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
