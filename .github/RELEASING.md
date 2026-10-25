# Releasing

Alloy has a single long-lived branch (`dev`) and a single release channel.
Releases are cut on demand by the **publish** workflow, tagged `vX.Y.Z`, and
named after the tag.

Server distribution is handled by the Nix flake package and NixOS module. We do
not attach server artifacts to GitHub Releases. The same Nix build is also
published as a container image (see [Container Images](#container-images)).
The Linux desktop app ships the same way, through `packages.alloy-desktop` and
`nixosModules.desktop`; it has no release asset and no auto-update.

GitHub Release assets are intentionally limited to the Windows desktop app and
its auto-update files:

- `Alloy-Desktop-...exe`
- the installer `.sig`
- `latest.json`
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
- `Cargo.lock` (the `alloy-desktop` and `alloy-agent` entries)
- `packages/desktop/package.json`
- `packages/desktop/src-tauri/tauri.conf.json`
- `packages/desktop/src-tauri/Cargo.toml`
- `packages/desktop/recorder/Cargo.toml`

## Desktop Auto-Update

Packaged Tauri builds read `latest.json` from the latest GitHub release. Every
update requires a valid Tauri signature. Configure the repository variable
`ALLOY_UPDATER_PUBLIC_KEY` and the secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before releasing. The private key signs the
installer. Keep the private key out of the repository.

The update endpoint lives in `plugins.updater` in
`packages/desktop/src-tauri/tauri.conf.json`, and the checked-in public key is
empty so development builds have auto-update off. The publish workflow writes
`ALLOY_UPDATER_PUBLIC_KEY` into a temporary config file and passes it to
`tauri build` as an extra `--config`, which both signs the update artifacts and
puts the key in the bundled app. The app reads the key and the endpoint back
from that config at runtime; nothing is compiled in through the environment.

Use `pnpm exec tauri signer generate` from `packages/desktop` to create a
key pair. Store the private key securely. A different key will not update an
installed build unless that build already trusts the new key.

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
