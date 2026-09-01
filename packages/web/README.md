# @alloy/web

React/TanStack application for Alloy. The server serves one browser build to
normal browsers and Alloy Desktop.

## Layout

```text
packages/web/
  src/main.tsx           shared application bootstrap
  src/router.tsx         TanStack router setup
  src/routes/            file-based routes
  src/components/        app-specific UI and route components
  src/lib/               app-specific client helpers, queries, formatting
  src/hooks/             app-specific hooks
```

## Commands

```bash
pnpm --filter @alloy/web dev
pnpm --filter @alloy/web build
pnpm --filter @alloy/web preview
pnpm test packages/web
pnpm --filter @alloy/web typecheck
```

Root shortcuts:

```bash
pnpm dev
pnpm dev:web
pnpm dev:all
```

## Development

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to the
server. Start the API separately or use a root dev command that includes both:

```bash
pnpm dev
```

## Production

`pnpm --filter @alloy/web build` emits the browser build in
`packages/web/dist`. The Nix package copies it into the server runtime and sets
`WEB_DIST_DIR` so Hono can serve it.

Alloy Desktop navigates this build at the selected server origin. The exact
bridge marker activates native-only UI when a compatible preload exposes
`window.alloyDesktop`; normal browsers and obsolete unversioned shells ignore
it. Networking and history remain ordinary same-origin browser behavior.

## Guidelines

Use `@alloy/api` for server calls, `@alloy/contracts` for shared shapes, and
`@alloy/ui` for shared components. Route-specific queries and browser-only logic
belong here rather than in shared packages.
