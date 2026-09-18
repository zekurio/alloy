<p align="center">
  <img src="./public/alloy-wordmark.svg" alt="Alloy" width="300" />
</p>

<hr />

The open-source, self-hosted alternative to Medal.tv. A Windows app records
gameplay clips locally and publishes them to your own server. The web app
handles playback, profiles, recommendations, search, and admin.

Alloy is early and under active development. Expect sharp edges.

### Desktop app

Windows x64 only. Download the latest installer from
[GitHub Releases](https://github.com/zekurio/alloy/releases/latest) and point
it at your Alloy server. The app keeps its settings in
`%APPDATA%\dev.zekurio.alloy`, its caches and log in
`%LOCALAPPDATA%\dev.zekurio.alloy`, and recordings in `Videos\Alloy`.

### Server

The NixOS module is the preferred deployment path. Add Alloy to your flake
inputs:

```nix
inputs.alloy.url = "github:zekurio/alloy/vX.Y.Z";
```

Then import and configure the module:

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

The environment file needs two signing secrets and a SteamGridDB API key,
which powers game search, artwork, and canonical game names:

```sh
ALLOY_VIEWER_COOKIE_SECRET=replace-with-a-long-random-secret
ALLOY_UPLOAD_HMAC_SECRET=replace-with-a-long-random-secret
ALLOY_STEAMGRIDDB_API_KEY=replace-with-your-steamgriddb-api-key
```

The module supplies PostgreSQL and filesystem storage defaults, and the server
applies its database migrations on start. See
[`.env.example`](.env.example) for authentication, storage, and transcoding
options.

### Development

With [devenv](https://devenv.sh/), which provides Node, pnpm, PostgreSQL,
ffmpeg, and Rust:

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
direnv allow
pnpm install
pnpm dev
```

Without Nix: install Node 24 and pnpm 12, provide a PostgreSQL database, copy
`.env.example` to `.env`, then run `pnpm install && pnpm dev`. `pnpm dev:all`
also starts the desktop shell, which builds only on Windows; see
[`packages/desktop`](packages/desktop/README.md) for its setup.

```bash
pnpm fmt                         # format the repository
pnpm lint                        # run type-aware linting
pnpm test                        # run every test once
pnpm test packages/server        # run tests matching a path
pnpm typecheck                   # check every TypeScript package
pnpm verify                      # format check, lint, and typecheck
```

Run `pnpm verify` before opening a pull request. The
[contributing guide](.github/CONTRIBUTING.md) covers branch, commit, and PR
conventions, and package READMEs hold the deeper implementation notes.

### Contributing

Found a bug or have an idea?
[Open an issue](https://github.com/zekurio/alloy/issues/new/choose). For
security reports, follow the [security policy](.github/SECURITY.md).

### License

[MIT](LICENSE)
