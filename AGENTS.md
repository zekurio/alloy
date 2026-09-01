# Alloy

Alloy is a self-hosted Medal.tv alternative. Its Electron desktop app records
gameplay through a Windows-only Rust OBS sidecar and loads the selected
server's React app. The Hono server handles uploads, encoding, playback, and
social features; it serves the same UI to browsers and Alloy Desktop.

Alloy is early and can take broad refactors. Prefer a smaller correct design
over preserving weak internals. Keep compatibility at independently released
boundaries, especially desktop-to-server HTTP and desktop-to-recorder IPC.

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

Use Node 24 and the pinned `pnpm@11.24.0`. Never use npm, Yarn, or Bun. Prefer
root scripts. For package-specific work, run
`pnpm --filter @alloy/<package> <script>`.

```sh
pnpm dev          # push the schema, then start server and web
pnpm dev:all      # also start the desktop shell
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:studio
pnpm test
pnpm test packages/server/src/path/to/file.test.ts
pnpm verify       # formatting check, lint, and typecheck
```

Run `pnpm verify` before completing a code change. Vite+ owns test discovery,
formatting, and linting through the root `vite.config.ts`; the repo also uses
strict ESM TypeScript and `tsc --noEmit`.

Add tests only for observable, regression-prone behavior. Do not assert raw SQL
text, schema layout, private helper composition, or framework behavior. Test
constants only at released contract boundaries. Prefer one boundary-level test
over separate tests for each branch.

The recorder builds only on Windows. From `packages/recorder`, check Rust
changes with `cargo fmt --check` and
`cargo clippy --all-targets --locked -- -D warnings`.

For changes under `nix/` or to `flake.nix`, run `nix flake check`. Run
`nix build .#alloy` only when the change warrants a full build.

## Architecture

Server routes use Hono handlers with `tbValidator` and TypeBox input schemas.
Return helpers from `packages/server/src/runtime/http-response.ts` for HTTP errors.
Define background work with `defineJobKind(...)` in
`packages/server/src/jobs/kinds/`. Keep the media pipeline behind the
`MediaStore` interface in `packages/server/src/queue/media-store.ts`.

Web requests go through `createApi()` in `packages/web/src/lib/api.ts`. Query
configuration lives in `packages/web/src/lib/*-queries.ts` and uses TanStack
Query options. Routes live in `packages/web/src/routes/`; use the guards from
`packages/web/src/lib/auth-guards.ts`.

Electron injects `window.alloyDesktop` only into the selected server's exact
origin. The server-hosted renderer and installed preload release independently,
so the bridge uses an exact contract ID advertised by `/api/server-info`.
Define its cross-process types in `packages/contracts/src/desktop-api.ts`, add
operation wiring in `packages/desktop/src/shared/desktop-api.ts`, and add an
exhaustive validated main-process handler. Main-process IPC guards must require
the selected BrowserWindow, top-level frame, and exact selected server origin.

The main window loads the server origin directly. Browser networking, cookies,
uploads, event streams, media, and history use normal same-origin Chromium
behavior; do not add an Electron HTTP proxy. The local connect renderer is only
for selection and recovery. Desktop/server HTTP and bridge compatibility use
exact IDs from `/api/server-info`; contract 1 IDs are immutable.

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
