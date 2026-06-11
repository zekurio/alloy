# alloy-web

React/TanStack web app for Alloy. In development it runs as a Vite app on port 5173. In production the server serves the built web assets.

## Layout

```text
packages/web/
  src/main.tsx           browser entrypoint
  src/router.tsx         TanStack router setup
  src/routes/            file-based routes
  src/components/        app-specific UI and route components
  src/lib/               app-specific client helpers, queries, formatting
  src/hooks/             app-specific hooks
```

## Commands

```bash
pnpm --filter alloy-web dev
pnpm --filter alloy-web build
pnpm --filter alloy-web preview
pnpm --filter alloy-web typecheck
pnpm --filter alloy-web test
```

Root shortcuts:

```bash
pnpm dev:web
pnpm dev:desktop
```

## Development

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to the
server. Start the API separately or use a root dev command that includes both:

```bash
pnpm dev:desktop
```

## Production

`pnpm --filter alloy-web build` emits `packages/web/dist`. The Nix package copies
that into the server runtime and sets `WEB_DIST_DIR` so the Hono server can serve
the web app.

## Guidelines

Use `alloy-api` for server calls, `alloy-contracts` for shared shapes, and
`alloy-ui` for shared components. Route-specific queries and browser-only logic
belong here rather than in shared packages.
