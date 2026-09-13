# Alloy

Alloy is a self-hosted Medal.tv alternative. Its Tauri desktop app records
gameplay through a Windows-only Rust OBS sidecar. It bundles a local connection
screen and loads the selected server's React app. The Hono server handles uploads, encoding, playback, and
recommendations; it also serves the React app to normal browsers.

Alloy is early and can take broad refactors. Prefer a smaller correct design
over preserving weak internals. Keep compatibility at independently released
boundaries, especially desktop-to-server HTTP and desktop-to-recorder IPC.

## Repository map

| Path                                                | Purpose                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| `packages/desktop`                                  | Tauri shell, local connection screen, and native bridge  |
| `packages/recording-host`                           | Rust recorder process control and settings               |
| `packages/capture-library`                          | Rust local library, file streaming, and media processing |
| `packages/recorder`                                 | Windows Rust recorder built on OBS                       |
| `packages/server`                                   | Hono API, uploads, jobs, and media processing            |
| `packages/web`                                      | React web app and file-based routes                      |
| `packages/contracts`                                | Shared schemas, types, and desktop contracts             |
| `packages/api`                                      | Typed API client                                         |
| `packages/db`                                       | Drizzle schema and database workflows                    |
| `packages/ui`                                       | Shared React components and styles                       |
| `packages/env`, `packages/i18n`, `packages/logging` | Shared infrastructure                                    |

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

The recorder and the Tauri desktop host build only on Windows. Check Rust
changes in `packages/recorder`, `packages/recording-host`,
`packages/capture-library`, and `packages/desktop/src-tauri` with
`cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`
(`pnpm --filter @alloy/desktop check:native` covers the host crate).

For changes under `nix/` or to `flake.nix`, run `nix flake check`. Run
`nix build .#alloy` only when the change warrants a full build.

## Architecture

Server routes use Hono handlers with `tbValidator` and TypeBox input schemas.
Return helpers from `packages/server/src/runtime/http-response.ts` for HTTP errors.
Start background work from the action that requires it. Keep durable intent
in its owning domain, and validate current data before acting. Do not add
generic job registries or recurring sweeps. Keep the media pipeline behind the
`MediaStore` interface in `packages/server/src/queue/media-store.ts`.

Web requests go through `createApi()` in `packages/web/src/lib/api.ts`. Query
configuration lives in `packages/web/src/lib/*-queries.ts` and uses TanStack
Query options. Routes live in `packages/web/src/routes/`; use the guards from
`packages/web/src/lib/auth-guards.ts`.

The Tauri host and server-hosted web UI can release separately. Define exact
native bridge contracts in `packages/contracts/src/desktop-tauri.ts`. Native
commands must validate their inputs and the calling window's selected origin.
Keep local connection commands separate from remote window permissions. The
browser build must ignore globals from unsupported native bridge contracts.

The WebView makes normal same-origin server requests with its HttpOnly cookies.
The native PKCE flow sets those cookies before loading the server UI. Do not
add a general API proxy. Native downloads derive their target from the selected
server and a validated clip ID. Never accept a renderer-supplied target origin.
Desktop/server compatibility uses exact IDs from `/api/server-info`. Alloy
currently has one operator and no external deployments. HTTP contract 1 can
change in place when desktop and server are updated together. Once independent
deployments exist, version breaking changes and define a support window.

Keep OBS in the recorder process. Sidecar protocol changes must update both
`packages/recording-host` and `packages/recorder/src/sidecar_types.rs`.

Put cross-package types and constants in `packages/contracts`. Use Zod when a
value crosses a runtime boundary; use plain TypeScript types otherwise.

## Git and pull requests

`dev` is the only long-lived branch. Use `dev` or `origin/dev` for diffs and
target pull requests at `dev`. Follow `.github/CONTRIBUTING.md` for branch,
commit, and PR conventions.

UI pull requests need before and after screenshots. Release notes use one
`changelog:*` label derived from the conventional PR title; use
`changelog:skip` when no release note is needed.
