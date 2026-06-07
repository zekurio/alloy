# alloy

Alloy is an open-source, self-hostable alternative to Medal.tv, without
recording (coming soon?).

> **AI Disclaimer & Warning:** This is a personal project developed in my free
> time. I use AI to assist with development. I do my best to follow best
> practices and keep the code maintainable.

## Install

### Release Channels

Alloy treats `main` as the stable, release-ready branch. Unpinned Nix users who
track `github:zekurio/alloy` get the latest release-ready commit. For
reproducible deployments, pin a release tag instead.

- Stable branch: `main`
- Exact release tags: `vX.Y.Z`
- Stable container image: `ghcr.io/zekurio/alloy:latest`
- Exact container image: `ghcr.io/zekurio/alloy:vX.Y.Z`
- Desktop release tags: `desktop-vX.Y.Z`
- Dev branch and image: `dev`
- Nightly container image: `nightly`

The `dev` branch is for integration testing before a release PR is merged to
`main`. It is intentionally opt-in and can change ahead of the stable channel.
The nightly container image is built from `dev`.

### NixOS

The NixOS module is the preferred deployment path today. To follow the latest
release-ready commit, add Alloy as a flake input:

```nix
inputs.alloy.url = "github:zekurio/alloy";
```

For a reproducible deployment, pin a release tag:

```nix
inputs.alloy.url = "github:zekurio/alloy/vX.Y.Z";
```

To test unreleased changes, opt into dev explicitly:

```nix
inputs.alloy.url = "github:zekurio/alloy/dev";
```

Alloy deliberately builds against its own pinned `nixpkgs` from `flake.lock`.
The package build uses the pinned Node/pnpm toolchain and lockfile, so build
inputs should be bumped together with `flake.lock` and `pnpm-lock.yaml`.

