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
| `packages/ui`        | Shared React UI components, hooks, styles, and design utilities.                                                                        |
| `packages/logging`   | Tiny shared logging facade.                                                                                                             |
| `machine-learning`   | Optional Python inference service for advisory game classification.                                                                     |
| `nix`                | Nix package, NixOS module, and Nix-built OCI image definitions.                                                                         |

## Local Development

Install Node 24, pnpm 11, Docker or Podman for local Postgres, and `uv` if you
run the ML service. Then install dependencies:

```bash
pnpm install
```

Start a local Postgres:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

Start the default dev loop:

```bash
pnpm dev
```

Useful root commands:

```bash
pnpm dev:server       # server only
pnpm dev:web          # web only
pnpm dev:ml           # server + web + machine-learning
pnpm dev:desktop      # server + web + desktop
pnpm dev:all          # server + web + machine-learning + desktop
pnpm recorder:build   # build the Rust recorder sidecar
```

Nix users can use `devenv` instead of manually installing local tooling:

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
  env.MACHINE_LEARNING_URL = lib.mkForce "http://localhost:2762";
  env.ALLOY_ML_PORT = lib.mkForce "2762";
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
pnpm --filter alloy-recorder test
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

For reproducible deployments, pin a release tag:

```nix
inputs.alloy.url = "github:zekurio/alloy/vX.Y.Z";
```

Optional Cachix cache:

```nix
nix.settings = {
  substituters = [ "https://zekurio.cachix.org" ];
  trusted-public-keys = [
    "zekurio.cachix.org-1:QfL4gb2uCVEmSOOx4fLGDpygY1ycH5oUS1nteYTAgHc="
  ];
};
```

### Docker

Docker support exists, but is less polished than the NixOS module. Bring your
own PostgreSQL and persist the mutable directories.

```bash
docker run --rm \
  -p 2552:2552 \
  -e DATABASE_URL=postgres://alloy:password@postgres:5432/alloy \
  -e PUBLIC_SERVER_URL=https://alloy.example.com \
  -e TRUSTED_ORIGINS=https://alloy.example.com \
  -v alloy-config:/config \
  -v alloy-storage:/data \
  -v alloy-encode:/cache/encode \
  ghcr.io/zekurio/alloy:latest
```

Image tags:

- `latest`: latest stable app release.
- `vX.Y.Z`: exact app release.
- `main`: manually published image from the main branch.
- `nightly`: scheduled image from the main branch.

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

The app release publishes the Nix-built server image, the machine-learning
image, the Windows desktop installer, updater metadata, blockmap, and desktop
checksums. Recorder-only runtime releases remain separate under
`recorder-vX.Y.Z` for desktop runtime update artifacts.

## Package READMEs

Each package has a README with local commands and package-specific notes:

- `packages/api/README.md`
- `packages/contracts/README.md`
- `packages/db/README.md`
- `packages/desktop/README.md`
- `packages/logging/README.md`
- `packages/recorder/README.md`
- `packages/server/README.md`
- `packages/ui/README.md`
- `packages/web/README.md`
- `machine-learning/README.md`

## License

AGPL-3.0-only.
