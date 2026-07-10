<p align="center">
  <img src="./public/logo.png" alt="Alloy" width="120" />
</p>

<h1 align="center">Alloy</h1>

<p align="center">
  Your gameplay clips, on your server.
</p>

Alloy is an open-source, self-hosted alternative to Medal.tv. The Windows app
captures gameplay without getting in the way; the web app gives you a place to
publish, watch, organize, and share the moments worth keeping.

This project is still early. Expect sharp edges and active development—but also
a codebase built with performance, reliability, and long-term maintainability
in mind.

## What Alloy Does

- Records gameplay locally through a native Rust + OBS sidecar
- Trims and prepares clips before they leave your PC
- Uploads clips to infrastructure you control
- Encodes playback-ready video in background jobs with retries and recovery
- Brings clips, profiles, comments, search, notifications, and administration
  together in one web app

Alloy is for people who like the convenience of a clip-sharing platform but
would rather own the server, storage, and community around it.

## The Project

Alloy is a pnpm + Turbo monorepo. Its four main applications form a deliberately
small set of boundaries:

| Package                         | What lives there                                         |
| ------------------------------- | -------------------------------------------------------- |
| [`server`](packages/server)     | Hono API, authentication, storage, feeds, and media jobs |
| [`web`](packages/web)           | React app for watching, sharing, and managing clips      |
| [`desktop`](packages/desktop)   | Electron shell that connects to an Alloy server          |
| [`recorder`](packages/recorder) | Windows-native Rust recording sidecar                    |

Shared packages keep the seams typed and reusable:

- [`api`](packages/api) and [`contracts`](packages/contracts) define how the
  apps talk to each other.
- [`db`](packages/db) owns the PostgreSQL schema and migrations.
- [`media`](packages/media) contains MP4 trimming and packet-copy utilities.
- [`ui`](packages/ui) and [`i18n`](packages/i18n) provide the shared interface
  and translations.
- [`env`](packages/env) and [`logging`](packages/logging) cover the less
  glamorous—but important—runtime foundations.

A clip moves through the system in a simple path: the desktop recorder creates
it locally, the server accepts it through a signed upload, a background worker
encodes it, and the web app serves it with range-aware playback. Each boundary
has a narrow contract so failures are visible and retryable instead of leaving
the clip in a mystery state.

## Try It

### Desktop app

Alloy Desktop currently supports Windows x64. Grab the latest installer from
[GitHub Releases](https://github.com/zekurio/alloy/releases/latest), then point
it at your Alloy server.

### Self-hosted server

The NixOS module is the preferred deployment path today. Add Alloy to your
flake inputs:

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

The module supplies PostgreSQL and filesystem storage defaults. See the
[`server` package](packages/server) and [`.env.example`](.env.example) when you
want to customize authentication, storage, or transcoding.

## Develop Locally

The easiest setup uses [devenv](https://devenv.sh/) to provide Node, pnpm,
PostgreSQL, ffmpeg, Rust, and Electron:

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
direnv allow
pnpm install
pnpm dev
```

Without Nix, install Node 24 and pnpm 11, provide a PostgreSQL database, then:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts the server and web app. `pnpm dev:all` includes the desktop
shell. The recorder itself builds only on Windows.

Before opening a pull request, run:

```bash
pnpm verify
```

Package READMEs contain the deeper implementation notes and package-specific
commands. The [contributing guide](.github/CONTRIBUTING.md) covers the branch,
commit, testing, and pull request conventions.

## A Note on Development

Alloy is a personal project, built in spare time with help from AI-assisted
development tools. The goal is not to move fast at any cost: changes are still
reviewed against the same standards for clarity, maintainability, and
reliability.

Found a bug or have an idea? [Open an issue](https://github.com/zekurio/alloy/issues/new/choose).
For security reports, please follow the [security policy](.github/SECURITY.md).

## License

[MIT](LICENSE)
