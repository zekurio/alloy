# @alloy/ui

Shared React UI package for Alloy. It contains components, hooks, design-token
CSS, and small UI utilities used by the web app and desktop overlay.

## Layout

```text
packages/ui/
  src/components/        shared React components
  src/hooks/             shared hooks
  src/lib/               UI utilities
  src/styles/globals.css Tailwind theme, tokens, base styles
```

## Imports

Use package exports:

```tsx
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import "@alloy/ui/globals.css"
```

## Commands

```bash
pnpm --filter @alloy/ui build
pnpm --filter @alloy/ui typecheck
pnpm --filter @alloy/ui test
```

## Guidelines

Keep shared components generic enough for both web and desktop surfaces. Avoid
putting route-specific data fetching or app-specific business logic in this
package; compose that behavior in `packages/web` or `packages/desktop`.
