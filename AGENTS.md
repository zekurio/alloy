# Alloy

Alloy is a self-hosted Medal.tv alternative. Its Electron desktop app records
gameplay through a Windows-only Rust OBS sidecar and loads the server-hosted
web app. The Hono server and React web app handle uploads, encoding, playback,
and social features.

Alloy is early and can take broad refactors. Prefer a smaller correct design
over preserving weak internals. Keep compatibility where versions can drift,
especially between the desktop shell and the server-hosted web app.

## Repository map

| Path                                                | Purpose                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| `packages/desktop`                                  | Electron shell, preload bridges, and sidecar management |
| `packages/recorder`                                 | Windows Rust recorder built on OBS                      |
| `packages/server`                                   | Hono API, uploads, jobs, and media processing           |
| `packages/web`                                      | React web app and file-based routes                     |
| `packages/contracts`                                | Shared schemas, types, and desktop contracts            |
| `packages/api`                                      | Typed API client                                        |
| `packages/db`                                       | Drizzle schema and database workflows                   |
| `packages/media`                                    | Shared media code                                       |
| `packages/ui`                                       | Shared React components and styles                      |
| `packages/env`, `packages/i18n`, `packages/logging` | Shared infrastructure                                   |

Read the relevant package README and nearby code before changing a subsystem.
Do not overwrite unrelated working-tree changes.

## Tooling and development

Use Node 24 and the pinned `pnpm@11.13.0`. Never use npm, Yarn, or Bun. Prefer
root scripts. For package-specific work, run
`pnpm --filter @alloy/<package> <script>`.

```sh
pnpm dev          # push the schema, then start server and web
pnpm dev:all      # also start the desktop shell
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:studio
pnpm verify       # formatting check, lint, and typecheck
```

Run `pnpm verify` before completing a code change. The repo uses oxfmt, oxlint,
strict ESM TypeScript, and `tsc --noEmit`.

The recorder builds only on Windows. From `packages/recorder`, check Rust
changes with `cargo fmt --check` and
`cargo clippy --all-targets --locked -- -D warnings`.

For changes under `nix/` or to `flake.nix`, run `nix flake check`. Run
`nix build .#alloy` only when the change warrants a full build.

## Architecture

Server routes use Hono handlers with `zValidator` and Zod input schemas. Return
helpers from `packages/server/src/runtime/http-response.ts` for HTTP errors.
Define background work with `defineJobKind(...)` in
`packages/server/src/jobs/kinds/`. Keep the media pipeline behind the
`MediaStore` interface in `packages/server/src/queue/media-store.ts`.

Web requests go through `createApi()` in `packages/web/src/lib/api.ts`. Query
configuration lives in `packages/web/src/lib/*-queries.ts` and uses TanStack
Query options. Routes live in `packages/web/src/routes/`; use the guards from
`packages/web/src/lib/auth-guards.ts`.

Desktop renderers reach the main process through preload bridges. The web
bridge in `packages/contracts/src/desktop-bridge.ts` is additive-only because
the web app and desktop shell update independently. Add a contract entry and
its typed handler fragment instead of creating a channel or preload wrapper.
Gate web features with `desktopSupports` from
`packages/web/src/lib/desktop.ts`.

Sidecar protocol changes must update both
`packages/desktop/src/main/recording-sidecar-protocol.ts` and
`packages/recorder/src/sidecar_types.rs`.

Put cross-package types and constants in `packages/contracts`. Use Zod when a
value crosses a runtime boundary; use plain TypeScript types otherwise.

## Git and pull requests

`dev` is the only long-lived branch. Use `dev` or `origin/dev` for diffs and
target pull requests at `dev`. Follow `.github/CONTRIBUTING.md` for branch,
commit, and PR conventions.

UI pull requests need before and after screenshots. Release notes use one
`changelog:*` label derived from the conventional PR title; use
`changelog:skip` when no release note is needed.
