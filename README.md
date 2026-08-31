<p align="center">
  <img src="./public/alloy-wordmark.svg" alt="Alloy" width="300" />
</p>

<hr />

The open-source, self-hosted alternative to Medal.tv: a Windows app records
gameplay clips locally and publishes them to your own server; the web app
handles playback, profiles, comments, search, and admin.

This project is early and under active development. Expect sharp edges.

### Desktop App

Windows x64 only. Download the latest installer from
[GitHub Releases](https://github.com/zekurio/alloy/releases/latest) and point
it at your Alloy server.

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

The environment file needs two signing secrets:

```sh
ALLOY_VIEWER_COOKIE_SECRET=replace-with-a-long-random-secret
ALLOY_UPLOAD_HMAC_SECRET=replace-with-a-long-random-secret
```

The module supplies PostgreSQL and filesystem storage defaults; see
[`.env.example`](.env.example) for authentication, storage, and transcoding
options.

### Development

With [devenv](https://devenv.sh/) (provides Node, pnpm, PostgreSQL, ffmpeg,
Rust, and Electron):

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
direnv allow
pnpm install
pnpm dev
```

Without Nix: install Node 24 and pnpm 11, provide a PostgreSQL database, copy
`.env.example` to `.env`, then `pnpm install && pnpm dev`. `pnpm dev:all` adds
the desktop shell; the recorder builds only on Windows.

Vite+ runs formatting, linting, builds, and the unified test suite. Tests are
discovered by filename, so a new `*.test.ts` or `*.test.tsx` file needs no
package script entry. Run all tests with `pnpm test`, or target a path with
`pnpm test packages/server`.

Run `pnpm verify` before opening a pull request. The
[contributing guide](.github/CONTRIBUTING.md) covers branch, commit, and PR
conventions; package READMEs contain deeper implementation notes.

### Contributing

Found a bug or have an idea?
[Open an issue](https://github.com/zekurio/alloy/issues/new/choose). For
security reports, follow the [security policy](.github/SECURITY.md).

### License

[MIT](LICENSE)
