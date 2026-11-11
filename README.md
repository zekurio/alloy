<p align="center">
  <img src="./public/alloy-wordmark.svg" alt="Alloy" width="300" />
</p>

<hr />

The open-source, self-hosted alternative to Medal.tv. A Windows app records
gameplay clips locally and publishes them to your own server. The web app
handles playback, profiles, recommendations, search, and admin.

Alloy is early and under active development. Expect sharp edges.

### Desktop app

On Windows x64, download the latest installer from
[GitHub Releases](https://github.com/zekurio/alloy/releases/latest) and point
it at your Alloy server. The app keeps its settings in
`%APPDATA%\dev.zekurio.alloy`, its caches and log in
`%LOCALAPPDATA%\dev.zekurio.alloy`, and recordings in `Videos\Alloy`.

On Linux, the flake packages the app as `.#alloy-desktop`; see
[`nix/README.md`](nix/README.md#alloy-desktop).

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

The environment file needs a SteamGridDB API key, which powers game search,
artwork, and canonical game names:

```sh
ALLOY_STEAMGRIDDB_API_KEY=replace-with-your-steamgriddb-api-key
```

The module supplies PostgreSQL and filesystem storage defaults, and the server
applies its database migrations on start. Open the server in a browser to
create the admin account:

- With single sign-on configured through `ALLOY_OIDC_*`, setup offers only
  the provider and asks for no token. The first sign-in whose `alloy_role`
  claim is `admin` becomes the admin, and the server turns anyone else away.
  `ALLOY_OIDC_ROLE_CLAIM` names another claim. In Pocket ID, give a group
  such as `alloy-admins` the custom claim `alloy_role` with the value
  `admin`.
- Without it, setup asks for the setup token that the server prints to its
  log, or the value of `ALLOY_SETUP_TOKEN`, and then creates the admin with a
  username and a passkey.

People get an account in one of three ways. With `ALLOY_OPEN_REGISTRATIONS`
on, anyone can sign up with a username and a passkey. With it off, an admin
makes a one-time invite link under **Settings → Administration → Users**,
and its holder signs up the same way. With `ALLOY_OIDC_ALLOW_SIGN_UP` on,
the first single sign-on of anyone the provider lets in creates their
account. An admin can also make a passkey link from an account's menu, for
someone who lost their passkeys. See
[`.env.example`](.env.example) for authentication, storage, and transcoding
options.

Sign-in, single sign-on, appearance, upload limits, and transcoding can be
set with `ALLOY_*` environment variables, through
`services.alloy-server.environment` on NixOS. Each variable is a default:
admins can change the setting under **Settings → Administration**, the saved
value applies without a restart, and resetting it returns to the variable.
Single sign-on uses one OpenID Connect provider; register
`<public URL>/api/auth/oauth2/callback/oidc` as its redirect URI and put
`ALLOY_OIDC_CLIENT_SECRET` in the environment file.

Upload limits default to 50 MiB and 64 megapixels for screenshots, 5 MiB for
avatars, and 10 MiB for profile banners and game artwork. Screenshot limits
also apply to edits and to queued screenshots when processing starts; the
size limit covers the stored PNG as well as the original upload. These
settings do not change local desktop capture limits.

#### Container image

The same server build is published as a container image at
`ghcr.io/zekurio/alloy`. `X.Y.Z` tags are releases, `latest` is the newest
release, and `unstable` follows `dev`. The image listens on port 2552 and
keeps clips, thumbnails, and assets under `/data`; mount a volume there. You
still need to provide PostgreSQL and the environment above. See
[RELEASING.md](.github/RELEASING.md#container-images).

#### Webhooks

Admins can add webhooks under **Settings → Administration → Webhooks**. A
public clip is announced once per webhook when its first encode finishes or
when its author makes it public. Re-encodes and transcoding changes never
announce again; admins can reannounce a clip from its menu. Authors can opt
out under their preferences. Deliveries retry up to five times, honour
`Retry-After`, and wait while a webhook is paused.

Discord and Fluxer webhooks receive the clip link as message content, which
unfurls into a playable preview. A generic webhook receives a JSON `POST`
with these headers:

- `X-Alloy-Event`: `clip.published`, or `test` for the admin test button.
- `X-Alloy-Delivery`: a UUID that stays the same across retries. Use it to
  deduplicate.
- `X-Alloy-Signature`: `sha256=<hex>`, the HMAC-SHA256 of the raw request
  body keyed with the webhook's signing secret. Sent only when a secret is
  set. Verify it over the exact bytes received, before parsing the JSON.

The `clip.published` body carries `event`, `deliveryId`, `timestamp`, a
`clip` object (`id`, `url`, `title`, `description`, `game`, `durationMs`,
`thumbnailUrl`, `videoUrl`, `createdAt`, `publishedAt`), and an `author`
object (`id`, `username`, `displayName`, `url`). The exact shape is
`ClipPublishedPayload` in `packages/contracts/src/webhooks.ts`.

### Development

With Nix, the flake's dev shell provides Node, pnpm, PostgreSQL, ffmpeg, and
Rust, and starts a repo-local Postgres:

```bash
nix develop        # or `direnv allow` to enter it on `cd`
pnpm install
pnpm dev
```

Without Nix: install Node 24 and pnpm 11, provide a PostgreSQL database, copy
`.env.example` to `.env`, then run `pnpm install && pnpm dev`. `pnpm dev:all`
also starts the desktop shell; see
[`packages/desktop`](packages/desktop/README.md) for its setup.

```bash
pnpm fmt                         # format the repository
pnpm lint                        # run type-aware linting
pnpm typecheck                   # check every TypeScript package
pnpm verify                      # format check, lint, and typecheck
```

Unit tests have been removed in preparation for E2E testing. The E2E suite
is not configured yet. Native integration tests and the Nix security test remain.

Run `pnpm verify` before opening a pull request. The
[contributing guide](.github/CONTRIBUTING.md) covers branch, commit, and PR
conventions, and package READMEs hold the deeper implementation notes.

### Contributing

Found a bug or have an idea?
[Open an issue](https://github.com/zekurio/alloy/issues/new/choose). For
security reports, follow the [security policy](.github/SECURITY.md).

### License

[MIT](LICENSE)
