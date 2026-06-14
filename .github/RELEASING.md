# Releasing

Alloy has two release channels:

- **Stable**: tagged `vX.Y.Z`, marked as the latest GitHub Release, and paired
  with the `ghcr.io/zekurio/alloy:latest` Docker tag.
- **Nightly**: tagged `vX.Y.Z-nightly.YYYYMMDD.<run>`, marked as a prerelease,
  and paired with the `ghcr.io/zekurio/alloy:nightly` Docker tag.

GitHub Release assets are intentionally limited to the desktop app and
auto-update files:

- `Alloy-Desktop-...exe`
- the installer `.blockmap`
- `latest.yml` for stable releases or `nightly.yml` for nightly releases
- `checksums.txt`

Server distribution is handled by the **Release** workflow's server image job.
Release notes include the matching pinned image tag and the channel tag to use.

Desktop auto-update follows the installed app's version channel. Stable builds
look at `latest.yml` and reject nightly versions; nightly builds look at
`nightly.yml` and reject stable versions.

## Stable Releases

1. Update the release version in a normal PR if it is not already correct:

   ```bash
   node scripts/update-release-package-versions.mjs X.Y.Z
   pnpm install --lockfile-only
   pnpm fmt
   pnpm lint
   pnpm typecheck
   ```

2. After `main` is green, create and push a stable tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. The **Release** workflow runs formatting, lint, and typecheck, builds the
   Windows desktop installer, publishes the server image, attaches only
   desktop/update assets, and publishes the GitHub Release.

4. The server image job publishes:
   - `ghcr.io/zekurio/alloy:vX.Y.Z`
   - `ghcr.io/zekurio/alloy:latest`

5. Publishing a stable release also triggers **Nix Cache** for the flake package.

## Nightly Releases

Nightlies run automatically every day at `03:00 UTC`. The workflow skips the
scheduled run when `main` has not changed since the last nightly tag.

To cut a nightly manually, run **Release** with:

- `channel`: `nightly`
- `version`: empty

The workflow derives the nightly version from the next patch after the current
root package version, the UTC date, and the GitHub run number. For example,
`0.0.1` produces `0.0.2-nightly.YYYYMMDD.<run>`. Nightly releases publish:

- the Windows desktop installer
- `nightly.yml`
- blockmaps and checksums

The server image job publishes:

- `ghcr.io/zekurio/alloy:vX.Y.Z-nightly.YYYYMMDD.<run>`
- `ghcr.io/zekurio/alloy:nightly`

## Custom Release Notes

No custom bot is required. The release workflow uses the built-in
`GITHUB_TOKEN`, asks GitHub to generate the changelog for the matching channel,
and prepends Alloy-specific deployment notes:

- which desktop updater manifest is attached (`latest.yml` or `nightly.yml`)
- which Docker image to use for the channel
- which pinned Docker image reproduces the exact release

## Recovery

If a build fails before the GitHub Release is created, fix the issue and rerun
the failed workflow jobs. If a release was already published with bad assets,
delete the release and tag, then rerun from the corrected commit.
