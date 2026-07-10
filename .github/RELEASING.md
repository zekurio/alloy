# Releasing

Alloy has a single long-lived branch (`dev`) and a single release channel.
Releases are cut on demand by the **publish** workflow, tagged `vX.Y.Z`, and
named after the tag.

Server distribution is handled by the Nix flake package and NixOS module. We do
not attach server artifacts to GitHub Releases.

GitHub Release assets are intentionally limited to the desktop app and
auto-update files:

- `Alloy-Desktop-...exe`
- the installer `.blockmap`
- `latest.yml`
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
5. Publishes the GitHub Release with categorized generated notes, the installer,
   `latest.yml`, blockmap, and checksums.

## Changelog Policy

GitHub generates release notes from merged pull requests and the categories in
`.github/release.yml`. New pull requests receive a `changelog:*` label from
their conventional title. Maintainers should replace the automated category
when necessary; `changelog:skip` excludes a pull request from release notes.

If a release interval has no pull requests (for example, because it contains
direct commits), the publish workflow instead creates the same readable,
conventional-commit categories from the commits between the release tags.

## Version Policy

The checked-in package version is the source of truth and always matches the
newest release tag. The publish workflow is the only thing that bumps it.

These release version files are stamped together and must always match:

- `package.json`
- `packages/desktop/package.json`
- `packages/recorder/package.json`
- `packages/recorder/Cargo.toml`
- `packages/recorder/Cargo.lock`

## Desktop Auto-Update

Packaged desktop builds update from the GitHub releases feed through
`latest.yml`. There is a single update channel and prereleases are never
published, so every install converges on the newest release.

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
