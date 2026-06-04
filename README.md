# alloy

Alloy is an open-source, self-hostable alternative to Medal.tv, without
recording (coming soon?).

> **AI Disclaimer & Warning:** This is a personal project developed in my free
> time. I use AI to assist with development. I do my best to follow best
> practices and keep the code maintainable.

## Install

### NixOS

The NixOS module is the preferred deployment path today. Add Alloy as a flake
input:

```nix
inputs.alloy.url = "github:zekurio/alloy";
```

Alloy deliberately builds against its own pinned `nixpkgs` from `flake.lock`. Do
**not** set `inputs.alloy.inputs.nixpkgs.follows = "nixpkgs"`: the server is
produced with `deno compile`, whose runtime (`denort`) is fetched for one exact
Deno version. Building against a different `nixpkgs`/Deno can fail with a hash
mismatch.

Alloy publishes a [Cachix](https://www.cachix.org/) binary cache. The flake does
not configure it automatically, so opt in explicitly if you want prebuilt
artifacts:

```nix
nix.settings = {
  substituters = [ "https://alloy.cachix.org" ];
  trusted-public-keys = [
    "alloy.cachix.org-1:wXlNsjaHLyuPuGbiUb+O5C7sIzUSXqR8rMvI1DOpYVw="
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
directories, and configure production URLs explicitly.

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

Development uses [devenv](https://devenv.sh/) as the source of truth for local
tooling and services. Install `devenv` and [direnv](https://direnv.net/) first;
`devenv` must be available on `PATH` before `direnv allow` can load this repo's
`.envrc`.

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

The devenv shell provides Deno, uv, Python 3.11, PostgreSQL 17 client tools,
ffmpeg, ImageMagick, native runtime libraries, and the local PostgreSQL service.
It pins `nixpkgs` through `devenv.lock`; keep that in sync with `flake.lock` so
the local Deno version stays aligned with the packaged server's `denort`
runtime.

Install Deno dependencies:

```bash
deno install
```

Start the full dev loop:

```bash
deno task dev
```

This command:

1. Starts local PostgreSQL through devenv if it is not already running.
2. Applies the dev schema with `deno task db:push`.
3. Starts the API server, Vite web app, and ML service.

Open http://localhost:5173.

Before considering a change complete, run:

```bash
deno task fmt
deno task lint
deno task typecheck
```

## Contributing

Contributions are being accepted.
