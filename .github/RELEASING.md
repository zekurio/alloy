# Releasing

Alloy has two GitHub Release channels for the desktop updater:

- **Latest**: built from `main` pushes, tagged `vX.Y.Z`, marked as the latest
  GitHub Release, and exposed through `latest.yml`.
- **Unstable**: built from desktop-impacting `develop` pushes, tagged
  `vX.Y.Z-unstable.YYYYMMDD.<run>`, published as a prerelease, and exposed
  through `unstable.yml`.

Server distribution is handled by the Nix flake package and NixOS module. We do
not attach server artifacts to GitHub Releases.

GitHub Release assets are intentionally limited to the desktop app and
auto-update files:

- `Alloy-Desktop-...exe`
- the installer `.blockmap`
- `latest.yml` or `unstable.yml`
- `checksums.txt`

Publishing a latest release also triggers the **Nix Cache** workflow for the
flake package. Prerelease unstable builds do not.

Desktop auto-update follows the selected app channel. Latest builds look at
`latest.yml` and reject unstable versions. Unstable builds look at
`unstable.yml` and reject plain semver versions.

## Branch Policy

- `main` is the release branch. Pushing to `main` publishes a latest release
  using the checked-in package version.
- `develop` is the integration branch. Desktop-impacting pushes publish
  unstable prereleases.
- Feature branches should target `develop` unless they are release fixes for
  `main`.
- Protect both `main` and `develop`. Release publishing runs with write
  permissions for trusted branch pushes, so these branches should only receive
  trusted merges.

## Version Policy

The checked-in package version is the source of truth.

- Latest releases use the exact checked-in plain semver, such as `1.2.3`.
- Unstable releases use that same version with an unstable suffix, such as
  `1.2.3-unstable.20260622.456`.
- The release workflow does not increment the version.

All release version files must match before any desktop artifact is published:

- `package.json`
- `packages/desktop/package.json`
- `packages/recorder/package.json`
- `packages/recorder/Cargo.toml`
- `packages/recorder/Cargo.lock`

## Latest Releases

1. On `develop`, bump the package version to the intended stable version.

   ```sh
   node scripts/update-release-package-versions.mjs X.Y.Z --desktop-channel latest
   ```

2. Open a PR from `develop` into `main`.

3. CI runs the release version guard for `develop` -> `main` PRs. It fails if
   the root semver is unchanged from `main` or if release version files do not
   match.

4. Merge the PR into `main`.

5. The **Release** workflow creates or reuses tag `vX.Y.Z` on the merge commit,
   builds the Windows desktop installer, attaches only desktop/update assets,
   and publishes the GitHub Release.

Manual versioned latest releases are intentionally deprecated. A stable release
is created by merging the versioned release PR to `main`.

## Unstable Builds

Unstable builds are produced automatically when the **Release** workflow
receives a desktop-impacting push to `develop`. Server-only, web-only, and
documentation-only pushes do not create desktop artifacts.

The workflow stamps the checked-in package version with the UTC date and GitHub
run number for Electron updater metadata. For example, checked-in version
`0.2.0` produces `0.2.0-unstable.YYYYMMDD.<run>`.

Unstable prereleases upload:

- the Windows desktop installer
- `unstable.yml`
- blockmaps
- `checksums.txt`

For unstable server deployments, pin the development branch or an exact commit
in your flake input.

## Custom Release Notes

No custom bot is required. The release workflow uses the built-in
`GITHUB_TOKEN`, asks GitHub to generate the changelog for the matching channel,
and prepends Alloy-specific deployment notes:

- which desktop updater manifest is attached
- how to pin the matching Nix flake input

## Recovery

If validation fails, fix the issue and push again; no artifact is published. If
a build fails after the tag is created, rerun the failed workflow from the same
commit. If a release was already published with bad assets, delete the release
and tag, then rerun from the corrected commit.
