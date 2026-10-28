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
- `checksums.txt`

## Cutting a Release

Dispatch the **publish** workflow from the Actions tab (it only runs on
`dev`). Pick a `bump` of `patch`, `minor`, or `major`, or set an exact
`version` override. The workflow then:

1. Checks that the update signing key opens with its password and matches
   one of the keys in `ALLOY_UPDATER_PUBLIC_KEY`, so a broken signing setup
   stops the release before anything is tagged.
2. Runs formatting, lint, and typecheck against the current `dev` head.
3. Stamps the new version into all release version files.
4. Commits `chore: release vX.Y.Z` to `dev` and tags that commit `vX.Y.Z`
   (pushed atomically).
5. Builds the Windows desktop installer from the tagged commit, then signs
   it in a separate job.
6. Builds and pushes the server container image tagged with the release
   version, then publishes the GitHub Release with categorized generated notes, the installer,
   update signatures, and checksums.
7. Moves the `latest` container image tag to the new release.

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
public keys compiled into the build. The signature's trusted comment names
the installer file and the release version, and the app accepts it only for
the file it downloaded and the version `latest.yml` offers, which must be
newer than the running app. An installer that fails the check is deleted,
and the app asks the user to reinstall from the releases page. A build
without keys has automatic updates off; development builds never have them.

The keys live in the repository variable `ALLOY_UPDATER_PUBLIC_KEY` and the
secrets `ALLOY_UPDATE_SIGNING_KEY` and `ALLOY_UPDATE_SIGNING_KEY_PASSWORD`.
`ALLOY_UPDATER_PUBLIC_KEY` lists one or more public keys, each the base64 of
a `.pub` file, separated by whitespace or commas. The app trusts every listed
key and checks a signature with the one whose key ID it names. The secrets
hold a single private key, which must match one of the listed keys. Keep a
copy of the private key and its password outside GitHub, which cannot show a
secret again. The publish workflow:

1. builds the installer in the `desktop` job with `ALLOY_UPDATER_PUBLIC_KEY`
   in the environment, which compiles the keys into the app. This job runs
   npm code, so it gets no secrets;
2. signs the installer in the `sign` job, which builds only
   `packages/desktop/update-signer` from `Cargo.lock` and runs no npm code.
   The signer writes `<installer>.sig`, binds the signature to the installer's
   file name and the release version, and fails unless the key pair matches
   one of the keys in `ALLOY_UPDATER_PUBLIC_KEY`;
3. runs `scripts/prepare-desktop-release.mjs` in the `sign` job, which adds
   the signature to `latest.yml`.

### Update Keys

Generate two key pairs, the release key and a spare. Run the following and
set a password for each when asked; the signer only takes password-protected
keys:

```sh
nix run nixpkgs#minisign -- -G -p alloy-update.pub -s alloy-update.key
nix run nixpkgs#minisign -- -G -p alloy-update-spare.pub -s alloy-update-spare.key
```

Store `base64 -w0 alloy-update.key` as `ALLOY_UPDATE_SIGNING_KEY` and its
password as `ALLOY_UPDATE_SIGNING_KEY_PASSWORD`. List both public keys in
`ALLOY_UPDATER_PUBLIC_KEY`:

```sh
echo "$(base64 -w0 alloy-update.pub) $(base64 -w0 alloy-update-spare.pub)"
```

Keep the spare's private key and its password offline only, never in GitHub
or on a machine that builds releases.

Installed builds trust only the keys they were built with. To rotate, for
example when the release key may have leaked, store the spare as
`ALLOY_UPDATE_SIGNING_KEY` and `ALLOY_UPDATE_SIGNING_KEY_PASSWORD` and drop
the old public key from `ALLOY_UPDATER_PUBLIC_KEY`. Installed builds already
trust the spare, so they take the next release, and that build no longer
trusts the old key. Then generate a new spare and add its public key to the
list. An installed build that trusts none of the keys a release is signed
with cannot update to it and needs a manual reinstall.

The installer is not Authenticode-signed, so Windows SmartScreen warns on a
manual install. Updates are unaffected.

Test a signed update on Windows before using the release workflow for
distribution.

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
- Only `promote` failed: the release is published, so dispatching again would
  cut the next release. Re-run the failed job from the workflow run instead.
