# AGENTS.md

This file provides guidance to AI agents running in this repo.

## Task Completion Requirements

### Coding Tasks

All of `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` must pass
before considering a coding task completed.

### Nix Tasks

If updating our Nix packaging, flake or other Nix related things, run appropiate
checks for these. Builds should only be issued when actually warranted.

### Other Tasks

If your task doesn't fit in either Coding or Nix land, it's up to the user to
ask for verification. You may propose steps.

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

Long term maintainability is a core priority. If you add new functionality,
first check if there is shared logic that can be extracted to a separate module.
Duplicate logic across multiple files is a code smell and should be avoided.
Don't be afraid to change existing code. Don't take shortcuts by just adding
local logic to solve a problem.

## Package Roles

- `packages/server` - Hono API server for auth, clips, uploads, playback, feeds,
  search, notifications, admin, storage, and encoding jobs.
- `packages/web` - React/TanStack frontend for the Alloy web app.
- `packages/desktop` - Electron desktop shell for connecting to an Alloy
  server and controlling local recording.
- `packages/recorder` - Rust recording sidecar built as `alloy-recorder`.
- `packages/api` - Typed client helpers for calling the server API from the web
  app.
- `packages/ui` - Shared React UI components, styles, hooks, and design
  utilities.
- `packages/db` - Drizzle database schema, migrations, and database exports.
- `packages/contracts` - Shared TypeScript contracts and types used across
  packages.
