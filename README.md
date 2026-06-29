# Alloy

Alloy is an open-source, self-hostable alternative to Medal.tv. It is still an
early WIP, with the strongest focus on predictable behavior, failure handling,
performance, and maintainable boundaries between deployable pieces.

The current product surface is a self-hosted web app plus a Windows desktop
recorder. The desktop app records and edits local captures, then publishes them
to the server; the web app handles browsing, playback, profiles, comments,
search, library management, setup, and admin settings.

## Installation

### Desktop

Alloy Desktop currently targets Windows x64. Install the latest stable desktop
build from the [latest GitHub Release](https://github.com/zekurio/alloy/releases/latest).

Unstable desktop builds are workflow artifacts from `dev`, not GitHub
Releases. Download the latest unstable Electron artifact from
[desktop-release-assets.zip](https://nightly.link/zekurio/alloy/workflows/release/dev/desktop-release-assets.zip).

### Server

The NixOS module is the preferred server deployment path today.

```nix
inputs.alloy.url = "github:zekurio/alloy";
```

```nix
{
  imports = [ inputs.alloy.nixosModules.default ];

  services.alloy-server = {
    enable = true;
    publicServerUrl = "https://alloy.example.com";
    openFirewall = true;
    environmentFile = "/run/secrets/alloy.env";
  };
}
```

The env file should contain the required signing secrets:

```sh
ALLOY_VIEWER_COOKIE_SECRET=replace-with-a-long-random-secret
ALLOY_UPLOAD_HMAC_SECRET=replace-with-a-long-random-secret
```

For reproducible NixOS deployments, pin a release tag:

```nix
inputs.alloy.url = "github:zekurio/alloy/vX.Y.Z";
```

To follow the development branch through Nix flakes, pin `dev` in your
flake input and update your lock file when you want to move:

```nix
inputs.alloy.url = "github:zekurio/alloy/dev";
```

## Repository Guide

All TypeScript packages live under `packages/`. Deployable products and shared
libraries are both treated as packages so the workspace graph stays explicit.

| Path                 | Role                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/server`    | Hono API server for auth, clips, uploads, playback, feeds, search, admin, storage, encoding jobs, and web asset serving. |
| `packages/web`       | React/TanStack web app served by the server in production and by Vite during local development.                          |
| `packages/desktop`   | Electron desktop shell that connects to a self-hosted Alloy server and controls local recording.                         |
| `packages/recorder`  | Rust recording sidecar built as `alloy-recorder`; bundled by desktop release builds.                                     |
| `packages/api`       | Typed client helpers and runtime validators for browser and desktop clients calling the server API.                      |
| `packages/contracts` | Shared TypeScript contracts used across the server, web app, desktop app, and recorder-facing flows.                     |
| `packages/db`        | Drizzle schema, migrations, connection helpers, and migration helpers.                                                   |
| `packages/env`       | Shared environment parsing, URL normalization, and local `.env` loading helpers.                                         |
| `packages/ui`        | Shared React UI components, hooks, styles, and design utilities.                                                         |
| `packages/logging`   | Tiny shared logging facade.                                                                                              |
| `nix`                | Nix package and NixOS module definitions.                                                                                |

## Local Development

Nix users can use `devenv` for the complete local toolchain, including a
repo-local Postgres on a random free localhost port:

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
direnv allow
pnpm install
pnpm dev
```

Stop the devenv-managed Postgres instance with:

```bash
alloy-postgres-stop
```

For non-Nix setups, install Node 24, pnpm 11, and provide a local Postgres
database yourself. Then install dependencies:

```bash
pnpm install
```

Copy the env template if you are not using `devenv`:

```bash
cp .env.example .env
```

`.env.example` includes local-only signing secrets, uses filesystem storage
under the repo-local `data/storage` directory, and allows the Vite dev origin to
call the API. Shell environment variables always win over `.env`, so you can
point `DATABASE_URL` at any `postgres://` or `postgresql://` instance.

Start the default dev loop. `pnpm dev` runs `pnpm db:push` first, then starts
the API server and Vite web app:

```bash
pnpm dev
```

Useful root commands:

```bash
pnpm dev              # server + web
pnpm dev:server       # server only; runs db:push first
pnpm dev:web          # web only; expects an API server at VITE_SERVER_URL or http://localhost:2552
pnpm dev:all          # server + web + desktop
pnpm recorder:build   # build the Rust recorder sidecar
pnpm desktop:obs:install # download and stage the Windows OBS runtime
```

Database commands:

```bash
pnpm db:generate      # generate SQL migrations from schema changes
pnpm db:migrate       # apply generated migrations
pnpm db:push          # push the current Drizzle schema to a dev database
pnpm db:studio        # open Drizzle Studio
```

If another service already uses Alloy's default dev ports, add an ignored
`devenv.local.nix`:

```nix
{ lib, ... }:
{
  env.PORT = lib.mkForce "2652";
  env.PUBLIC_SERVER_URL = lib.mkForce "http://localhost:2652";
  env.VITE_SERVER_URL = lib.mkForce "http://localhost:2652";
}
```

## Checks

Before considering a code change complete:

```bash
pnpm fmt
pnpm lint
pnpm typecheck
```

For server config parser changes, also run:

```bash
pnpm --filter @alloy/server test:config
```

For Nix package changes, run the relevant Nix checks:

```bash
nix --extra-experimental-features "nix-command flakes" flake check --no-build
nix --extra-experimental-features "nix-command flakes" build .#alloy --no-link
```

## Server Configuration

By default the module creates and manages a local PostgreSQL database named
`alloy`, derives `DATABASE_URL`, and uses filesystem storage under
`/var/lib/alloy/storage`. Instance settings live in Postgres. Deploy-time
server config is declarative: auth policy, limits, storage, SteamGridDB, and
OAuth are Nix options or environment variables. Alloy no longer reads mutable
`config.json` or `secrets.json` files. Put secret environment variables in
`services.alloy-server.environmentFile`. For an external database, set
`services.alloy-server.database.host`, `port`, `name`, and `user`; for unusual
authenticated setups, override environment through
`services.alloy-server.environment` or `services.alloy-server.environmentFile`.

Optional Cachix cache:

```nix
nix.settings = {
  substituters = [ "https://zekurio.cachix.org" ];
  trusted-public-keys = [
    "zekurio.cachix.org-1:esutyOTeL/aict5fKEf0Zm4fHazmwGapCLfjekfEv9o="
  ];
};
```

### Storage

Storage is configured declaratively. Alloy stores clip media, clip thumbnails,
and user assets on the server filesystem. Set `ALLOY_STORAGE_DRIVER=fs`,
`ALLOY_STORAGE_FS_CLIPS_PATH`, `ALLOY_STORAGE_FS_THUMBNAILS_PATH`, and
`ALLOY_STORAGE_FS_USERS_PATH`. The NixOS module defaults these to paths under
`/var/lib/alloy/storage`.

### OAuth

OAuth/OIDC providers are configured with `ALLOY_SOCIALACCOUNT_PROVIDERS`. The
JSON follows the Paperless/allauth OpenID Connect shape; only `openid_connect`
is supported for now.
When setting `ALLOY_SOCIALACCOUNT_PROVIDERS` in `.env` syntax or Railway's RAW
editor, write optional `button_color` and `button_text_color` values without a
leading `#`; Alloy normalizes six-digit values like `5865F2` to `#5865F2` at
startup.

```json
{
  "openid_connect": {
    "SCOPE": ["openid", "profile", "email"],
    "OAUTH_PKCE_ENABLED": true,
    "APPS": [
      {
        "provider_id": "authentik",
        "name": "Authentik",
        "client_id": "alloy",
        "secret": "replace-me",
        "settings": {
          "server_url": "https://auth.example.com/application/o/alloy/",
          "token_auth_method": "client_secret_basic",
          "username_claim": "preferred_username",
          "role_claim": "groups"
        }
      }
    ]
  }
}
```

## Desktop Builds

Alloy Desktop currently targets Windows x64. Desktop builds bundle the recorder
artifact from `packages/recorder/dist` as a fallback runtime.

```bash
pnpm desktop:build
pnpm desktop:dist:win
pnpm desktop:dist:win:installer
```

Windows development and distribution builds need OBS runtime libraries, but do
not require installing OBS Studio system-wide. Stage the official portable OBS
Windows x64 ZIP into `packages/recorder/dist/obs-runtime`:

```bash
pnpm desktop:obs:install
```

The installer downloads the latest OBS release by default. Pin a specific
release with `ALLOY_OBS_VERSION=32.1.2 pnpm desktop:obs:install` or
`pnpm desktop:obs:install -- --version 32.1.2`.

Alternatively, set `ALLOY_OBS_RUNTIME_DIR` to an OBS Studio runtime root, or
its `bin` / `bin/64bit` directory. Release builds fail unless the staged or
configured runtime contains `obs.dll`.

## Releases

Alloy publishes GitHub Releases only for latest builds. Latest releases use tags
named `vX.Y.Z` and attach the Windows installer, Electron updater metadata
(`latest.yml`), blockmaps, and checksums.

Unstable desktop builds are workflow artifacts from `dev`, not GitHub
Releases. Download the latest unstable Electron artifact from
[desktop-release-assets.zip](https://nightly.link/zekurio/alloy/workflows/release/dev/desktop-release-assets.zip).

Server releases are distributed through the Nix flake package and NixOS module.
For reproducible deployments, pin the exact release tag in your flake input.

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

MIT.
