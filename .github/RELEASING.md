# Releasing

The release flow is modeled on immich's: one manual dispatch prepares
everything into a draft GitHub release, and publishing that draft is the
final, human gate that makes the release public. Publishing fires the native
`release: published` event, which fans out to the Docker and Nix cache
workflows — no cross-workflow dispatching and no extra tokens.

## App + server release (`v*` tags)

1. Run the **Release** workflow and pick a semver `bump` (`prerelease`,
   `prepatch`, `preminor`, `premajor` continue an rc cycle; `patch`, `minor`,
   `major` finish one). The workflow computes the next version from
   `package.json` (rc preid), stamps the root, desktop, and recorder package
   metadata, runs formatting, lint, and typecheck, then commits the bump to
   `main` and pushes the commit and `vX.Y.Z` tag atomically.
2. From that exact commit it builds:
   - the linux-x64 server bundle
     (`alloy-server-vX.Y.Z-linux-x64.tar.gz` with `server/`, `web/`, and
     `migrations/`),
   - the Nix flake package and OCI image (validation; publishing happens on
     the publish event), and
   - the Windows desktop installer, updater metadata (`latest.yml`), and
     recorder runtime zip.
3. It then creates a **draft** GitHub release with all binaries and combined
   checksums attached. The prerelease flag is derived from the version (any
   `-rc.N` suffix marks a prerelease); the draft's prerelease checkbox is the
   manual override if you ever need one.
4. Review the draft notes, then **publish**. Publishing:
   - makes the installer and `latest.yml` visible to electron-updater (drafts
     are invisible to auto-update),
   - triggers **Docker**, which builds the Nix-based image
     (`.#alloy-image`, the same store closure as the Nix package) from the
     release tag and pushes the `ghcr.io` image tagged `vX.Y.Z`, plus
     `latest` for full releases; prereleases ship only their pinned version
     tag (the channel comes from the published release's prerelease flag),
     and
   - triggers **Nix Cache**, which builds the flake package and pushes it to
     Cachix for full releases.

If a build job fails after the tag was pushed, no draft is created; fix the
issue and use **Re-run failed jobs** on the same run.

## Main channel images

The **Docker** workflow also runs on every push to `main`, publishing
`main` and `main-<sha>` images (`X.Y.Z-main.<run>.<sha>` build version), so
the latest mainline server is always pullable without cutting a release.
Note: the release version-bump commit itself is pushed with `GITHUB_TOKEN`,
which never triggers other workflows, so that one commit does not produce a
`main` image — its image ships via the release path instead.

## Recorder runtime

Recorder releases are part of the app release. The release workflow stamps
`packages/recorder/package.json` and `packages/recorder/Cargo.toml` to the app
release version, builds the Windows x64 runtime, and attaches the recorder zip
to the same GitHub release as the desktop installer.
