# Alloy

Alloy is a self-hosted Medal.tv alternative: a React web app, Hono server,
and Tauri desktop app with a Windows-only Rust OBS recorder.

Use package READMEs for subsystem-specific setup and conventions.
Refactor when it simplifies the requested change; preserve compatibility
across independently released components.
Leave unrelated working-tree changes alone.

## Development

- Use Node 24 and `pnpm@11.24.0`, not npm, Yarn, or Bun. Prefer root scripts;
  use `pnpm --filter @alloy/<package> <script>` for package-specific work.
- Run `pnpm verify` before completing code changes and `pnpm test [path]`
  for relevant tests. Test observable, regression-prone behavior, not internals
  or framework behavior.
- For Rust changes, run these checks from the repo root. Both desktop crates
  require Windows to build and run Clippy:
  `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets --locked -- -D warnings`.
- For Nix changes, run `nix flake check`. Build `.#alloy` only when needed.

## Boundaries

- Keep shared web/server contracts in `packages/contracts`, native contracts in
  `packages/desktop-contracts`, and shared scalars in `packages/primitives`.
  Validate runtime inputs; use plain TypeScript types otherwise.
- Keep OBS in the recorder process. Define sidecar wire types once in
  `packages/desktop/recorder/src/types.rs` and import them in the host.
- Native commands must validate inputs and the calling window's selected origin.
  Separate local connection permissions from remote window permissions, and ignore
  unsupported native bridge contracts in browsers.
- Use same-origin requests with HttpOnly cookies in the WebView, not an API proxy.
  Derive native download targets from the selected server and a validated clip ID,
  never a renderer-supplied origin.
- Match desktop/server compatibility IDs exactly through `/api/server-info`.
  HTTP contract 1 may change in place while desktop and server deploy together;
  version breaking changes once independent deployments exist.

## Pull requests

Target `dev` and use it for diffs. Follow `.github/CONTRIBUTING.md` for conventions.
Attach before/after screenshots to UI PRs rather than committing them.
Use one `changelog:*` label, or `changelog:skip` when no release note is needed.
