# Repository Guidelines

This file gives AI agents the repo-specific context they need when working in Alloy.

- The default branch in this repo is `dev`.
- `dev` is the only long-lived branch; use `dev` or `origin/dev` for diffs.

## Project Overview

Alloy is an open-source, self-hostable alternative to Medal.tv: a Windows desktop
app records gameplay clips locally and publishes them to a self-hosted server;
the web app handles browsing, playback, profiles, comments, search, and admin.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve
long-term maintainability is encouraged.

### Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under many interactions and during failures (upload
   fails, playback errors, requests error out).

If a tradeoff is required, choose correctness and robustness over short-term
convenience. Long-term maintainability is a core priority: before adding new
functionality, check if there is shared logic that can be extracted to a
separate module. Duplicate logic across multiple files is a code smell. Don't
be afraid to change existing code; don't take shortcuts by adding local logic.

## Architecture & Data Flow

pnpm + Turbo monorepo with four product packages and shared libraries under
`packages/*`. Four transport seams:

- Browser ↔ server: HTTP via the typed client in `packages/api`.
- Web renderer ↔ Electron main: narrow `contextBridge`/`ipcMain.handle` IPC
  (`packages/desktop/src/preload/*.ts`, `src/main/ipc.ts`).
- Electron ↔ recorder: newline-delimited JSON over stdin/stdout
  (`packages/desktop/src/main/recording-sidecar-client.ts` ↔
  `packages/recorder/src/sidecar_runtime.rs`).
- Server ↔ PostgreSQL/filesystem: Drizzle (`packages/db`) + storage drivers
  (`packages/server/src/storage/`).

Clip pipeline (upload → encode → playback):

1. Web initiates upload and gets a signed ticket
   (`packages/web/src/components/upload/upload-flow-runner.ts`,
   `packages/server/src/routes/clips-upload-lifecycle.ts`).
2. Bytes go to `POST /api/assets/upload/:token`
   (`packages/server/src/storage/fs-upload-route.ts`).
3. Finalization enqueues a `clip.encode` job
   (`packages/server/src/jobs/kinds/clip-encode.ts`); the dispatcher runs jobs
   across `encode`/`io`/`maintenance` queues with leases and retries
   (`packages/server/src/jobs/dispatcher.ts`).
4. The media pipeline probes, trims, extracts a poster, and encodes renditions
   (`packages/server/src/queue/media-run.ts`), using packet-copy MP4 helpers
   from `packages/media`.
5. Playback routes serve stream/source/rendition/thumbnail with range support
   (`packages/server/src/routes/clips-playback*.ts`).

The desktop shell is thin: a trusted overlay window plus a main window that
loads the server-hosted web app. Login uses an RFC 8252 loopback flow in the
system browser (`packages/desktop/src/main/browser-login.ts`).

## Key Directories

- `packages/server` - Hono API server for auth, clips, uploads, playback, feeds, search, notifications, admin, storage, and encoding jobs.
- `packages/web` - React 19 + TanStack Router/Query frontend for the Alloy web app.
- `packages/desktop` - Electron desktop shell for connecting to an Alloy server and controlling local recording.
- `packages/recorder` - Windows-only Rust OBS recording sidecar built as `alloy-recorder`.
- `packages/media` - Shared isomorphic MP4 packet-copy/trim helpers (no re-encoding).
- `packages/api` - Typed client helpers for calling the server API from the web app.
- `packages/contracts` - Shared TypeScript contracts and types used across packages.
- `packages/db` - Drizzle (PostgreSQL) schema, migrations, and database exports.
- `packages/env` - Shared environment variable parsing and runtime configuration helpers.
- `packages/i18n` - Translation messages and localization utilities.
- `packages/logging` - Shared logging utilities.
- `packages/ui` - Shared React UI components (Base UI + Tailwind, shadcn-style), hooks, and design utilities.
- `nix/` - Server package (`package.nix`), NixOS module (`module.nix`); `devenv.nix` provides the dev shell.
- `scripts/` - Release version stamping, Nix node_modules pruning, benchmarks.

## Development Commands

Run from the repo root unless noted:

- `pnpm dev` - `db:push` then server + web dev; `pnpm dev:all` adds desktop.
- `pnpm build` / `pnpm start` - build all via Turbo / run the server.
- `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` - Drizzle workflows (`packages/db/drizzle.config.ts`).
- `pnpm fmt` / `pnpm lint` / `pnpm typecheck` / `pnpm test` - oxfmt, oxlint, `tsc`, `turbo run test`. `pnpm verify` runs all four (fmt as check).
- `pnpm --filter @alloy/server test` - server test suite (`tsx --test 'src/**/*.test.ts'`).
- `pnpm recorder:build[:release]` - cargo build of the sidecar (skips on non-Windows unless forced).
- `pnpm desktop:dist:win[:installer]` - Windows desktop packaging.
- Recorder checks (in `packages/recorder`): `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`.
- Nix: `nix build .#alloy` builds the server package; `nix flake check` validates it.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `add-thumbnail-selector`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `web`, `server`, `desktop`, `recorder`, `db`, or `ui`.

Examples: `fix(web): add upload UI`, `docs: update contributing guide`, `chore: cleanup build scripts`.

### Release Changelogs

GitHub Release notes are grouped by one `changelog:*` label per pull request.
The PR-label workflow derives the category from a conventional PR title, but
maintainers can replace it with the most accurate category or use
`changelog:skip` to exclude the PR. Keep PR titles conventional so release
notes classify correctly. If a release contains direct commits instead of PRs,
the publish workflow groups their conventional commit subjects as a fallback.

