# @alloy/api

Typed client helpers for calling Alloy server endpoints from browser-facing
code. This package keeps API path construction, request helpers, mutations, and
runtime response validation out of UI components.

## Layout

```text
packages/api/
  src/client.ts                 low-level API client
  src/http.ts                   fetch wrapper and request helpers
  src/*                         endpoint-specific helpers
  src/contract-validators/      runtime validators for server responses
```

## Imports

Use the package exports rather than deep relative imports:

```ts
import { createApi } from "@alloy/api"
import { authPaths } from "@alloy/api/auth"
```

## Commands

```bash
pnpm --filter @alloy/api build
pnpm --filter @alloy/api typecheck
pnpm --filter @alloy/api test
```

The `build` command is a TypeScript no-emit build. Tests use Node's test runner
through `tsx`.

## Notes

Prefer adding shared response types to `@alloy/contracts` and validators here
instead of duplicating shape checks in `packages/web` or `packages/desktop`.
