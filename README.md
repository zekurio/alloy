# Alloy

Alloy is an open-source, self-hostable alternative to Medal.tv. It is still an
early WIP, with the strongest focus on predictable behavior, failure handling,
performance, and maintainable boundaries between deployable pieces.

## Repository Guide

All TypeScript packages live under `packages/`. Deployable products and shared
libraries are both treated as packages so the workspace graph stays explicit.

| Path                 | Role                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server`    | Hono API server for auth, clips, uploads, playback, feeds, search, notifications, admin, storage, encoding jobs, and web asset serving. |
| `packages/web`       | React/TanStack web app served by the server in production and by Vite during local development.                                         |
| `packages/desktop`   | Electron desktop shell that connects to a self-hosted Alloy server and controls local recording.                                        |
| `packages/recorder`  | Rust recording sidecar built as `alloy-recorder`; bundled by desktop and also available as a recorder-only runtime release.             |
| `packages/api`       | Typed client helpers and runtime validators for browser and desktop clients calling the server API.                                     |
| `packages/contracts` | Shared TypeScript contracts used across the server, web app, desktop app, and recorder-facing flows.                                    |
| `packages/db`        | Drizzle schema, migrations, database contracts, and migration helpers.                                                                  |
| `packages/env`       | Shared environment parsing, URL normalization, and local `.env` loading helpers.                                                        |
| `packages/ui`        | Shared React UI components, hooks, styles, and design utilities.                                                                        |
| `packages/logging`   | Tiny shared logging facade.                                                                                                             |
| `nix`                | Nix package, NixOS module, and Nix-built OCI image definitions.                                                                         |

## Local Development

Install Node 24, pnpm 11, and Docker or Podman for local Postgres. Then install
dependencies:

```bash
pnpm install
```

Copy the env template if you are not using `devenv`:

```bash
cp .env.example .env
```

`.env.example` points `DATABASE_URL` at the dev Postgres from
`docker-compose.dev.yml`, stores bootstrap config/secrets under the repo-root
`data/` directory, and allows the Vite dev origin to call the API. Shell
environment variables always win over `.env`, so you can point `DATABASE_URL` at
any `postgres://` or `postgresql://` instance.

Start the local Postgres on `127.0.0.1:5432` before running server or database
commands:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

Start the default dev loop. `pnpm dev` runs `pnpm db:push` first, then starts
the API server. Use `dev:web` in another terminal when you want Vite's
standalone frontend server:

```bash
pnpm dev
pnpm dev:web
```

Useful root commands:

```bash
pnpm dev:server       # server only
pnpm dev:web          # web only; expects an API server at VITE_SERVER_URL or http://localhost:2552
pnpm dev:desktop      # server + web + desktop
pnpm dev:all          # server + web + desktop
pnpm recorder:build   # build the Rust recorder sidecar
```

Database commands:

```bash
pnpm db:generate      # generate SQL migrations from schema changes
pnpm db:migrate       # apply generated migrations
pnpm db:push          # push the current Drizzle schema to a dev database
pnpm db:studio        # open Drizzle Studio
```

