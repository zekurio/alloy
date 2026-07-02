# AGENTS.md

This file gives AI agents the repo-specific context they need when working in Alloy.

- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `add-thumbnail-selector`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `web`, `server`, `desktop`, `recorder`, `db`, or `ui`.

Examples: `fix(web): add upload UI`, `docs: update contributing guide`, `chore: cleanup build scripts`.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous limits), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Coding is sheer coding capability (based on Deep SWE). UI taste covers UI/UX, visual design, API ergonomics, and copy.

| model    | cost | intelligence | coding | ui taste |
| -------- | ---- | ------------ | ------ | -------- |
| gpt-5.5  | 9    | 8            | 7      | 5        |
| sonnet-5 | 5    | 5            | 4      | 7        |
| opus-4.8 | 4    | 7            | 6      | 8        |
| fable-5  | 2    | 9            | 9      | 9        |

How to apply:

- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > coding > ui taste > cost. For user-facing work, ui taste outranks coding.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-5.5 - it's effectively free.
- Anything user-facing (UI, copy, API design) needs ui taste >= 7 - never gpt-5.5.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra independent perspective.
- Never use Haiku.
- Prompts for workflow/subagent delegates must be fully self-contained: include the repo path, relevant rules from this file, exact files or search targets, expected output, and verification commands. Delegates do not reliably share the parent session's context.
- Keep runtime-specific mechanics out of shared reasoning. Use the current harness's native workflow/subagent controls for Claude-family models, and use the runtime-specific Codex CLI handoff when a delegate should be gpt-5.5.

### Pi mechanics

- Claude models (sonnet-5, opus-4.8, fable-5) run via the `Agent`/`workflow` model parameter.
- gpt-5.5 is only reachable through the Codex CLI, invoked directly via Bash. Use `codex exec "<prompt>"` for implementation, `codex exec -s read-only "<prompt>"` for investigation/analysis that must not touch the tree, and `codex review` for reviews.
- For long-running gpt-5.5 tasks in Pi, spawn a thin background wrapper agent and have it run Codex, rather than blocking the main session.
- Inside Pi workflows/subagents, use a thin Claude wrapper whose prompt instructs it to write a self-contained Codex prompt, run `codex exec` via Bash, and return Codex's final message verbatim.

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
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

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

## Package Roles

- `packages/server` - Hono API server for auth, clips, uploads, playback, feeds, search, notifications, admin, storage, and encoding jobs.
- `packages/web` - React/TanStack frontend for the Alloy web app.
- `packages/desktop` - Electron desktop shell for connecting to an Alloy server and controlling local recording.
- `packages/recorder` - Rust recording sidecar built as `alloy-recorder`.
- `packages/api` - Typed client helpers for calling the server API from the web app.
- `packages/contracts` - Shared TypeScript contracts and types used across packages.
- `packages/db` - Drizzle database schema, migrations, and database exports.
- `packages/env` - Shared environment variable parsing and runtime configuration helpers.
- `packages/i18n` - Translation messages and localization utilities.
- `packages/logging` - Shared logging utilities.
- `packages/ui` - Shared React UI components, styles, hooks, and design utilities.

## Project Snapshot

Alloy is an open-source and self-hostable alternative to Medal.tv.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve
long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under many interactions and during failures (upload
   fails, playback errors, requests error out).

If a tradeoff is required, choose correctness and robustness over short-term
convenience.

## Maintainability

Long-term maintainability is a core priority. If you add new functionality,
first check if there is shared logic that can be extracted to a separate module.
Duplicate logic across multiple files is a code smell and should be avoided.
Don't be afraid to change existing code. Don't take shortcuts by just adding
local logic to solve a problem.
