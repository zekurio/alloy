# Repository Guidelines

- Alloy is a self-hostable Medal.tv alternative: an Electron desktop shell
  (`packages/desktop`) drives a Windows-only Rust OBS sidecar
  (`packages/recorder`) and loads the server-hosted web app; the Hono server
  (`packages/server`) and React web app (`packages/web`) handle uploads,
  encoding, and playback. Shared libraries live under `packages/*`
  (`contracts`, `api`, `db`, `media`, `env`, `i18n`, `logging`, `ui`).
- The default branch is `dev` and it is the only long-lived branch; use `dev`
  or `origin/dev` for diffs.
- Node 24 and `pnpm@11.13.0` (pinned); never use npm, yarn, or Bun. Prefer
  root scripts or `pnpm --filter @alloy/<pkg> <script>`. `pnpm dev` runs
  db:push plus server and web; `pnpm dev:all` adds desktop; Drizzle workflows
  are `pnpm db:generate|migrate|push|studio`.
- Formatting is oxfmt and linting is oxlint (type-aware, `no-console` is an
  error), not Prettier/ESLint. TypeScript is strict ESM; packages typecheck
  with `tsc --noEmit`.
- All of `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` must pass before a
  coding task is complete (`pnpm verify` runs all three, fmt as check).
- Recorder checks run from `packages/recorder`: `cargo fmt --check` and
  `cargo clippy --all-targets --locked -- -D warnings`. The recorder only
  builds on Windows.
- For Nix changes (`flake.nix`, `nix/`), run `nix flake check`; only run
  `nix build .#alloy` when actually warranted.
- This repo is an early WIP; sweeping changes that improve long-term
  maintainability are encouraged. Prefer correctness and robustness over
  short-term convenience, and extract shared logic instead of duplicating it
  across files.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `add-thumbnail-selector`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `web`, `server`, `desktop`, `recorder`, `db`, or `ui`.

Examples: `fix(web): add upload UI`, `docs: update contributing guide`, `chore: cleanup build scripts`.

Release notes group PRs by one `changelog:*` label derived from the
conventional PR title; use `changelog:skip` to exclude a PR.

PRs with UI changes must include before and after screenshots. Other PRs may
omit the screenshots section.

## Style Guide

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

## Repo Patterns

- Server routes are Hono handlers with `zValidator` + zod input schemas; return the explicit response helpers (`badRequest`, `unauthorized`, `notFound`, ...) from `packages/server/src/runtime/http-response.ts` rather than throwing.
- Background work is defined with `defineJobKind(...)` in `packages/server/src/jobs/kinds/`; the media pipeline is parameterized by the `MediaStore` interface (`packages/server/src/queue/media-store.ts`).
- Web data uses TanStack Query `queryOptions`/`infiniteQueryOptions` in `packages/web/src/lib/*-queries.ts`; all requests go through `createApi()` (`packages/web/src/lib/api.ts`). Routes are file-based (`packages/web/src/routes/`) with `beforeLoad` guards from `packages/web/src/lib/auth-guards.ts`.
- Desktop renderers reach the main process only through preload bridges. The web-facing bridge in `packages/contracts/src/desktop-bridge.ts` is additive-only because the server-hosted web app and desktop shell update independently: add a contract entry plus its typed handler fragment, never hand-written channels or preload wrappers. Gate new web features with `desktopSupports` from `packages/web/src/lib/desktop.ts`, never by probing optional members.
- Sidecar protocol changes must update both `packages/desktop/src/main/recording-sidecar-protocol.ts` and `packages/recorder/src/sidecar_types.rs`.
- Fire-and-forget async uses `void promise.catch(...)`; do not leave floating promises.
- Shared cross-package types/constants belong in `packages/contracts` (zod schemas where runtime validation matters, plain types otherwise).
