# AGENTS.md

This file provides guidance to AI agents running in this repo.

## Task Completion Requirements

- All of `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` must pass before considering tasks completed.

## Project Snapshot

Alloy is an open-source and self-hostable alternative to Medal.tv.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under many interactions and during failures (upload fails, playback errors, requests error out).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server` - Hono API server for auth, clips, uploads, playback, feeds, search, notifications, admin, storage, and encoding jobs.
- `apps/web` - React/TanStack frontend for the Alloy web app.
- `packages/api` - Typed client helpers for calling the server API from the web app.
- `packages/ui` - Shared React UI components, styles, hooks, and design utilities.
- `packages/db` - Drizzle database schema, migrations, and database exports.
- `packages/contracts` - Shared TypeScript contracts and types used across apps and packages.