Nix users can use `devenv` instead of manually installing local tooling. The
shell starts a repo-local Postgres on a random free localhost port (so it
never collides with a system-wide Postgres service) and exports
`DATABASE_URL` and the rest of the dev environment, which always takes
precedence over `.env`:

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
direnv allow
pnpm install
pnpm dev
```

If another service already uses Alloy's default dev ports, add an ignored
`devenv.local.nix`:

```nix
{ lib, ... }:
{
  env.PORT = lib.mkForce "2652";
  env.PUBLIC_SERVER_URL = lib.mkForce "http://localhost:2652";
}
```

Stop the devenv-managed Postgres instance with:

```bash
alloy-postgres-stop
```

## Checks

Before considering a code change complete:

```bash
pnpm fmt
pnpm lint
pnpm typecheck
```

For Rust recorder changes, also run:

```bash
pnpm --filter @alloy/recorder test
```

For Nix package or container changes, run the relevant Nix checks:

```bash
nix --extra-experimental-features "nix-command flakes" flake check --no-build
nix --extra-experimental-features "nix-command flakes" build .#alloy --no-link
nix --extra-experimental-features "nix-command flakes" build .#alloy-image --no-link
```

## Deployment

### NixOS

The NixOS module is the preferred deployment path today.

```nix
inputs.alloy.url = "github:zekurio/alloy";
```

```nix
{
  imports = [ inputs.alloy.nixosModules.default ];

  services.alloy-clips = {
    enable = true;
    publicServerUrl = "https://alloy.example.com";
    openFirewall = true;
  };
}
```

By default the module creates and manages a local PostgreSQL database named
`alloy`, derives `DATABASE_URL`, stores mutable state in `/var/lib/alloy`, and
seeds filesystem storage under `/var/lib/alloy/storage` on first boot. For an
external database, set `services.alloy-clips.database.host`, `port`, `name`, and
`user`; for unusual authenticated setups, override environment through
`services.alloy-clips.environment` or a systemd service override.

For reproducible deployments, pin a release tag:

```nix
inputs.alloy.url = "github:zekurio/alloy/vX.Y.Z";
```

Optional Cachix cache:

```nix
nix.settings = {
  substituters = [ "https://zekurio.cachix.org" ];
  trusted-public-keys = [
    "zekurio.cachix.org-1:esutyOTeL/aict5fKEf0Zm4fHazmwGapCLfjekfEv9o="
  ];
};
```

### Docker

Docker support exists, but is less polished than the NixOS module. Bring your
own PostgreSQL. The server runs migrations automatically in production, but the
database must already exist and be reachable through `DATABASE_URL`. Persist the
bootstrap config/secrets volume plus the storage volume seeded into runtime
config on first boot.

```bash
docker run --rm \
  -p 2552:2552 \
  -e DATABASE_URL=postgres://alloy:password@postgres:5432/alloy \
  -e PUBLIC_SERVER_URL=https://alloy.example.com \
  -e TRUSTED_ORIGINS=https://alloy.example.com \
  -v alloy-config:/config \
  -v alloy-storage:/data \
  ghcr.io/zekurio/alloy:latest
```

Image tags:

- `latest`: latest stable app release.
- `vX.Y.Z`: exact app release; prereleases only get their pinned version tag.
- `main`: continuously published from the main branch.

### Storage

Storage is configured during setup or from the admin settings. For filesystem
storage, Alloy keeps separate clip and user asset roots so operators can place
large clip media and small profile assets on different disks. For S3-compatible
storage, Alloy stores clip objects under the `clips/` prefix and user assets
under the `users/` prefix in the configured bucket. Uploads are presigned so
browsers PUT directly to the bucket. Configure bucket CORS to allow the Alloy
web origin to `PUT` with the `Content-Type` header.

```json
[
  {
    "AllowedOrigins": ["https://alloy.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## Desktop Builds

Alloy Desktop currently targets Windows x64. Desktop builds bundle the recorder
artifact from `packages/recorder/dist` as a fallback runtime.

```bash
pnpm desktop:build
pnpm desktop:dist:win
pnpm desktop:dist:win:installer
```

Windows distribution builds require `ALLOY_OBS_RUNTIME_DIR` to point at an OBS
Studio runtime root, or its `bin` / `bin/64bit` directory. Release builds fail
unless the staged runtime contains `obs.dll`.

## Releases

The primary Alloy app release is unified under tags named `vX.Y.Z`. The web app
is served by the server and used heavily by the Electron shell, so the server,
web, and desktop installer ship from the same release tag and version.

Feature and fix PRs target `main`. The release preparation workflow runs checks,
updates the root and desktop package versions together, commits the version
bump, and pushes the prepared release back to `main`. Publishing happens from
tags on `main`.

The app release publishes the Nix-built server image, the Windows desktop
installer, updater metadata, blockmap, recorder runtime zip, and checksums.
Recorder package metadata is versioned with the app release so sidecar artifacts
are traceable to the same `vX.Y.Z` tag.

## Package READMEs

Most packages have a README with local commands and package-specific notes:

- `packages/api/README.md`
- `packages/contracts/README.md`
- `packages/db/README.md`
- `packages/desktop/README.md`
- `packages/logging/README.md`
- `packages/recorder/README.md`
- `packages/server/README.md`
- `packages/ui/README.md`
- `packages/web/README.md`

## License

AGPL-3.0-only.
