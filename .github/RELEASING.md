# Releasing

The release flow is modeled on immich's: one manual dispatch prepares
everything, and publishing the draft GitHub release is the final, human gate
that makes the release public.

## App + server release (`v*` tags)

1. Run the **Release** workflow directly for a CI-stamped prerelease, or run
   **Prepare Release** when you want the version bump committed back to `main`.
   Both paths use one release version for the server, desktop app, and recorder
   sidecar.
2. The **Release** workflow resolves the release metadata, aligns package
   versions in CI, builds the Nix package and container image as validation,
   builds the Windows desktop installer and recorder runtime, and creates a
   **draft** GitHub release with the installer, recorder zip, blockmap,
   `latest.yml`, and checksums attached.
3. Review the draft release notes, then **publish** it. Publishing:
   - makes the desktop installer and `latest.yml` visible to electron-updater
     (drafts are invisible to auto-update), and
   - triggers the **Publish Release Image** workflow, which pushes the server
     image to GHCR as `vX.Y.Z` plus `latest` for stable releases. Stable
     builds also push to the Cachix cache.

Semver prerelease versions (`X.Y.Z-rc.N`, `X.Y.Z-beta.N`, etc.) are marked as
prereleases and never tagged `latest`.

## Nightly / main channel images

`main-image.yml` publishes `main` and `nightly` channel server images
(`X.Y.Z-<channel>.<run>.<sha>`) on a schedule or manual dispatch, independent
of releases.

## Recorder runtime

Recorder releases are part of the app release. The release workflow stamps
`packages/recorder/package.json` and `packages/recorder/Cargo.toml` to the app
release version, builds the Windows x64 runtime, and attaches the recorder zip
to the same GitHub release as the desktop installer.
