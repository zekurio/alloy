# Releasing

Alloy has one GitHub Release channel and one unstable build channel:

- **Latest**: tagged `vX.Y.Z`, marked as the latest GitHub Release, and built
  by the Nix cache workflow.
- **Unstable**: built from `develop` pushes, uploaded as a workflow artifact.
  Server builds are consumed from the Nix flake by pinning the development
  branch or an exact commit.

GitHub Release assets are intentionally limited to the desktop app and
auto-update files:

- `Alloy-Desktop-...exe`
- the installer `.blockmap`
- `latest.yml`
- `checksums.txt`

Server distribution is handled by the Nix flake package and NixOS module.
Publishing a latest GitHub Release triggers the **Nix Cache** workflow for the
flake package.

Desktop auto-update follows the installed app's version channel. Latest builds
look at `latest.yml` and reject unstable versions. Unstable builds look at
`unstable.yml` and reject plain semver versions.

## Branch Policy

- `main` is the release-ready branch for tagged latest releases.
- `develop` is the integration branch for unstable builds and can be consumed by
  Nix users with `inputs.alloy.url = "github:zekurio/alloy/develop";`.
- Feature branches should target `develop` unless they are release fixes for
  `main`.
- Protect both `main` and `develop`. The unstable build path runs with write
  permissions for trusted `develop` pushes, so `develop` should only receive
  trusted merges.

## Latest Releases

1. Run **Release** manually with:
   - `channel`: `latest`
   - `version`: `X.Y.Z`

2. The workflow validates the version, locally updates all release version
   files, then runs formatting, lint, and typecheck before publishing anything.

3. After validation passes, the workflow commits the bump as
   `github-actions[bot]`, pushes it to the selected branch, and creates the
   matching `vX.Y.Z` tag from that commit.

4. The **Release** workflow builds the Windows desktop installer, attaches only
   desktop/update assets, and publishes the GitHub Release.

5. Publishing a latest release also triggers **Nix Cache** for the flake
   package.

Pushing an existing `vX.Y.Z` tag still works, but tag-triggered latest releases
require the checked-in package versions to already match the tag.

## Unstable Builds

Unstable builds are produced automatically when the **Release** workflow
receives a push to `develop`. They do not create GitHub Releases or prereleases.
The workflow runs formatting, lint, and typecheck before building the desktop
artifact.

To build unstable manually, run **Release** with:

- `channel`: `unstable`
- `version`: empty

The workflow derives the unstable version from the next patch after the current
root package version, the UTC date, and the GitHub run number for Electron
updater metadata. For example, `0.0.1` produces
`0.0.2-unstable.YYYYMMDD.<run>`. Unstable builds upload:

- the Windows desktop installer
- `unstable.yml`
- blockmaps

Download the latest unstable Electron artifact from
`https://nightly.link/zekurio/alloy/workflows/release/develop/desktop-release-assets.zip`.
That URL is backed by the latest successful push-triggered **Release** run on
`develop`.

For unstable server deployments, pin the development branch or an exact commit
in your flake input.

## Custom Release Notes

No custom bot is required. The release workflow uses the built-in
`GITHUB_TOKEN`, asks GitHub to generate the changelog for the matching channel,
and prepends Alloy-specific deployment notes for latest releases:

- which desktop updater manifest is attached (`latest.yml`)
- how to pin the matching Nix flake input

## Recovery

If validation fails, fix the issue and rerun the workflow; no release commit or
tag has been pushed yet. If a later build fails before the GitHub Release is
created, fix the issue and rerun the failed workflow jobs. If a release was
already published with bad assets, delete the release and tag, then rerun from
the corrected commit.
