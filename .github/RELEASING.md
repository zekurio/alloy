# Releasing

Alloy has a single long-lived branch (`dev`) and a single release channel.
Releases are cut on demand by the **publish** workflow, tagged `vX.Y.Z`, and
named after the tag.

Server distribution is handled by the Nix flake package and NixOS module. We do
not attach server artifacts to GitHub Releases. The same Nix build is also
published as a container image (see [Container Images](#container-images)).

GitHub Release assets are intentionally limited to the desktop app and
auto-update files:

- `Alloy-Desktop-...-setup.exe` and its `.blockmap`
- the installer `.sig`
- `latest.yml`, which the desktop app's updater reads
- `latest.json`, which Tauri builds of the desktop app read (see
  [Moving from the Tauri build](#moving-from-the-tauri-build))
- `checksums.txt`

## Cutting a Release

Dispatch the **publish** workflow from the Actions tab (it only runs on
`dev`). Pick a `bump` of `patch`, `minor`, or `major`, or set an exact
`version` override. The workflow then:

1. Runs formatting, lint, and typecheck against the current `dev` head.
2. Stamps the new version into all release version files.
3. Commits `chore: release vX.Y.Z` to `dev` and tags that commit `vX.Y.Z`
   (pushed atomically).
4. Builds the Windows desktop installer from the tagged commit.
5. Builds and pushes the server container image tagged with the release
   version, then publishes the GitHub Release with categorized generated notes, the installer,
   `latest.json`, update signatures, and checksums.

## Container Images

The server image is built from the flake's `dockerImage` output and pushed to
`ghcr.io/zekurio/alloy` (the lowercased repository name). It exposes port 2552. Three kinds of tag exist:

| Tag        | Pushed by                | Meaning                                                                                |
| ---------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `X.Y.Z`    | **publish**, `image` job | The release `vX.Y.Z` (no `v` prefix). Built from the tagged commit; never overwritten. |
| `latest`   | **publish**, `promote`   | Points at the newest release. Moves only after the GitHub Release is published.        |
| `unstable` | **dev image** workflow   | The head of `dev`. Rebuilt on every merge that touches server inputs.                  |

`unstable` is not a release: it carries the version checked into `dev` (the
last release's version), so it is not a pinned or reproducible reference.
Merges that only touch desktop code or docs do not rebuild it. Pin `X.Y.Z` (or
an image digest) for anything you want to stay put.

If a publish run fails after the `image` job, `X.Y.Z` can exist while
`latest` and the GitHub Release do not. Dispatching **publish** again converges
as described under [Recovery](#recovery).

## Changelog Policy

GitHub generates release notes from merged pull requests and the categories in
`.github/release.yml`. The gardener labels each pull request with a
`changelog:*` category from its conventional title and relabels it when the
title changes. Once a maintainer picks a category by hand, the gardener leaves
it alone; `changelog:skip` excludes a pull request from release notes.

If a release interval has no pull requests (for example, because it contains
direct commits), the publish workflow instead creates the same readable,
conventional-commit categories from the commits between the release tags.

## Version Policy

The checked-in package version is the source of truth and always matches the
newest release tag. The publish workflow is the only thing that bumps it.

These release version files are stamped together and must always match:

- `package.json`
- `Cargo.lock` (the `alloy-desktop`, `alloy-desktop-native`, and `alloy-agent`
  entries)
- `packages/desktop/package.json`, the app version electron-builder stamps
  into the installer
- `packages/desktop/host/Cargo.toml`
- `packages/desktop/native/Cargo.toml`
- `packages/desktop/recorder/Cargo.toml`

## Desktop Auto-Update

The desktop app updates through electron-updater, which reads `latest.yml`
from the latest GitHub release and downloads the NSIS installer it names.
Before it installs one, the app checks the installer against the minisign
signature the release adds to `latest.yml` (`alloySignature`), using the
public key compiled into the build. A build without the key has automatic
updates off; development builds never have it.

The key pair is the one the Tauri updater used, so existing installs keep
trusting releases. Configure the repository variable `ALLOY_UPDATER_PUBLIC_KEY`
and the secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before releasing; keep the private key
out of the repository. The publish workflow:

1. builds the installer with `ALLOY_UPDATER_PUBLIC_KEY` in the environment,
   which compiles it into the app;
2. signs the installer with `packages/desktop/update-signer`, which writes
   `<installer>.sig` in the format `tauri signer sign` wrote, binds the
   signature to the release version, and fails unless the key pair matches
   `ALLOY_UPDATER_PUBLIC_KEY`;
3. runs `scripts/prepare-desktop-release.mjs`, which adds the signature to
   `latest.yml` and writes `latest.json`.

`pnpm dlx @tauri-apps/cli signer generate` creates a key pair. A different key
will not update an installed build unless that build already trusts the new
key.

The installer is not Authenticode-signed, so Windows SmartScreen warns on a
manual install. Updates are unaffected.

Test a signed update on Windows before using the release workflow for
distribution.

## Moving from the Tauri Build

Releases up to v0.0.19 shipped a Tauri app. Its updater reads `latest.json`,
so every release keeps writing one that points at the Electron installer and
carries the same signature. A Tauri install offers that release as a normal
update; installing it runs the Electron installer, which:

- removes the Tauri app by running its uninstaller silently in update mode,
  which drops its files and Apps & Features entry but keeps the user's data;
- installs to `%LOCALAPPDATA%\Programs\alloy` and starts Alloy;
- points an existing `Alloy` login item at the new executable.

Settings, saved servers, the capture library, and logs stay where they were
(`%APPDATA%\dev.zekurio.alloy` and `%LOCALAPPDATA%\dev.zekurio.alloy`). The
browser profile does not carry over, so each server needs one new sign-in.

If the handoff fails on a machine, install the Electron build by hand: run
the installer from the release. It removes the Tauri app the same way.
Uninstalling the Tauri app first also works and keeps the data, as long as
its "delete the application data" box stays unchecked.

The move leaves the Tauri build's leftovers, which the installer does not
clean up: files in its old install folder (`%LOCALAPPDATA%\Alloy`), its
WebView2 profiles (`EBWebView\` and `webviews\` in
`%LOCALAPPDATA%\dev.zekurio.alloy`), which still hold its session cookies, and
its installer's registry key (`HKCU\Software\zekurio\Alloy`). Removing them
is safe once the Tauri app is gone.

`latest.json` can be dropped once no Tauri installs remain.

## Recovery

The workflow converges on finishing a pending release instead of duplicating
it:

- Preflight validation fails: nothing is committed or tagged. Fix `dev` and
  dispatch again.
- A run fails after the release commit and tag were pushed: dispatch again.
  Preflight detects that the checked-in version has no published release and
  rebuilds it from the exact tagged commit instead of bumping again.
- A release was published with bad assets: delete the release (keep or delete
  the tag), then dispatch again.
