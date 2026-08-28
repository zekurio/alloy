# @alloy/web

React/TanStack application for Alloy. The server serves the browser build, and
Electron packages a separate desktop entry from the same source.

## Layout

```text
packages/web/
  src/main.tsx           shared application bootstrap
  src/desktop.tsx        desktop runtime bootstrap
  src/router.tsx         browser/hash TanStack router setup
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
pnpm --filter @alloy/web test
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

Electron Vite builds `packages/web/src/desktop.tsx` into
`packages/desktop/out/renderer/desktop.html`. That entry installs the selected
server before importing the shared app, uses hash history, and sends API calls
to `alloy-app://app`. The normal browser build ignores `window.alloyDesktop`
even when an obsolete shell injects it.

## Guidelines

Use `@alloy/api` for server calls, `@alloy/contracts` for shared shapes, and
`@alloy/ui` for shared components. Route-specific queries and browser-only logic
belong here rather than in shared packages.
