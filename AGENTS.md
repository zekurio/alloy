# Alloy

Alloy is a self-hosted Medal.tv alternative: a React web app, Hono server,
and Electron desktop app whose native work is in Rust, with a Rust OBS
recorder for Windows and Linux.

Use package READMEs for subsystem-specific setup and conventions.
Refactor when it simplifies the requested change; preserve compatibility
across independently released components.
Leave unrelated working-tree changes alone.

## Repository map

- `packages/web`: React web app (Vite). `packages/ui`: shared components.
- `packages/server`: Hono API server, media pipeline, storage, queues.
- `packages/db`: Drizzle schema and migrations. `packages/api`: typed web API client.
- `packages/contracts`: web/server contracts, plus native bridge contracts
  under `@alloy/contracts/desktop`. `packages/primitives`: desktop bridge
  contract IDs.
- `packages/env`: env parsing and `.env` loading. `packages/logging`: logger.
  `packages/i18n`: English-keyed message catalogs.
- `packages/desktop`: Electron shell (`src/main`, `src/preload`, and the
  connect screen in `src/connect`), the Rust `host` library and the napi-rs
  `native` addon that loads it, the Rust `recorder` (OBS sidecar), and the
  `update-signer` the release workflow signs installers with.
- `scripts`: release tooling. `tools/oxlint`: custom lint rules. `nix`: package
  and NixOS module. `.github/gardener`: PR/issue upkeep bot.

## Development

- Use Node 24 and `pnpm@11.24.0`, not npm, Yarn, or Bun. Prefer root scripts;
  use `pnpm --filter @alloy/<package> <script>` for package-specific work.
- Run `pnpm verify` before completing code changes. Unit tests have been
  removed; E2E testing is planned but not configured yet. Validate affected
  workflows manually until E2E coverage is available.
- For Rust changes, run these checks from the repo root:
  `cargo fmt --all --check` and
  `cargo clippy --workspace --all-targets --locked -- -D warnings`.
  The crates build and record on Linux and Windows; only Windows builds the
  installer.
- For schema changes, generate migrations with a descriptive snake_case name,
  e.g. `pnpm db:generate --name session_tokens`, never Drizzle's random
  default. Never edit a migration's SQL after it merges; add a new one instead.
  The one exception is the 0.1.0 reset, which replaced the 0.0.x migrations
  with `0000_initial_schema`; the rule holds for every migration after it.
- For Nix changes, run `nix flake check`. Build `.#alloy` only when needed.

## Boundaries

- Keep shared web/server contracts and scalars in `packages/contracts`, and
  the bridge contract IDs in `packages/primitives`. Native bridge contracts
  live in the `desktop-*` modules of `packages/contracts`, exported through
  `@alloy/contracts/desktop` rather than the root entry point; the server does
  not import them.
  Validate runtime inputs; use plain TypeScript types otherwise.
- Keep OBS in the recorder process. Define sidecar wire types once in
  `packages/desktop/recorder/src/types.rs` and import them in the host.
- Native commands must validate inputs and the calling window's selected origin.
  The server-hosted web app reads the bridge from `window.alloyDesktop` and
  accepts only its exact contract ID; make breaking bridge changes under a new ID.
  Separate local connection permissions from remote window permissions, and ignore
  unsupported native bridge contracts in browsers.
- Use same-origin requests with HttpOnly cookies in the server window, not an
  API proxy.
  Derive native download targets from the selected server and a validated clip ID,
  never a renderer-supplied origin.
- Match desktop/server compatibility IDs exactly through `/api/server-info`.
  HTTP contract 1 may change in place while desktop and server deploy together;
  version breaking changes once independent deployments exist.

## Pull requests

Target `dev` and use it for diffs. Follow `.github/CONTRIBUTING.md` for conventions.
Attach before/after screenshots to UI PRs rather than committing them.
Use one `changelog:*` label, or `changelog:skip` when no release note is needed.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