Alloy publishes a [Cachix](https://www.cachix.org/) binary cache. The flake does
not configure it automatically, so opt in explicitly if you want prebuilt
artifacts:

```nix
nix.settings = {
  substituters = [ "https://zekurio.cachix.org" ];
  trusted-public-keys = [
    "zekurio.cachix.org-1:QfL4gb2uCVEmSOOx4fLGDpygY1ycH5oUS1nteYTAgHc="
  ];
};
```

Then import the module:

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

The module manages the Alloy service, PostgreSQL database, persistent state,
encoder cache, filesystem storage, production migrations, and the optional
machine learning service. By default it uses:

- `/var/lib/alloy` for runtime config and storage.
- `/var/cache/alloy` for encoder and ML cache data.
- `services.postgresql` for the local database.

`publicServerUrl` must be the externally reachable origin in production. Alloy
rejects localhost or loopback production URLs so OAuth callbacks, WebAuthn,
media URLs, CORS, and secure cookies use the deployment host.

### Docker

The server container image is built with Nix (`dockerTools`) and published to
`ghcr.io/zekurio/alloy`. Docker support exists, but is less polished than the
NixOS module: you must provide PostgreSQL yourself, persist the mutable
directories, and configure production URLs explicitly. Use `latest` for the
stable channel, `vX.Y.Z` for an exact release, or `dev` only when testing
unreleased changes.

Example:

```bash
docker run --rm \
  -p 2552:2552 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgres://alloy:password@postgres:5432/alloy \
  -e PUBLIC_SERVER_URL=https://alloy.example.com \
  -e TRUSTED_ORIGINS=https://alloy.example.com \
  -v alloy-config:/config \
  -v alloy-storage:/data \
  -v alloy-encode:/cache/encode \
  ghcr.io/zekurio/alloy:latest
```

The image defaults to:

- `ALLOY_CONFIG_FILE=/config/runtime-config.json`
- `ALLOY_STORAGE_DIR=/data/storage`
- `ENCODE_SCRATCH_DIR=/cache/encode`
- `PORT=2552`

To build and load the image locally:

```bash
nix build .#alloy-image
./result | docker load
```

## Develop

Development is split into two layers:

- `pnpm` runs the Alloy dev processes: API server, web app, desktop app, and
  machine learning service.
- Docker or [devenv](https://devenv.sh/) provides infrastructure. Docker is the
  portable path for non-Nix and Windows users. devenv is the Nix path and
  provides Node 24, pnpm, Python/uv, native libraries, desktop tooling, and
  Postgres.

### Docker + pnpm

Install Node 24, pnpm 11, Docker, and uv. Then start the dev Postgres service:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

The compose file publishes Postgres on a random localhost port so it does not
reserve `5432`. The pnpm dev runner detects that port automatically when
`DATABASE_URL` is not already set.

Install dependencies and start the full dev loop:

```bash
pnpm install
pnpm dev
```

### devenv + pnpm

Install `devenv` and [direnv](https://direnv.net/) first; `devenv` must be
available on `PATH` before `direnv allow` can load this repo's `.envrc`.

One Nix-based install path:

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
```

After both tools are installed, allow the environment:

```bash
direnv allow
```

You can also enter it manually:

```bash
devenv shell
```

The devenv shell provides Node 24, pnpm, uv, Python 3.11, PostgreSQL 17 client
tools, ffmpeg, ImageMagick, native runtime libraries, and Electron for NixOS.
On shell entry it starts or reuses a repo-local Postgres instance, binds it to a
random localhost port, and exports `DATABASE_URL`/`DRIZZLE_DATABASE_URL` for the
current shell. A file lock prevents multiple shells from starting multiple
Postgres instances, and a PID marker makes stale state detectable. It pins
`nixpkgs` through `devenv.lock`; keep that in sync with `flake.lock` so local
tooling stays aligned with packaging.

Stop the devenv-managed Postgres instance when you want to tear it down:

```bash
alloy-postgres-stop
```

Install pnpm dependencies:

```bash
pnpm install
```

Start the full dev loop:

```bash
pnpm dev
```

This command:

1. Uses `DATABASE_URL` from the current environment, or the detected Docker
   Postgres port.
2. Applies the dev schema with `pnpm db:push`.
3. Starts the API server, Vite web app, and ML service.

Open http://localhost:5173.

The Electron desktop shell is opt-in during development:

```bash
pnpm dev:desktop
```

To run every dev process together, including ML and Electron:

```bash
pnpm dev:all
```

Individual process commands are also available:

```bash
pnpm dev:server
pnpm dev:web
pnpm dev:ml
```

Build desktop app artifacts:

```bash
pnpm desktop:dist:linux # AppImage, deb, and tar.gz
pnpm desktop:dist:win   # Windows unpacked app
pnpm desktop:dist:win:installer # Windows NSIS installer
pnpm desktop:dist:all
```

Windows desktop distribution builds require `ALLOY_OBS_RUNTIME_DIR` to point at
an OBS Studio runtime root, or to its `bin` or `bin/64bit` directory. The build
fails unless the staged runtime contains `obs.dll`; normal desktop development
can still fall back to a system OBS install.

Before considering a change complete, run:

```bash
pnpm fmt
pnpm lint
pnpm typecheck
```

## Contributing

Contributions are being accepted. CI runs lightweight formatting, lint, and
typecheck checks for pull requests and pushes to `dev` and `main`.

## Releasing

Feature and fix PRs should target `dev`. After dev has been validated, run the
**Prepare Release** workflow with the target version. It opens or updates a
release PR from `dev` to `main` and bumps `package.json`.

The **Publish Dev/Nightly Container Image** workflow publishes `nightly` and
`nightly-<short-sha>` container tags from `dev` on its nightly schedule. Manual
runs publish `dev` and `dev-<short-sha>` tags for the selected ref.

After the release PR is merged, create a tag on the merge commit:

```bash
git checkout main
git pull
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The **Release** workflow only publishes from `vX.Y.Z` tags that point at `main`.
Stable releases publish `latest`; prereleases such as `vX.Y.Z-rc.1` do not.

### Desktop Releases

The Electron desktop app has its own version in `apps/desktop/package.json` and
ships from `desktop-vX.Y.Z` tags. This keeps desktop-only updates separate from
server and machine learning releases.

Run the **Prepare Desktop Release** workflow with the target desktop version. It
opens or updates a release PR from `dev` to `main` and bumps only the desktop
package version.

After the desktop release PR is merged, create a desktop tag on the merge
commit:

```bash
git checkout main
git pull
git tag -a desktop-vX.Y.Z -m "Release desktop-vX.Y.Z"
git push origin desktop-vX.Y.Z
```

The **Desktop Release** workflow publishes an unsigned Windows x64 NSIS
installer to GitHub Releases. The workflow stages a pinned OBS Studio portable
runtime before packaging and fails if `obs.dll` is missing. SmartScreen warnings
are expected until code signing is added.