## Code Conventions & Common Patterns

### General Principles

- Keep related logic in one function unless extracting it makes the behavior easier to reuse, test, or reason about.
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const clip = await db.query.clips.findFirst({ where: eq(clips.id, clipId) })

// Bad
const clipIdFilter = eq(clips.id, clipId)
const clip = await db.query.clips.findFirst({ where: clipIdFilter })
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Clip } from "@alloy/contracts/clip"`, then reference `Clip.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Keep synchronous parsing, validation, and option building synchronous. Do not introduce async control flow unless the operation is actually asynchronous.
- Prefer the repo's existing validation and parsing utilities over one-off parsing logic. When parsing untrusted JSON strings, validate the resulting shape before using it.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = pgTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = pgTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

### Established Patterns to Follow

- Server routes: Hono handlers with `zValidator` + zod input schemas; return
  explicit response helpers (`badRequest`, `unauthorized`, `notFound`, ...)
  from `packages/server/src/runtime/http-response.ts` rather than throwing.
- Background work: define jobs with `defineJobKind(...)` in
  `packages/server/src/jobs/kinds/`; the dispatcher passes a context object.
  The media pipeline is parameterized by the `MediaStore` interface
  (`packages/server/src/queue/media-store.ts`).
- Web data: TanStack Query `queryOptions`/`infiniteQueryOptions` in
  `packages/web/src/lib/*-queries.ts`; all requests go through `createApi()`
  (`packages/web/src/lib/api.ts`). Routes are file-based
  (`packages/web/src/routes/`) with `beforeLoad` guards from
  `packages/web/src/lib/auth-guards.ts`.
- Desktop: renderers only reach the main process through the preload bridges;
  add new IPC channels in `packages/desktop/src/main/ipc.ts` plus the matching
  preload. Sidecar protocol changes must update both
  `packages/desktop/src/main/recording-sidecar-protocol.ts` and
  `packages/recorder/src/sidecar_types.rs`.
- Fire-and-forget async uses `void promise.catch(...)`; do not leave floating
  promises.
- Shared cross-package types/constants belong in `packages/contracts` (zod
  schemas where runtime validation matters, plain types otherwise).

## Important Files

- Entry points: `packages/server/src/index.ts` (app in `src/app.ts`, web-shell mount in `src/web.ts`), `packages/web/src/main.tsx` + `src/router.tsx`, `packages/desktop/src/main/index.ts` (+ `src/preload/*.ts`, `src/renderer/main.tsx`), `packages/recorder/src/sidecar_runtime.rs` (`fn main()`).
- DB: schema in `packages/db/src/schema/*.ts`, generated SQL in `packages/db/drizzle/`, migration runner in `packages/db/src/runtime/migrate.ts`.
- Config: `turbo.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` (strict; `@/*` maps to each package's `src/`), `.oxfmtrc.json`, `.oxlintrc.json`, `.env.example` (documented env vars — `DATABASE_URL`, `ALLOY_*` auth/storage/transcoding knobs, `VITE_SERVER_URL`).
- Nix: `flake.nix` (x86_64-linux server package + NixOS module), `devenv.nix` (dev shell: Node 24, pnpm, PostgreSQL 17, ffmpeg, Rust, Electron; auto-creates `.env` and a local Postgres).
- Release/CI: `.github/RELEASING.md`,
  `.github/workflows/{test,recorder,publish,refresh-release-notes}.yml`, and
  `scripts/update-release-package-versions.mjs`. The publish workflow runs via
  `workflow_dispatch` from `dev`, tags/names releases as `vX.Y.Z`, and uses
  only `latest.yml` for desktop auto-update; no prereleases or alternate
  channels.

## Runtime/Tooling Preferences

- Node 24 and `pnpm@11.4.0` (pinned via `packageManager`); never use npm, yarn, or Bun.
- Turbo orchestrates package tasks; prefer root scripts or `pnpm --filter @alloy/<pkg> <script>`.
- Formatting is oxfmt, linting is oxlint (type-aware, `no-console` is an error) — not Prettier/ESLint. 80-col width, 2-space indent, no semicolons, double quotes.
- TypeScript is strict ESM (`verbatimModuleSyntax`, `noEmit`); packages typecheck with `tsc --noEmit`.
- Recorder is Rust stable; it only builds on Windows (build script skips elsewhere).
- Local dev shell comes from devenv + direnv; server deployment is via the Nix flake / NixOS module, not GitHub artifacts.

## Testing & QA

- Server tests use the Node test runner via tsx: `pnpm --filter @alloy/server test` (files: `packages/server/src/**/*.test.ts`). DB-backed suites provision per-suite databases through `packages/server/src/db/test-database.ts` using `ALLOY_TEST_DATABASE_URL`.
- Recorder tests are inline Rust unit tests: `cargo test --locked` in `packages/recorder`.
- Other packages currently have no test suites; `pnpm test` runs everything via Turbo.
- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Run package-specific tests from the package that owns them when available. Use root-level `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` for repo-wide checks.

## Task Completion Requirements

### Coding Tasks

All of `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` must pass before considering a coding task completed.

### Nix Tasks

If updating our Nix packaging, flake, or other Nix-related things, run appropriate
checks for these. Builds should only be issued when actually warranted.

### Other Tasks

If your task doesn't fit in either Coding or Nix land, it's up to the user to
ask for verification. You may propose steps.
