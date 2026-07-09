# Contributing to Alloy

Thanks for your interest in improving Alloy. This guide covers the workflow
for getting a change from idea to merged PR. For a tour of the codebase, see
the [repository guide in the README](../README.md#repository-guide).

## Before You Start

- Bug reports and feature requests go through the
  [issue templates](https://github.com/zekurio/alloy/issues/new/choose).
- For anything beyond a small fix, open an issue first so the approach can be
  discussed before you invest time in it.
- Security issues must be reported privately; see [SECURITY.md](SECURITY.md).

## Development Setup

Nix users get the complete toolchain (Node, pnpm, PostgreSQL, ffmpeg, Rust,
Electron) plus a repo-local Postgres via devenv:

```bash
nix profile install nixpkgs#devenv nixpkgs#direnv
direnv allow
pnpm install
pnpm dev
```

For non-Nix setups, install Node 24 and pnpm 11 (the repo pins
`pnpm@11.4.0` via `packageManager`, so `corepack enable` is enough), provide
a local PostgreSQL database, and copy the env template:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` pushes the Drizzle schema and starts the API server plus the Vite
web app. `pnpm dev:all` also starts the Electron desktop shell. The recorder
sidecar (`packages/recorder`) is Rust and only builds on Windows.

Never use npm, yarn, or Bun in this repo.

## Branches and Commits

- `dev` is the only long-lived branch; feature branches target `dev`.
  Releases are tagged from `dev` by maintainers (see
  [RELEASING.md](RELEASING.md)).
- Branch names are at most three hyphen-separated words, without slashes or
  type prefixes: `session-recovery`, `fix-scroll-state`.
- Commits and PR titles use conventional commit style: `type(scope): summary`
  with types `feat`, `fix`, `docs`, `chore`, `refactor`, or `test`, e.g.
  `fix(web): keep scroll position on feed refresh`.

## Code Style

Formatting is oxfmt and linting is oxlint (not Prettier/ESLint); TypeScript
is strict ESM. Don't hand-format — run the tools:

```bash
pnpm fmt        # format
pnpm lint       # lint (type-aware; no-console is an error)
pnpm typecheck  # tsc --noEmit across packages
```

## Testing

- Server tests: `pnpm --filter @alloy/server test`. DB-backed suites
  provision per-suite databases through `ALLOY_TEST_DATABASE_URL`.
- Recorder tests (Windows): `cargo test --locked` in `packages/recorder`,
  along with `cargo fmt --check` and
  `cargo clippy --all-targets --locked -- -D warnings`.
- Prefer testing real behavior over mocks; don't duplicate implementation
  logic into tests.

## Submitting a PR

1. Make sure `pnpm verify` passes (fmt check, lint, typecheck, tests).
2. Open the PR against `dev` and fill in the pull request template, including
   how you verified the change.
3. CI runs formatting, lint, typecheck, tests, a server/web build, and a Nix
   flake check. Recorder changes additionally run the Rust checks on Windows.

Releases are tagged from `dev` by maintainers; see
[RELEASING.md](RELEASING.md) for the release process.
