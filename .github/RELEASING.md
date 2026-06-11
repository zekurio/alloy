# Releasing

The release flow is modeled on immich's: one manual dispatch prepares
everything, and publishing the draft GitHub release is the final, human gate
that makes the release public.

## App + server release (`v*` tags)

1. Run the **Prepare Release** workflow. Pick a semver bump (`patch`, `minor`,
   `major`, or one of the `pre*` bumps, which use the `rc` preid), or set an
   explicit version override. The workflow bumps `package.json` and
   `packages/desktop/package.json`, runs format/lint/typecheck, commits
   `chore(release): prepare vX.Y.Z` to `main`, creates the `vX.Y.Z` tag, and
   dispatches the **Release** workflow (tags pushed with `GITHUB_TOKEN` do not
   trigger tag-push workflows on their own).
2. The **Release** workflow validates the tag (must point at `main`, versions
   must match), builds the Nix package and container image as validation,
   builds the Windows desktop installer, and creates a **draft** GitHub
   release with the installer, blockmap, `latest.yml`, and checksums attached.
3. Review the draft release notes, then **publish** it. Publishing:
   - makes the desktop installer and `latest.yml` visible to electron-updater
     (drafts are invisible to auto-update), and
   - triggers the **Publish Release Image** workflow, which pushes the server
     image to GHCR as `vX.Y.Z` plus `latest` for stable releases. Stable
     builds also push to the Cachix cache.

Prerelease versions (`X.Y.Z-rc.N`) are marked as prereleases and never tagged
`latest`.

## Nightly / main channel images

`main-image.yml` publishes `main` and `nightly` channel server images
(`X.Y.Z-<channel>.<run>.<sha>`) on a schedule or manual dispatch, independent
of releases.

## Recorder release (`recorder-v*` tags)

The recorder keeps its own flow: **Prepare Recorder Release** commits the
version bump, then pushing the `recorder-vX.Y.Z` tag runs **Recorder Release**,
which publishes the runtime zip directly (no draft gate). Recorder releases
ship no server image; **Publish Release Image** ignores them.
